import SessionManager from '../Authentication/SessionManager.mjs'
import StorageQuotaManager from './StorageQuotaManager.mjs'
import Errors from '../Errors/Errors.js'

/**
 * Blocks the request with a 422 when the logged-in user has reached their
 * storage limit. When placed after the multer middleware, `req.file.size` is
 * counted so that the incoming upload itself is taken into account.
 */
async function ensureUserHasStorageAvailable(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) {
    return next()
  }
  const additionalBytes = req.file?.size || 0
  try {
    await StorageQuotaManager.promises.assertUserHasStorageAvailable(
      userId,
      additionalBytes
    )
  } catch (err) {
    if (err instanceof Errors.StorageQuotaExceededError) {
      return res.status(422).json({
        success: false,
        error: 'user_storage_quota_exceeded',
      })
    }
    return next(err)
  }
  next()
}

export default {
  ensureUserHasStorageAvailable,
}
