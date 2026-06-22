import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

type StorageQuotaProps = {
  /** Storage used, in megabytes. */
  usedMB?: number
  /** Total storage available, in megabytes. */
  totalMB?: number
  /**
   * Fill percentage of the progress bar (0–100). Defaults to the ratio of
   * used/total, rounded to the nearest whole percent.
   */
  percent?: number
}

// Above this fill percentage the bar switches to a "near limit" colour to nudge
// the user to free up space.
const NEAR_LIMIT_THRESHOLD = 80

function StorageQuota({
  usedMB = 13160,
  totalMB = 15000,
  percent,
}: StorageQuotaProps) {
  const { t } = useTranslation()

  const ratio = totalMB > 0 ? (usedMB / totalMB) * 100 : 0
  const value = Math.min(100, Math.max(0, Math.round(percent ?? ratio)))
  const nearLimit = value >= NEAR_LIMIT_THRESHOLD

  return (
    <section className="storage-quota" aria-labelledby="storage-quota-title">
      <h2 id="storage-quota-title" className="storage-quota-title">
        {t('storage_quota')}
      </h2>

      <div
        className={classNames('storage-quota-track', {
          'storage-quota-track--near-limit': nearLimit,
        })}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${value}%`}
      >
        <div className="storage-quota-fill" style={{ width: `${value}%` }} />
      </div>

      <p className="storage-quota-usage">
        {t('x_mb_of_y_mb_used', {
          used: usedMB.toLocaleString('en-US'),
          total: totalMB.toLocaleString('en-US'),
        })}
      </p>
    </section>
  )
}

export default StorageQuota
