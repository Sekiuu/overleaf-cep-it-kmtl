import getMeta from '@/utils/meta'
import StorageQuota from './storage-quota'

const BYTES_PER_MB = 1024 * 1024

/**
 * Reads the current user's storage usage/limit (injected via `ol-storageQuota`)
 * and renders the StorageQuota widget. Renders nothing when there is no quota
 * data or the user is unlimited (e.g. admins), in which case the backend omits
 * the data.
 */
function StorageQuotaWidget() {
  const quota = getMeta('ol-storageQuota')

  if (!quota || quota.limitBytes < 0) {
    return null
  }

  const usedMB = Math.round(quota.usedBytes / BYTES_PER_MB)
  const totalMB = Math.round(quota.limitBytes / BYTES_PER_MB)

  return (
    <>
      <hr />
      <StorageQuota usedMB={usedMB} totalMB={totalMB} />
    </>
  )
}

export default StorageQuotaWidget
