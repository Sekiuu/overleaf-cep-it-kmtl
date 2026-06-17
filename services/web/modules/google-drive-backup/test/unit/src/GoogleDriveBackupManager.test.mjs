import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'node:path'
import sinon from 'sinon'

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/src/GoogleDriveBackupManager.mjs'
)

const ONE_GIB = 1024 * 1024 * 1024

describe('GoogleDriveBackupManager', function () {
  beforeEach(async function (ctx) {
    ctx.userId = 'user-123'
    ctx.projectId = 'proj-456'

    ctx.Settings = { googleDriveBackup: { minFreeBytes: ONE_GIB } }
    vi.doMock('@overleaf/settings', () => ({ default: ctx.Settings }))
    vi.doMock('@overleaf/logger', () => ({
      default: { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    }))

    ctx.GoogleDriveApiClient = {
      getAccessToken: sinon.stub().resolves('access-token'),
      getStorageQuota: sinon.stub().resolves({ limit: null, usage: 0, free: null }),
      ensureFolder: sinon.stub(),
      upsertFile: sinon.stub().resolves({ id: 'file-id' }),
    }
    // Root folder, then project folder.
    ctx.GoogleDriveApiClient.ensureFolder
      .onFirstCall()
      .resolves('root-folder-id')
      .onSecondCall()
      .resolves('project-folder-id')
    vi.doMock('../../../app/src/GoogleDriveApiClient.mjs', () => ({
      default: ctx.GoogleDriveApiClient,
    }))

    ctx.GoogleDriveTokenStore = {
      getRefreshToken: sinon.stub().resolves('refresh-token'),
      recordBackupResult: sinon.stub().resolves(),
    }
    vi.doMock('../../../app/src/GoogleDriveTokenStore.mjs', () => ({
      default: ctx.GoogleDriveTokenStore,
    }))

    ctx.ProjectGetter = {
      promises: {
        getProject: sinon
          .stub()
          .resolves({ _id: ctx.projectId, name: 'My Paper', owner_ref: ctx.userId }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
      default: ctx.ProjectGetter,
    }))

    ctx.ProjectEntityHandler = {
      promises: {
        getAllDocs: sinon
          .stub()
          .resolves({ '/main.tex': { lines: ['\\documentclass{article}'] } }),
        getAllFiles: sinon.stub().resolves({}),
      },
    }
    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs',
      () => ({ default: ctx.ProjectEntityHandler })
    )

    ctx.HistoryManager = {
      promises: { requestBlobWithProjectId: sinon.stub() },
    }
    vi.doMock('../../../../../app/src/Features/History/HistoryManager.mjs', () => ({
      default: ctx.HistoryManager,
    }))

    ctx.CompileManager = {
      promises: {
        compile: sinon.stub().resolves({ status: 'failure', outputFiles: [] }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Compile/CompileManager.mjs', () => ({
      default: ctx.CompileManager,
    }))

    ctx.ClsiManager = { promises: { getOutputFileStream: sinon.stub() } }
    vi.doMock('../../../../../app/src/Features/Compile/ClsiManager.mjs', () => ({
      default: ctx.ClsiManager,
    }))

    ctx.GoogleDriveBackupManager = (await import(modulePath)).default
  })

  describe('backupProject', function () {
    it('aborts when free space is below the 1 GiB threshold', async function (ctx) {
      ctx.GoogleDriveApiClient.getStorageQuota.resolves({
        limit: 2 * ONE_GIB,
        usage: 2 * ONE_GIB - 1, // < 1 GiB free
        free: 1,
      })

      const status = await ctx.GoogleDriveBackupManager.backupProject(
        ctx.userId,
        ctx.projectId
      )

      expect(status).to.equal('insufficient-space')
      expect(ctx.GoogleDriveApiClient.ensureFolder.called).to.be.false
      expect(ctx.GoogleDriveApiClient.upsertFile.called).to.be.false
    })

    it('creates the folder tree and uploads source files', async function (ctx) {
      const status = await ctx.GoogleDriveBackupManager.backupProject(
        ctx.userId,
        ctx.projectId
      )

      // root + project folder created
      expect(ctx.GoogleDriveApiClient.ensureFolder.firstCall.args[1]).to.equal(
        'Overleaf ITKMITL'
      )
      expect(
        ctx.GoogleDriveApiClient.ensureFolder.secondCall.args[1]
      ).to.equal(`My Paper (${ctx.projectId})`)

      // doc uploaded into the project folder
      const uploadArgs = ctx.GoogleDriveApiClient.upsertFile.firstCall.args[1]
      expect(uploadArgs.name).to.equal('main.tex')
      expect(uploadArgs.parentId).to.equal('project-folder-id')

      // compile did not succeed -> no pdf
      expect(status).to.equal('success-no-pdf')
    })

    it('uploads output.pdf when the compile succeeds', async function (ctx) {
      ctx.CompileManager.promises.compile.resolves({
        status: 'success',
        outputFiles: [{ path: 'output.pdf' }],
        buildId: 'build-1',
        clsiServerId: 'clsi-1',
      })
      // Minimal readable stream for the PDF bytes.
      const { Readable } = await import('node:stream')
      ctx.ClsiManager.promises.getOutputFileStream.resolves(
        Readable.from([Buffer.from('%PDF-1.7')])
      )

      const status = await ctx.GoogleDriveBackupManager.backupProject(
        ctx.userId,
        ctx.projectId
      )

      expect(status).to.equal('success')
      const pdfCall = ctx.GoogleDriveApiClient.upsertFile
        .getCalls()
        .find(c => c.args[1].name === 'output.pdf')
      expect(pdfCall).to.exist
      expect(pdfCall.args[1].mimeType).to.equal('application/pdf')
    })

    it('throws when the user has not linked Google Drive', async function (ctx) {
      ctx.GoogleDriveTokenStore.getRefreshToken.resolves(null)
      await expect(
        ctx.GoogleDriveBackupManager.backupProject(ctx.userId, ctx.projectId)
      ).to.be.rejectedWith(/not linked/)
    })
  })
})
