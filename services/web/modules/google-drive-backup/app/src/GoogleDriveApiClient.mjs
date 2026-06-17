import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchJson } from '@overleaf/fetch-utils'

/**
 * Thin client over the Google OAuth2 + Drive v3 REST APIs.
 *
 * Uses the least-privilege `drive.file` scope: the app can only see and manage
 * files it created itself, which is exactly the "Overleaf ITKMITL" folder tree
 * this module builds. The storage-quota check (about.get) is still available
 * under this scope.
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
// Request openid + email alongside drive.file so the token response includes an
// id_token we can use to verify which Google account was linked.
const OAUTH_SCOPES = `openid email ${DRIVE_SCOPE}`

const REQUEST_TIMEOUT_MS = 60 * 1000

function _config() {
  const cfg = Settings.googleDriveBackup || {}
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new OError('Google Drive backup is not configured', {
      hasClientId: Boolean(cfg.clientId),
      hasClientSecret: Boolean(cfg.clientSecret),
      hasRedirectUri: Boolean(cfg.redirectUri),
    })
  }
  return cfg
}

/**
 * Build the Google consent screen URL the user is redirected to when linking.
 * `access_type=offline` + `prompt=consent` ensures we always receive a refresh
 * token we can use later from the background scheduler.
 */
function getAuthorizationUrl(state) {
  const cfg = _config()
  const url = new URL(OAUTH_AUTH_URL)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', OAUTH_SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  // Restrict the account chooser to the institutional Workspace domain. Google's
  // `hd` accepts only a single domain, so this is only a UX hint and only when
  // exactly one domain is allowed. The domain is always verified server-side
  // after the exchange (and `hd` can be tampered with anyway).
  const allowedDomains = cfg.allowedDomains || []
  if (allowedDomains.length === 1) {
    url.searchParams.set('hd', allowedDomains[0])
  }
  if (state) {
    url.searchParams.set('state', state)
  }
  return url.toString()
}

async function _postForm(body) {
  return await fetchJson(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Decode the payload of a Google id_token (a JWT). The token is delivered
 * directly from Google's token endpoint over TLS in a server-to-server
 * exchange, so signature verification is not required to trust the claims
 * (per Google's OpenID Connect guidance). Returns {} on any parse failure.
 */
function _decodeIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return {}
  }
  const parts = idToken.split('.')
  if (parts.length < 2) {
    return {}
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

/**
 * Exchange an authorization code (from the OAuth callback) for tokens.
 * Returns { accessToken, refreshToken, expiresIn, email, hostedDomain }.
 */
async function exchangeCodeForTokens(code) {
  const cfg = _config()
  try {
    const data = await _postForm({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    })
    const claims = _decodeIdToken(data.id_token)
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      email: claims.email,
      hostedDomain: claims.hd,
    }
  } catch (err) {
    throw OError.tag(err, 'failed to exchange Google authorization code')
  }
}

/**
 * Use a stored refresh token to obtain a fresh short-lived access token.
 */
async function getAccessToken(refreshToken) {
  const cfg = _config()
  try {
    const data = await _postForm({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    })
    return data.access_token
  } catch (err) {
    throw OError.tag(err, 'failed to refresh Google access token')
  }
}

async function _driveRequest(accessToken, path, opts = {}) {
  const base = opts.upload ? DRIVE_UPLOAD_API : DRIVE_API
  const url = `${base}${path}`
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ...(opts.headers || {}),
  }
  return await fetchJson(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
    json: opts.json,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Read the account's storage quota.
 * Returns { limit, usage, free } in bytes. `limit`/`free` are null for
 * unlimited-storage accounts (e.g. some Workspace plans).
 */
async function getStorageQuota(accessToken) {
  const data = await _driveRequest(
    accessToken,
    '/about?fields=storageQuota'
  )
  const quota = data.storageQuota || {}
  const usage = quota.usage != null ? Number(quota.usage) : 0
  // `limit` is omitted by the API when storage is unlimited.
  const limit = quota.limit != null ? Number(quota.limit) : null
  const free = limit != null ? Math.max(limit - usage, 0) : null
  return { limit, usage, free }
}

// Escape a value for use inside a Drive query string literal.
function _escapeQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Find a non-trashed file/folder by exact name within a parent.
 * Returns the file id, or null. With the `drive.file` scope this only ever
 * matches files this app created.
 */
async function _findChild(accessToken, name, parentId, mimeType) {
  const clauses = [
    `name = '${_escapeQueryValue(name)}'`,
    'trashed = false',
  ]
  if (parentId) {
    clauses.push(`'${_escapeQueryValue(parentId)}' in parents`)
  }
  if (mimeType) {
    clauses.push(`mimeType = '${_escapeQueryValue(mimeType)}'`)
  }
  const q = clauses.join(' and ')
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: '1',
  })
  const data = await _driveRequest(accessToken, `/files?${params.toString()}`)
  return data.files?.[0]?.id || null
}

/**
 * Ensure a folder with the given name exists under `parentId` (or in the root
 * when parentId is omitted), creating it if necessary. Returns its id.
 */
async function ensureFolder(accessToken, name, parentId) {
  const existing = await _findChild(
    accessToken,
    name,
    parentId,
    FOLDER_MIME_TYPE
  )
  if (existing) {
    return existing
  }
  const metadata = {
    name,
    mimeType: FOLDER_MIME_TYPE,
  }
  if (parentId) {
    metadata.parents = [parentId]
  }
  const created = await _driveRequest(accessToken, '/files?fields=id', {
    method: 'POST',
    json: metadata,
  })
  return created.id
}

/**
 * Create or update a file by name within `parentId` (overwrite-in-place).
 * `content` must be a Buffer.
 */
async function upsertFile(accessToken, { name, parentId, mimeType, content }) {
  const existingId = await _findChild(accessToken, name, parentId)
  const boundary = `overleaf-itkmitl-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`

  if (existingId) {
    // Update the contents of the existing file in place.
    return await _driveRequest(
      accessToken,
      `/files/${existingId}?uploadType=media&fields=id`,
      {
        upload: true,
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: content,
      }
    )
  }

  // Multipart create: metadata part + media part in a single request.
  const metadata = { name, parents: parentId ? [parentId] : undefined }
  const parts = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return await _driveRequest(accessToken, '/files?uploadType=multipart&fields=id', {
    upload: true,
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: parts,
  })
}

export default {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getAccessToken,
  getStorageQuota,
  ensureFolder,
  upsertFile,
  DRIVE_SCOPE,
  FOLDER_MIME_TYPE,
}
