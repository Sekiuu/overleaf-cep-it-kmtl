import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'

type BackupStatus = {
  linked: boolean
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
  const user = getMeta('ol-user')
  const refProviders = (user?.refProviders || {}) as Record<string, boolean>
  const [isLinked, setIsLinked] = useState(Boolean(refProviders.googleDrive))
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
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
  }, [])

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
    try {
      const result = await postJSON('/google-drive/backup-now')
      if (result?.status === 'insufficient-space') {
        setError(t('google_drive_insufficient_space'))
      } else {
        setMessage(t('google_drive_backup_started'))
      }
    } catch (err) {
      setError(t('generic_something_went_wrong'))
    } finally {
      setProcessing(false)
    }
  }, [t])

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
        {error && <OLNotification type="error" content={error} />}
        {message && <OLNotification type="success" content={message} />}
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
