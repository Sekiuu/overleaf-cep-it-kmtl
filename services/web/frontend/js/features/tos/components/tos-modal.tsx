import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLNotification from '@/shared/components/ol/ol-notification'
import { postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'

// Dummy placeholder Terms of Service text. Replace with the real terms.
const TOS_PARAGRAPHS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. These Terms of Service ("Terms") govern your access to and use of this service. By using the service you agree to be bound by these Terms.',
  '1. Acceptance of terms. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  '2. Use of the service. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. You agree to use the service only for lawful purposes and in accordance with these Terms.',
  '3. User content. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. You retain ownership of any content you submit, post or display on or through the service.',
  '4. Privacy. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
  '5. Termination. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit. We may suspend or terminate your access to the service at any time, with or without cause.',
  '6. Changes to these terms. At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium. We may revise these Terms from time to time and will notify you of material changes.',
]

export default function TosModal() {
  const { t } = useTranslation()
  const [show, setShow] = useState(() => !getMeta('ol-tosAccepted'))
  const [accepted, setAccepted] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [error, setError] = useState(false)

  const handleAccept = useCallback(async () => {
    setIsAccepting(true)
    setError(false)
    try {
      await postJSON('/user/tos/accept')
      setShow(false)
    } catch (e) {
      setError(true)
      setIsAccepting(false)
    }
  }, [])

  if (!show) {
    return null
  }

  return (
    <OLModal
      show={show}
      // The user must accept before continuing, so prevent dismissal.
      onHide={() => {}}
      backdrop="static"
      keyboard={false}
      clickOutsideDeactivates={false}
      size="lg"
    >
      <OLModalHeader closeButton={false}>
        <OLModalTitle>{t('terms_of_service')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <div
          className="tos-modal-content"
          style={{ maxHeight: '40vh', overflowY: 'auto' }}
          tabIndex={0}
        >
          {TOS_PARAGRAPHS.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        {error && (
          <OLNotification
            type="error"
            content={t('generic_something_went_wrong')}
            className="mt-3"
          />
        )}

        <OLFormCheckbox
          id="tos-accept-checkbox"
          className="mt-3"
          checked={accepted}
          onChange={e => setAccepted(e.target.checked)}
          label={t('i_have_read_and_accept_the_terms_of_service')}
        />
      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="primary"
          disabled={!accepted}
          isLoading={isAccepting}
          onClick={handleAccept}
        >
          {t('accept_and_continue')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
