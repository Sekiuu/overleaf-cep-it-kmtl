import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import GoogleDriveController from './GoogleDriveController.mjs'

export default {
  apply(webRouter) {
    // Begin OAuth linking — redirects to Google's consent screen.
    webRouter.get(
      '/google-drive/link',
      AuthenticationController.requireLogin(),
      GoogleDriveController.startLink
    )

    // OAuth redirect target — exchanges the code and stores the refresh token.
    webRouter.get(
      '/google-drive/callback',
      AuthenticationController.requireLogin(),
      GoogleDriveController.oauthCallback
    )

    // Unlink the Google Drive account.
    webRouter.post(
      '/google-drive/unlink',
      AuthenticationController.requireLogin(),
      GoogleDriveController.unlink
    )

    // Link status + last backup metadata for the settings widget.
    webRouter.get(
      '/google-drive/status',
      AuthenticationController.requireLogin(),
      GoogleDriveController.status
    )

    // Manually trigger a backup of the current user's projects.
    webRouter.post(
      '/google-drive/backup-now',
      AuthenticationController.requireLogin(),
      GoogleDriveController.backupNow
    )
  },
}
