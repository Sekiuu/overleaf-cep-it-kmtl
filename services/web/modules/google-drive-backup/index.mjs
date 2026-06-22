import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import GoogleDriveRouter from './app/src/GoogleDriveRouter.mjs'
import GoogleDriveBackupScheduler from './app/src/GoogleDriveBackupScheduler.mjs'

let GoogleDriveBackupModule = {}

if (Settings.googleDriveBackup?.enabled) {
  GoogleDriveBackupModule = {
    router: GoogleDriveRouter,
    async start() {
      // Only one web instance should run the scheduler. Enabled by default when
      // the feature is on; set GOOGLE_DRIVE_BACKUP_SCHEDULER=false on extra
      // instances in a multi-instance deployment.
      if (Settings.googleDriveBackup.schedulerEnabled) {
        GoogleDriveBackupScheduler.start()
      } else {
        logger.info(
          'google-drive-backup: scheduler disabled on this instance'
        )
      }
    },
  }
}

export default GoogleDriveBackupModule
