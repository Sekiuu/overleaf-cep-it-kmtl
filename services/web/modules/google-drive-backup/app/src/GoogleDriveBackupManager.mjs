import path from 'node:path'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.mjs'
import ClsiManager from '../../../../app/src/Features/Compile/ClsiManager.mjs'
import GoogleDriveApiClient from './GoogleDriveApiClient.mjs'
import GoogleDriveTokenStore from './GoogleDriveTokenStore.mjs'

const ROOT_FOLDER_NAME = 'Overleaf ITKMITL'
const ONE_GIB = 1024 * 1024 * 1024

export class GoogleDriveNotLinkedError extends Error {
  constructor(message = 'Google Drive account not linked') {
    super(message)
    this.name = 'GoogleDriveNotLinkedError'
  }
}

function _minFreeBytes() {
  return Settings.googleDriveBackup?.minFreeBytes ?? ONE_GIB
}

// Drive treats "/" as a path separator, so strip it from individual names.
function _sanitizeName(name) {
  return name.replace(/[/\\]/g, '_').trim() || 'untitled'
}

/**
 * Per-project folder name. The project id is appended so that two projects with
 * the same title never share a Drive folder, and so re-runs after a rename still
 * resolve to the same folder (overwrite-in-place).
 */
function _projectFolderName(project) {
  return `${_sanitizeName(project.name)} (${project._id})`
}

/**
 * Ensure the nested folder chain for a relative file path exists, returning the
 * id of the folder that should contain the file. `folderCache` memoises folder
 * ids within a single backup run to avoid redundant Drive calls.
 */
async function _ensurePathFolders(
  accessToken,
  projectFolderId,
  relativePath,
  folderCache
) {
  const dir = path.dirname(relativePath)
  if (dir === '.' || dir === '/' || dir === '') {
    return projectFolderId
  }
  const segments = dir.split('/').filter(Boolean)
  let parentId = projectFolderId
  let cacheKey = ''
  for (const segment of segments) {
    cacheKey += `/${segment}`
    let folderId = folderCache.get(cacheKey)
    if (!folderId) {
      folderId = await GoogleDriveApiClient.ensureFolder(
        accessToken,
        _sanitizeName(segment),
        parentId
      )
      folderCache.set(cacheKey, folderId)
    }
    parentId = folderId
  }
  return parentId
}

function _stripLeadingSlash(p) {
  return p[0] === '/' ? p.slice(1) : p
}

async function _backupSourceFiles(accessToken, projectId, projectFolderId) {
  const folderCache = new Map()

  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
  for (const [docPath, doc] of Object.entries(docs)) {
    const relativePath = _stripLeadingSlash(docPath)
    const parentId = await _ensurePathFolders(
      accessToken,
      projectFolderId,
      relativePath,
      folderCache
    )
    await GoogleDriveApiClient.upsertFile(accessToken, {
      name: path.basename(relativePath),
      parentId,
      mimeType: 'text/plain; charset=UTF-8',
      content: Buffer.from(doc.lines.join('\n'), 'utf8'),
    })
  }

  const files = await ProjectEntityHandler.promises.getAllFiles(projectId)
  for (const [filePath, file] of Object.entries(files)) {
    const relativePath = _stripLeadingSlash(filePath)
    const parentId = await _ensurePathFolders(
      accessToken,
      projectFolderId,
      relativePath,
      folderCache
    )
    const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash
    )
    const content = await streamToBuffer(stream)
    await GoogleDriveApiClient.upsertFile(accessToken, {
      name: path.basename(relativePath),
      parentId,
      mimeType: 'application/octet-stream',
      content,
    })
  }
}

/**
 * Compile the project if needed and upload the resulting output.pdf.
 * Returns true if a PDF was uploaded, false otherwise (compile not successful).
 */
