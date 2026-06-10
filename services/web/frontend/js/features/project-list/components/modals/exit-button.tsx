import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'

type ExitButtonProps = {
  onClick: () => void
  disabled?: boolean
  className?: string
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

function ExitButton({
  onClick,
  disabled = false,
  className = '',
  variant = 'secondary',
  size = 'md',
}: ExitButtonProps) {
  const { t } = useTranslation()

  return (
    <OLButton
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={className}
      size={size}
    >
      {t('close')}
    </OLButton>
  )
}

export default ExitButton
