import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import GoogleDriveTokenStore from './GoogleDriveTokenStore.mjs'
import GoogleDriveBackupManager from './GoogleDriveBackupManager.mjs'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// Wait a little after boot before the first run so startup isn't competing with
// compiles.
const INITIAL_DELAY_MS = 5 * 60 * 1000

let timer = null
let running = false

function _intervalMs() {
  return Settings.googleDriveBackup?.intervalMs ?? ONE_DAY_MS
}

/**
 * Run one backup pass over every linked user. Users are processed sequentially
 * to bound the load placed on the CLSI compile servers (each project may be
 * compiled on demand). Overlapping runs are skipped.
 */
async function runOnce() {
  if (running) {
    logger.info('google-drive-backup: previous run still in progress, skipping')
    return
  }
  running = true
  const startedAt = Date.now()
  try {
    const userIds = await GoogleDriveTokenStore.getLinkedUserIds()
    logger.info(
      { userCount: userIds.length },
      'google-drive-backup: starting scheduled backup pass'
    )
    for (const userId of userIds) {
      try {
        const { status } =
          await GoogleDriveBackupManager.backupAllProjectsForUser(userId)
        logger.info(
          { userId, status },
          'google-drive-backup: finished backing up user'
        )
      } catch (err) {
        logger.error(
          { err, userId },
          'google-drive-backup: failed to back up user'
        )
      }
    }
    logger.info(
      { durationMs: Date.now() - startedAt },
      'google-drive-backup: scheduled backup pass complete'
    )
  } finally {
    running = false
  }
}

/**
 * Start the periodic scheduler. Safe to call once at module boot.
 * In multi-instance deployments only one instance should enable backups.
 */
function start() {
  if (timer) {
    return
  }
  const intervalMs = _intervalMs()
  logger.info(
    { intervalMs },
    'google-drive-backup: scheduler enabled'
  )
  // Kick off after an initial delay, then repeat on the configured interval.
  timer = setTimeout(function scheduleNext() {
    runOnce()
      .catch(err =>
        logger.error({ err }, 'google-drive-backup: scheduled run errored')
      )
      .finally(() => {
        timer = setTimeout(scheduleNext, intervalMs)
        // Don't keep the event loop alive solely for backups.
        if (timer.unref) timer.unref()
      })
  }, INITIAL_DELAY_MS)
  if (timer.unref) timer.unref()
}

function stop() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export default {
  start,
  stop,
  runOnce,
}
