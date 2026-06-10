import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import ExitButton from './exit-button'

type TermAndConditionModalProps = {
  showModal: boolean
  handleCloseModal: () => void
  onAccept?: () => void | Promise<void>
  title?: string
  content?: React.ReactNode | string
  acceptButtonText?: string
  loading?: boolean
}

function TermAndConditionModal({
  showModal,
  handleCloseModal,
  onAccept,
  title,
  content,
  acceptButtonText,
  loading = false,
}: TermAndConditionModalProps) {
  const { t } = useTranslation()
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (!showModal) {
      setIsProcessing(false)
    }
  }, [showModal])

  const handleAccept = async () => {
    setIsProcessing(true)
    try {
      if (onAccept) {
        await onAccept()
      }
      handleCloseModal()
    } catch (error) {
      console.error('Error accepting terms and conditions:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <OLModal
      animation
      show={showModal}
      onHide={handleCloseModal}
      id="term-and-condition-modal"
      backdrop="static"
      centered
    >
      <OLModalHeader>
        <OLModalTitle>{title || t('terms_and_conditions')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <div className="term-and-condition-content">
          {typeof content === 'string' ? (
            <p>{content}</p>
          ) : (
            content || <p>{t('please_read_and_accept_terms')}</p>
          )}
        </div>
      </OLModalBody>
      <OLModalFooter>
        <ExitButton
          onClick={handleCloseModal}
          disabled={isProcessing || loading}
          variant="secondary"
        />
        <OLButton
          variant="primary"
          onClick={handleAccept}
          disabled={isProcessing || loading}
        >
          {acceptButtonText || t('accept')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default TermAndConditionModal
