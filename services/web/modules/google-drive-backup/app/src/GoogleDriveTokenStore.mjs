import OError from '@overleaf/o-error'
import { User } from '../../../../app/src/models/User.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

/**
 * Persists Google Drive OAuth credentials + backup status on the user record,
 * under `refProviders.googleDrive`. The refresh token is encrypted at rest with
 * @overleaf/access-token-encryptor (same approach as the Zotero module).
 *
 * Stored shape:
 *   refProviders.googleDrive = {
 *     refreshTokenEncrypted: string,
 *     email?: string,          // the linked Google account's email
 *     linkedAt: Date,
 *     lastBackupAt?: Date,
 *     lastBackupStatus?: string,
 *   }
 */

/**
 * Store (or replace) the encrypted refresh token, marking the account linked.
 * `email` is the verified Google account email (for display).
 */
async function storeRefreshToken(userId, refreshToken, email = null) {
  const refreshTokenEncrypted = await AccessTokenEncryptor.promises.encryptJson({
    refreshToken,
  })
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'refProviders.googleDrive.refreshTokenEncrypted': refreshTokenEncrypted,
        'refProviders.googleDrive.email': email,
        'refProviders.googleDrive.linkedAt': new Date(),
      },
    }
  ).exec()
}

/**
 * Decrypt and return the stored refresh token, or null when not linked.
 */
async function getRefreshToken(userId) {
  const user = await User.findById(userId, 'refProviders.googleDrive').exec()
  const encrypted = user?.refProviders?.googleDrive?.refreshTokenEncrypted
  if (!encrypted) {
    return null
  }
  try {
    const { refreshToken } =
      await AccessTokenEncryptor.promises.decryptToJson(encrypted)
    return refreshToken
  } catch (err) {
    throw OError.tag(err, 'failed to decrypt Google Drive refresh token', {
      userId,
    })
  }
}

/**
 * Whether the user has linked a Google Drive account.
 */
async function isLinked(userId) {
  const user = await User.findById(userId, 'refProviders.googleDrive').exec()
  return Boolean(user?.refProviders?.googleDrive?.refreshTokenEncrypted)
}

/**
 * Return link status + last backup metadata for display in the UI.
 */
async function getStatus(userId) {
  const user = await User.findById(userId, 'refProviders.googleDrive').exec()
  const gd = user?.refProviders?.googleDrive
  return {
    linked: Boolean(gd?.refreshTokenEncrypted),
    email: gd?.email || null,
    linkedAt: gd?.linkedAt || null,
    lastBackupAt: gd?.lastBackupAt || null,
    lastBackupStatus: gd?.lastBackupStatus || null,
  }
}

/**
 * Record the outcome of a backup run for the user.
 */
async function recordBackupResult(userId, status) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'refProviders.googleDrive.lastBackupAt': new Date(),
        'refProviders.googleDrive.lastBackupStatus': status,
      },
    }
  ).exec()
}

/**
 * Remove all stored Google Drive credentials/metadata for the user.
 */
async function unlink(userId) {
  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.googleDrive': 1 } }
  ).exec()
}

/**
 * Return the ids of all users who have linked Google Drive (for the scheduler).
 */
async function getLinkedUserIds() {
  const users = await User.find(
    { 'refProviders.googleDrive.refreshTokenEncrypted': { $exists: true } },
    { _id: 1 }
  ).exec()
  return users.map(u => u._id)
}

export default {
  storeRefreshToken,
  getRefreshToken,
  isLinked,
  getStatus,
  recordBackupResult,
  unlink,
  getLinkedUserIds,
}
