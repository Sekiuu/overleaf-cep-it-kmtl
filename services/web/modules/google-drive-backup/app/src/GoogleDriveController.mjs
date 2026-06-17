import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'
import GoogleDriveApiClient from './GoogleDriveApiClient.mjs'
import GoogleDriveTokenStore from './GoogleDriveTokenStore.mjs'
import GoogleDriveBackupManager from './GoogleDriveBackupManager.mjs'

const SETTINGS_REDIRECT = '/user/settings#project-sync'

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
    const { refreshToken } =
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
    await GoogleDriveTokenStore.storeRefreshToken(userId, refreshToken)
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

/**
 * POST /google-drive/backup-now
 * Manually trigger a backup of all the current user's projects (for testing and
 * on-demand use). Runs synchronously and returns a summary.
 */
async function backupNow(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const result =
      await GoogleDriveBackupManager.backupAllProjectsForUser(userId)
    res.json(result)
  } catch (err) {
    if (err instanceof GoogleDriveBackupManager.GoogleDriveNotLinkedError) {
      return res.status(400).json({ error: 'not_linked' })
    }
    logger.err({ err, userId }, 'google-drive-backup: manual backup failed')
    res.status(500).json({ error: 'internal' })
  }
}

export default {
  startLink,
  oauthCallback,
  unlink,
  status,
  backupNow,
}