async function _backupOutputPdf(
  accessToken,
  projectId,
  ownerId,
  projectFolderId
) {
  const result = await CompileManager.promises.compile(projectId, ownerId, {
    isAutoCompile: false,
  })
  if (result.status !== 'success') {
    logger.info(
      { projectId, status: result.status },
      'google-drive-backup: skipping output.pdf, compile not successful'
    )
    return false
  }
  const hasPdf = (result.outputFiles || []).some(f => f.path === 'output.pdf')
  if (!hasPdf) {
    logger.info(
      { projectId },
      'google-drive-backup: compile produced no output.pdf'
    )
    return false
  }
  const stream = await ClsiManager.promises.getOutputFileStream(
    projectId,
    ownerId,
    result.clsiServerId,
    result.buildId,
    'output.pdf'
  )
  const content = await streamToBuffer(stream)
  await GoogleDriveApiClient.upsertFile(accessToken, {
    name: 'output.pdf',
    parentId: projectFolderId,
    mimeType: 'application/pdf',
    content,
  })
  return true
}

/**
 * Back up a single project to the user's Google Drive.
 *
 * Layout:  Overleaf ITKMITL / <project name> (<projectId>) / <source files + output.pdf>
 *
 * Returns a status string: 'success' | 'success-no-pdf' | 'insufficient-space'.
 */
async function backupProject(userId, projectId) {
  const refreshToken = await GoogleDriveTokenStore.getRefreshToken(userId)
  if (!refreshToken) {
    throw new GoogleDriveNotLinkedError()
  }

  const accessToken = await GoogleDriveApiClient.getAccessToken(refreshToken)

  // Require at least 1 GiB of free Drive space before doing anything.
  const { free } = await GoogleDriveApiClient.getStorageQuota(accessToken)
  if (free != null && free < _minFreeBytes()) {
    logger.warn(
      { userId, projectId, free, required: _minFreeBytes() },
      'google-drive-backup: insufficient free space, aborting'
    )
    return 'insufficient-space'
  }

  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    owner_ref: 1,
  })
  if (!project) {
    throw new OError('project not found', { projectId })
  }

  const rootFolderId = await GoogleDriveApiClient.ensureFolder(
    accessToken,
    ROOT_FOLDER_NAME
  )
  const projectFolderId = await GoogleDriveApiClient.ensureFolder(
    accessToken,
    _projectFolderName(project),
    rootFolderId
  )

  await _backupSourceFiles(accessToken, projectId, projectFolderId)

  const pdfUploaded = await _backupOutputPdf(
    accessToken,
    projectId,
    project.owner_ref,
    projectFolderId
  )

  return pdfUploaded ? 'success' : 'success-no-pdf'
}

/**
 * Back up every project owned by the user, recording the overall outcome on the
 * user record. Returns a per-project summary.
 */
async function backupAllProjectsForUser(userId) {
  const projects = await ProjectGetter.promises.findAllUsersProjects(userId, {
    _id: 1,
  })
  // findAllUsersProjects returns { owned, readAndWrite, ... }; only back up owned.
  const owned = projects?.owned || []

  const results = []
  let sawInsufficientSpace = false
  let sawError = false

  for (const project of owned) {
    try {
      const status = await backupProject(userId, project._id)
      if (status === 'insufficient-space') {
        sawInsufficientSpace = true
        results.push({ projectId: project._id, status })
        // No point continuing once the drive is full.
        break
      }
      results.push({ projectId: project._id, status })
    } catch (err) {
      sawError = true
      logger.error(
        { err, userId, projectId: project._id },
        'google-drive-backup: failed to back up project'
      )
      results.push({ projectId: project._id, status: 'error' })
    }
  }

  let overallStatus = 'success'
  if (sawInsufficientSpace) {
    overallStatus = 'insufficient-space'
  } else if (sawError) {
    overallStatus = 'partial-error'
  }
  await GoogleDriveTokenStore.recordBackupResult(userId, overallStatus)

  return { status: overallStatus, results }
}

export default {
  backupProject,
  backupAllProjectsForUser,
  GoogleDriveNotLinkedError,
  ROOT_FOLDER_NAME,
}
