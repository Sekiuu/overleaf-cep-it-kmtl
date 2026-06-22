import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import RedisWrapper from '../../infrastructure/RedisWrapper.mjs'
import { Project } from '../../models/Project.mjs'
import HistoryManager from '../History/HistoryManager.mjs'
import UserGetter from '../User/UserGetter.mjs'
import Errors from '../Errors/Errors.js'

const rclient = RedisWrapper.client('storageQuota')

// The computed usage is cached briefly so that a single user action (e.g. an
// upload) does not trigger a fan-out of history-service requests on every
// request, while still picking up changes within a short window.
const CACHE_TTL_SECONDS = 60

function _cacheKey(userId) {
  return `storageUsage:{${userId}}`
}

/**
 * Total storage (in bytes) consumed by all the projects a user owns.
 *
 * File and document content are both stored as blobs in the history service, so
 * summing the per-project blob `totalBytes` gives the user's total footprint.
 */
async function getUserStorageUsageBytes(userId) {
  const cacheKey = _cacheKey(userId)
  try {
    const cached = await rclient.get(cacheKey)
    if (cached != null) {
      return parseInt(cached, 10)
    }
  } catch (err) {
    logger.warn({ err, userId }, 'failed to read storage usage from cache')
  }

  const projects = await Project.find(
    { owner_ref: userId },
    { 'overleaf.history.id': 1 }
  ).exec()

  const historyIds = projects
    .map(project => project.overleaf?.history?.id)
    .filter(id => id != null)

  let usageBytes = 0
  if (historyIds.length > 0) {
    const stats = await HistoryManager.promises.getProjectBlobStats(historyIds)
    usageBytes = (stats || []).reduce(
      (sum, stat) => sum + (stat.totalBytes || 0),
      0
    )
  }

  try {
    await rclient.set(cacheKey, usageBytes.toString(), 'EX', CACHE_TTL_SECONDS)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to cache storage usage')
  }

  return usageBytes
}

/**
 * The storage limit (in bytes) that applies to a user. Returns -1 for
 * "unlimited" (admins, or an explicit -1 override / default).
 */
function getUserStorageLimitBytes(user) {
  if (user?.isAdmin) {
    return -1
  }
  const limit =
    user?.features?.storageLimitBytes ??
    Settings.defaultFeatures?.storageLimitBytes ??
    Settings.defaultStorageLimitBytes
  return limit == null ? -1 : limit
}

/**
 * Throws StorageQuotaExceededError if the user is at/over their storage limit,
 * optionally accounting for `additionalBytes` about to be written.
 */
async function assertUserHasStorageAvailable(userId, additionalBytes = 0) {
  const user = await UserGetter.promises.getUser(userId, {
    isAdmin: 1,
    features: 1,
  })
  if (!user) {
    throw new Errors.UserNotFoundError({ info: { userId } })
  }

  const limitBytes = getUserStorageLimitBytes(user)
  if (limitBytes < 0) {
    return
  }

  const usageBytes = await getUserStorageUsageBytes(userId)
  if (usageBytes + additionalBytes > limitBytes) {
    throw new Errors.StorageQuotaExceededError({
      info: { userId, usageBytes, additionalBytes, limitBytes },
    })
  }
}

async function clearUserStorageUsageCache(userId) {
  try {
    await rclient.del(_cacheKey(userId))
  } catch (err) {
    logger.warn({ err, userId }, 'failed to clear storage usage cache')
  }
}

export default {
  getUserStorageLimitBytes,
  promises: {
    getUserStorageUsageBytes,
    assertUserHasStorageAvailable,
    clearUserStorageUsageCache,
  },
}
