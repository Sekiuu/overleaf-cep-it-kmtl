import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'
import GoogleDriveApiClient from './GoogleDriveApiClient.mjs'
import GoogleDriveTokenStore from './GoogleDriveTokenStore.mjs'
import GoogleDriveBackupManager from './GoogleDriveBackupManager.mjs'

const SETTINGS_REDIRECT = '/user/settings#project-sync'
const DOMAIN_ERROR_REDIRECT =
  '/user/settings?google_drive_error=domain#project-sync'

/**
 * Check that the linked Google account belongs to one of the allowed Workspace
 * domains. When none are configured, any account is accepted.
 */
function _isDomainAllowed(email, hostedDomain) {
  const allowedDomains = Settings.googleDriveBackup?.allowedDomains || []
  if (allowedDomains.length === 0) {
    return true
  }
  const hd = hostedDomain?.toLowerCase()
  const emailDomain = (email || '').split('@')[1]?.toLowerCase()
  return allowedDomains.some(
    domain => domain === hd || domain === emailDomain
  )
}

/**
 * GET /google-drive/link
 * Begin the OAuth flow: stash a CSRF state token in the session and redirect
 * the user to Google's consent screen.
 */
async function startLink(req, res) {
  const state = crypto.randomBytes(16).toString('hex')
  req.session.googleDriveOAuthState = state
  try {
    const url = GoogleDriveApiClient.getAuthorizationUrl(state)
    res.redirect(url)
  } catch (err) {
    logger.err({ err }, 'google-drive-backup: cannot start OAuth flow')
    res.redirect(SETTINGS_REDIRECT)
  }
}

/**
 * GET /google-drive/callback
 * Handle the OAuth redirect back from Google: validate state, exchange the
 * authorization code for tokens, and persist the encrypted refresh token.
 */
async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state, error } = req.query
  const expectedState = req.session.googleDriveOAuthState
  delete req.session.googleDriveOAuthState

  if (error) {
    logger.warn({ userId, error }, 'google-drive-backup: consent denied')
    return res.redirect(SETTINGS_REDIRECT)
  }
  if (!code || !state || state !== expectedState) {
    logger.warn({ userId }, 'google-drive-backup: invalid OAuth callback state')
    return res.redirect(SETTINGS_REDIRECT)
  }

  try {
    const { refreshToken, email, hostedDomain } =
      await GoogleDriveApiClient.exchangeCodeForTokens(code)
    if (!refreshToken) {
      // Google only returns a refresh token when access_type=offline and the
      // user is prompted for consent. We force prompt=consent, so this is rare.
      logger.warn(
        { userId },
        'google-drive-backup: no refresh token returned by Google'
      )
      return res.redirect(SETTINGS_REDIRECT)
    }
    // Enforce the institutional Workspace domain (e.g. kmitl.ac.th).
    if (!_isDomainAllowed(email, hostedDomain)) {
      logger.warn(
        {
          userId,
          allowedDomains: Settings.googleDriveBackup?.allowedDomains,
        },
        'google-drive-backup: linked Google account is outside the allowed domains'
      )
      return res.redirect(DOMAIN_ERROR_REDIRECT)
    }
    await GoogleDriveTokenStore.storeRefreshToken(userId, refreshToken, email)
    UserAuditLogHandler.addEntryInBackground(
      userId,
      'link-google-drive',
      userId,
      req.ip
    )
    res.redirect(SETTINGS_REDIRECT)
  } catch (err) {
    logger.err({ err, userId }, 'google-drive-backup: error linking account')
    res.redirect(SETTINGS_REDIRECT)
  }
}

/**
 * POST /google-drive/unlink
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await GoogleDriveTokenStore.unlink(userId)
    UserAuditLogHandler.addEntryInBackground(
      userId,
      'unlink-google-drive',
      userId,
      req.ip
    )
    res.sendStatus(200)
  } catch (err) {
    logger.err({ err, userId }, 'google-drive-backup: error unlinking account')
    res.sendStatus(500)
  }
}

/**
 * GET /google-drive/status
 * Returns link state + last backup metadata for the settings widget.
 */
async function status(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const result = await GoogleDriveTokenStore.getStatus(userId)
    res.json(result)
  } catch (err) {
    logger.err({ err, userId }, 'google-drive-backup: error fetching status')
    res.sendStatus(500)
  }
}

// Users with a manual backup currently in flight, so repeated clicks don't
// queue up overlapping runs.
const manualBackupsInFlight = new Set()

/**
 * POST /google-drive/backup-now
 * Manually trigger a backup of all the current user's projects. Backing up
 * compiles each project on demand and uploads many files, which can take far
 * longer than an HTTP request should, so this runs in the background and
 * returns immediately. The outcome is recorded on the user and surfaced via
 * GET /google-drive/status (lastBackupStatus).
 */
async function backupNow(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  const linked = await GoogleDriveTokenStore.isLinked(userId)
  if (!linked) {
    return res.status(400).json({ error: 'not_linked' })
  }

  const key = userId.toString()
  if (manualBackupsInFlight.has(key)) {
    return res.status(202).json({ started: false, alreadyRunning: true })
  }

  manualBackupsInFlight.add(key)
  // Intentionally not awaited — runs after the response is sent.
  GoogleDriveBackupManager.backupAllProjectsForUser(userId)
    .then(({ status }) =>
      logger.info({ userId, status }, 'google-drive-backup: manual backup done')
    )
    .catch(err =>
      logger.error({ err, userId }, 'google-drive-backup: manual backup failed')
    )
    .finally(() => manualBackupsInFlight.delete(key))

  res.status(202).json({ started: true })
}

export default {
  startLink,
  oauthCallback,
  unlink,
  status,
  backupNow,
}
