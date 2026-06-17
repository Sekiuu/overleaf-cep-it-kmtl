import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'

type BackupStatus = {
  linked: boolean
  email: string | null
  linkedAt: string | null
  lastBackupAt: string | null
  lastBackupStatus: string | null
}

/**
 * Google Drive backup linking widget for the Account Settings page.
 * Registered via overleafModuleImports.integrationLinkingWidgets.
 *
 * Linking uses the OAuth flow served by the google-drive-backup module:
 *  - "Link" navigates to /google-drive/link (Google consent screen)
 *  - "Unlink" POSTs to /google-drive/unlink
 *  - "Back up now" POSTs to /google-drive/backup-now
 */
export default function GoogleDriveWidget() {
  const { t } = useTranslation()
  // The widget is always bundled (the module import list is fixed at build
  // time); gate its visibility on the runtime feature flag instead.
  const enabled = getMeta('ol-googleDriveBackupEnabled')
  const domains = getMeta('ol-googleDriveBackupDomains') || []
  // Human-readable list, e.g. "kmitl.ac.th or it.kmitl.ac.th".
  const domain = domains.join(' or ')
  const user = getMeta('ol-user')
  const refProviders = (user?.refProviders || {}) as Record<string, boolean>
  const [isLinked, setIsLinked] = useState(Boolean(refProviders.googleDrive))
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!enabled) return
    // Surface the "wrong domain" error after a rejected OAuth callback.
    if (
      new URLSearchParams(window.location.search).get('google_drive_error') ===
      'domain'
    ) {
      setError(t('google_drive_wrong_domain', { domain }))
    }
    let cancelled = false
    getJSON('/google-drive/status')
      .then((data: BackupStatus) => {
        if (!cancelled) {
          setStatus(data)
          setIsLinked(data.linked)
        }
      })
      .catch(() => {
        /* non-fatal: fall back to the meta-derived linked state */
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const handleLink = useCallback(() => {
    // Full-page navigation into the OAuth consent flow.
    window.location.assign('/google-drive/link')
  }, [])

  const handleUnlink = useCallback(async () => {
    setProcessing(true)
    setError('')
    setMessage('')
    try {
      await postJSON('/google-drive/unlink')
      setIsLinked(false)
      setStatus(null)
    } catch (err) {
      setError(t('generic_something_went_wrong'))
    } finally {
      setProcessing(false)
    }
  }, [t])

  const handleBackupNow = useCallback(async () => {
    setProcessing(true)
    setError('')
    setMessage('')
    const previousBackupAt = status?.lastBackupAt || null
    try {
      // The backup runs in the background; this returns immediately (202).
      await postJSON('/google-drive/backup-now')
      setMessage(t('google_drive_backup_started'))
      // Poll for the result (lastBackupAt changes when the run finishes).
      let attempts = 0
      const poll = setInterval(async () => {
        attempts += 1
        try {
          const data: BackupStatus = await getJSON('/google-drive/status')
          if (data.lastBackupAt && data.lastBackupAt !== previousBackupAt) {
            clearInterval(poll)
            setStatus(data)
            setProcessing(false)
            if (data.lastBackupStatus === 'insufficient-space') {
              setError(t('google_drive_insufficient_space'))
            }
          }
        } catch {
          /* keep polling */
        }
        if (attempts >= 40) {
          // Give up polling after ~10 minutes; the run may still finish.
          clearInterval(poll)
          setProcessing(false)
        }
      }, 15000)
      return
    } catch (err) {
      setError(t('generic_something_went_wrong'))
      setProcessing(false)
    }
  }, [t, status?.lastBackupAt])

  // Feature turned off at runtime: render nothing.
  if (!enabled) {
    return null
  }

  return (
    <div className="settings-widget-container">
      <div>
        <MaterialIcon type="backup" size="2x" />
      </div>
      <div className="description-container">
        <div className="title-row">
          <h4>{t('google_drive_backup')}</h4>
        </div>
        <p className="small">{t('google_drive_backup_description')}</p>
        {domain && (
          <p className="small text-muted">
            {t('google_drive_domain_required', { domain })}
          </p>
        )}
        {error && <OLNotification type="error" content={error} />}
        {message && <OLNotification type="success" content={message} />}
        {isLinked && status?.email && (
          <p className="small text-muted">
            {t('google_drive_linked_account', { email: status.email })}
          </p>
        )}
        {isLinked && status?.lastBackupAt && (
          <p className="small text-muted">
            {t('google_drive_last_backup', {
              date: new Date(status.lastBackupAt).toLocaleString(),
              status: status.lastBackupStatus || '',
            })}
          </p>
        )}
      </div>
      <div>
        {isLinked ? (
          <>
            <OLButton
              variant="secondary"
              onClick={handleBackupNow}
              isLoading={processing}
            >
              {t('google_drive_back_up_now')}
            </OLButton>{' '}
            <OLButton
              variant="danger-ghost"
              onClick={handleUnlink}
              isLoading={processing}
            >
              {t('unlink')}
            </OLButton>
          </>
        ) : (
          <OLButton
            variant="primary"
            onClick={handleLink}
            disabled={processing}
          >
            {t('link_to_google_drive')}
          </OLButton>
        )}
      </div>
    </div>
  )
}
