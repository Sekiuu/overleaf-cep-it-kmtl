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
  'ข้อตกลงการให้บริการ (Terms of Service) - Overleaf IT KMITL',
  '1. การยอมรับข้อตกลง (Acceptance of Terms): การเข้าถึงและใช้งานระบบ Overleaf ของคณะเทคโนโลยีสารสนเทศ สจล. (IT KMITL) ถือว่าผู้ใช้งานตกลงและยอมรับที่จะปฏิบัติตามข้อตกลงการให้บริการฉบับนี้ หากคุณไม่ยินยอมตามเงื่อนไข โปรดงดเว้นการใช้งานระบบ',
  '2. การใช้งานระบบและเทมเพลต (Use of the Service & Templates): ผู้ใช้งานตกลงที่จะใช้ระบบเพื่อวัตถุประสงค์ทางการศึกษา การวิจัย และถูกต้องตามกฎหมายรวมถึงระเบียบของสถาบันเท่านั้น ระบบได้จัดเตรียมเทมเพลตเอกสารเพื่ออำนวยความสะดวก ทั้งนี้ ผู้ใช้งานเป็นผู้รับผิดชอบในการตรวจสอบความถูกต้องของรูปแบบเอกสารขั้นสุดท้ายก่อนนำไปใช้งานจริง',
  '3. เนื้อหาและลิขสิทธิ์ของผู้ใช้งาน (User Content & Ownership): ผู้ใช้งานยังคงเป็นเจ้าของลิขสิทธิ์ในเนื้อหา โค้ด LaTeX และข้อมูลใดๆ ที่ทำการสร้าง อัปโหลด หรือจัดเก็บไว้ในระบบอย่างสมบูรณ์ ทางผู้ดูแลระบบไม่มีสิทธิ์ในการนำข้อมูลไปทำซ้ำหรือแสวงหาผลประโยชน์อื่นใด',
  '4. ระบบสำรองข้อมูล (Data Backup): เพื่อป้องกันการสูญหายของข้อมูล 1) Google Drive Backup: หากเปิดใช้งาน ถือว่ายินยอมให้ระบบเชื่อมต่อกับบัญชี Google Drive โดยระบบจะขอสิทธิ์เฉพาะการสร้างและอัปโหลดไฟล์โปรเจกต์เท่านั้น 2) NAS Backup (Upcoming Feature): ระบบอยู่ระหว่างการพัฒนากระบวนการสำรองข้อมูลไปยังเซิร์ฟเวอร์ NAS ภายในเครือข่ายของคณะฯ',
  '5. ความเป็นส่วนตัวและข้อมูลส่วนบุคคล (Privacy): ข้อมูลโปรเจกต์และบัญชีผู้ใช้งานจะถูกจัดการด้วยความระมัดระวัง ข้อมูลที่เก็บรวบรวมผ่านระบบและการเชื่อมต่อ API จะถูกนำมาใช้เพื่อวัตถุประสงค์ในการให้บริการ การสำรองข้อมูล และปรับปรุงประสิทธิภาพของระบบเท่านั้น',
  '6. การระงับการให้บริการ (Termination): ผู้ดูแลระบบขอสงวนสิทธิ์ในการระงับบัญชีหรือยกเลิกการเข้าถึงระบบ ในกรณีที่ตรวจพบการใช้งานที่ละเมิดข้อตกลง ก่อกวนระบบ ทำลายความปลอดภัย หรือใช้งานทรัพยากรเซิร์ฟเวอร์ในทางที่ผิด',
  '7. การเปลี่ยนแปลงข้อตกลง (Changes to These Terms): ทางทีมพัฒนาอาจมีการปรับปรุงแก้ไขข้อตกลงการให้บริการเป็นครั้งคราว (เช่น เมื่อระบบ NAS Backup เปิดใช้งานอย่างเป็นทางการ) หากมีการเปลี่ยนแปลงที่มีนัยสำคัญ เราจะแจ้งให้ผู้ใช้งานทราบ'
];

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
