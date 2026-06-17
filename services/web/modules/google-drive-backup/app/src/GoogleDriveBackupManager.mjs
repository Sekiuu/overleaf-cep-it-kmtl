import path from 'node:path'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
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
 * Per-project Drive folder name. Normally just the (sanitized) project name, so
 * the folder is clean. Only when the same name is shared by another of the
 * user's projects do we append the project id to disambiguate, ensuring the two
 * never share a folder.
 */
function _folderName(project, hasNameClash) {
  const sanitized = _sanitizeName(project.name)
  return hasNameClash ? `${sanitized} (${project._id})` : sanitized
}

/**
 * Build a map of projectId -> Drive folder name for a set of the user's
 * projects, disambiguating only the names that collide (case-insensitive).
 */
function _buildFolderNameMap(projects) {
  const counts = new Map()
  for (const p of projects) {
    const key = _sanitizeName(p.name).toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const map = new Map()
  for (const p of projects) {
    const key = _sanitizeName(p.name).toLowerCase()
    map.set(p._id.toString(), _folderName(p, counts.get(key) > 1))
  }
  return map
}

/**
 * Resolve a single project's folder name when its siblings aren't already
 * known (standalone backupProject call): look up the owner's other projects and
 * disambiguate only on a real name clash.
 */
async function _resolveFolderName(project) {
  const sanitized = _sanitizeName(project.name)
  const siblings = await ProjectGetter.promises.findAllUsersProjects(
    project.owner_ref,
    { name: 1 }
  )
  const owned = siblings?.owned || []
  const clash = owned.some(
    p =>
      p._id.toString() !== project._id.toString() &&
      _sanitizeName(p.name).toLowerCase() === sanitized.toLowerCase()
  )
  return _folderName(project, clash)
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
  // The PDF is best-effort: a project that fails to compile (or a CLSI hiccup)
  // must not fail the whole backup, since the source files were already saved.
  try {
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
  } catch (err) {
    logger.warn(
      { err, projectId },
      'google-drive-backup: failed to compile/upload output.pdf, backing up sources only'
    )
    return false
  }
}

/**
 * Back up a single project to the user's Google Drive.
 *
 * Layout:  Overleaf ITKMITL / <project name> / <source files + output.pdf>
 * (the folder name gets a " (<projectId>)" suffix only when another of the
 * user's projects shares the same name).
 *
 * `options.folderName` lets a batch caller pass the pre-resolved name so the
 * sibling lookup isn't repeated per project.
 *
 * Returns a status string: 'success' | 'success-no-pdf' | 'insufficient-space'.
 */
async function backupProject(userId, projectId, options = {}) {
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

  const folderName = options.folderName || (await _resolveFolderName(project))

  const rootFolderId = await GoogleDriveApiClient.ensureFolder(
    accessToken,
    ROOT_FOLDER_NAME
  )
  const projectFolderId = await GoogleDriveApiClient.ensureFolder(
    accessToken,
    folderName,
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
    name: 1,
    archived: 1,
    trashed: 1,
  })
  // findAllUsersProjects returns { owned, readAndWrite, ... }; only back up owned
  // projects that are still active (skip the user's archived/trashed ones).
  const owned = (projects?.owned || []).filter(
    project => !ProjectHelper.isArchivedOrTrashed(project, userId)
  )
  // Resolve folder names up front so duplicate names are disambiguated and the
  // sibling lookup isn't repeated per project.
  const folderNames = _buildFolderNameMap(owned)

  const results = []
  let sawInsufficientSpace = false
  let sawError = false

  for (const project of owned) {
    try {
      const status = await backupProject(userId, project._id, {
        folderName: folderNames.get(project._id.toString()),
      })
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
      results.push({
        projectId: project._id,
        status: 'error',
        error: err.message,
      })
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
