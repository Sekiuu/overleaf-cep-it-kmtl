import { useCallback, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { sendMB } from '../../../../infrastructure/event-tracking'
import getMeta from '../../../../utils/meta'
import { NewProjectButtonModalVariant } from '../new-project-button/new-project-button-modal'
import {
  Dropdown,
  DropdownDivider,
  DropdownHeader,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from '@/shared/components/dropdown/dropdown-menu'
import createNewProjectImage from '../../images/create-a-new-project.svg'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import MaterialIcon from '@/shared/components/material-icon'

const CustomDropdownToggle = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'>
>(({ onClick, 'aria-expanded': ariaExpanded }, ref) => {
  const { t } = useTranslation()

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    onClick?.(e)

    sendMB('welcome-page-create-first-project-click', {
      dropdownMenu: 'main-button',
      dropdownOpen: ariaExpanded,
    })
  }

  return (
    <button
      ref={ref}
      className="card welcome-message-card"
      onClick={handleClick}
      id="create-new-project-dropdown-button"
      aria-expanded={ariaExpanded}
      aria-haspopup="true"
    >
      <span>{t('create_a_new_project')}</span>
      <img
        className="welcome-message-card-img"
        src={createNewProjectImage}
        aria-hidden="true"
        alt=""
      />
    </button>
  )
})
CustomDropdownToggle.displayName = 'CustomDropdownToggle'

type WelcomeMessageCreateNewProjectDropdownProps = {
  setActiveModal: (modal: NewProjectButtonModalVariant) => void
}

function WelcomeMessageCreateNewProjectDropdown({
  setActiveModal,
}: WelcomeMessageCreateNewProjectDropdownProps) {
  const { t } = useTranslation()
  const portalTemplates = getMeta('ol-portalTemplates') || []
  const { templateLinks } = getMeta('ol-ExposedSettings')
  const docxImportEnabled =
    useFeatureFlag('import-docx') &&
    getMeta('ol-ExposedSettings').enablePandocConversions
  const markdownImportEnabled =
    useFeatureFlag('import-markdown') &&
    getMeta('ol-ExposedSettings').enablePandocConversions

  const { isOverleaf } = getMeta('ol-ExposedSettings')

  const handleDropdownItemClick = useCallback(
    (
      e: React.MouseEvent,
      modalVariant: NewProjectButtonModalVariant,
      dropdownMenuEvent: string
    ) => {
      // prevent firing the main dropdown onClick event
      e.stopPropagation()

      sendMB('welcome-page-create-first-project-click', {
        dropdownOpen: true,
        dropdownMenu: dropdownMenuEvent,
      })
      setActiveModal(modalVariant)
    },
    [setActiveModal]
  )

  const handlePortalTemplateClick = useCallback(
    (e: React.MouseEvent, institutionTemplateName: string) => {
      // prevent firing the main dropdown onClick event
      e.stopPropagation()

      sendMB('welcome-page-create-first-project-click', {
        dropdownMenu: 'institution-template',
        dropdownOpen: true,
        institutionTemplateName,
      })
    },
    []
  )

  const handleTemplateLinkClick = useCallback(
    (e: React.MouseEvent, dropdownMenuEvent: string) => {
      // prevent firing the main dropdown onClick event
      e.stopPropagation()

      sendMB('welcome-page-create-first-project-click', {
        dropdownMenu: dropdownMenuEvent,
        dropdownOpen: true,
      })
    },
    []
  )

  return (
    <Dropdown className="welcome-message-card-item">
      <DropdownToggle
        as={CustomDropdownToggle}
        id="create-new-project-dropdown-toggle-btn"
      />
      <DropdownMenu flip={false} className="create-new-project-dropdown">
        <li role="none">
          <DropdownItem
            as="button"
            onClick={e =>
              handleDropdownItemClick(e, 'upload_project', 'upload-project')
            }
            tabIndex={-1}
          >
            {t('upload_project')}
          </DropdownItem>
        </li>
        {docxImportEnabled && (
          <li role="none">
            <DropdownItem
              as="button"
              onClick={e =>
                handleDropdownItemClick(e, 'import_docx', 'import-docx')
              }
              tabIndex={-1}
              trailingIcon={<MaterialIcon type="fiber_new" />}
            >
              {t('import_word_document')}
            </DropdownItem>
          </li>
        )}
        {markdownImportEnabled && (
          <li role="none">
            <DropdownItem
              as="button"
              onClick={e =>
                handleDropdownItemClick(e, 'import_markdown', 'import-markdown')
              }
              tabIndex={-1}
              trailingIcon={<MaterialIcon type="fiber_new" />}
            >
              {t('import_markdown_file')}
            </DropdownItem>
          </li>
        )}
        {isOverleaf && (
          <li role="none">
            <DropdownItem
              as="button"
              onClick={e =>
                handleDropdownItemClick(
                  e,
                  'import_from_github',
                  'import-from-github'
                )
              }
              tabIndex={-1}
            >
              {t('import_from_github')}
            </DropdownItem>
          </li>
        )}
        {(portalTemplates?.length ?? 0) > 0 ? (
          <>
            <DropdownDivider />
            <DropdownHeader aria-hidden="true">
              {t('institution_templates')}
            </DropdownHeader>
            {portalTemplates?.map((portalTemplate, index) => (
              <DropdownItem
                key={`portal-template-${index}`}
                onClick={e => handlePortalTemplateClick(e, portalTemplate.name)}
                href={`${portalTemplate.url}#templates`}
              >
                {portalTemplate.name}
              </DropdownItem>
            ))}
          </>
        ) : null}
        {templateLinks && templateLinks.length > 0 && (
          <>
            <DropdownDivider />
            <DropdownHeader aria-hidden="true">{t('templates')}</DropdownHeader>
            {templateLinks.map((templateLink, index) => (
              <li role="none" key={`welcome-template-${index}`}>
                <DropdownItem
                  href={templateLink.url}
                  onClick={e => handleTemplateLinkClick(e, templateLink.name)}
                  aria-label={`${templateLink.name} ${t('template')}`}
                >
                  {templateLink.name === 'view_all'
                    ? t('view_all')
                    : templateLink.name}
                </DropdownItem>
              </li>
            ))}
          </>
        )}
      </DropdownMenu>
    </Dropdown>
  )
}

export default WelcomeMessageCreateNewProjectDropdown
