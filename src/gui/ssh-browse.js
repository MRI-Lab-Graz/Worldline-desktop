import { execFile } from 'node:child_process'

// Browse folders on a server over the computer's own `ssh`. Read-only: it only lists folder names.
// The address comes from the user's text, so it is checked before it gets near ssh or a remote shell:
// the host cannot start with "-", the path has a short list of allowed characters (no quotes, no
// shell characters, no ".."), and ssh never asks for a password (BatchMode): it uses the user's key.
const HOST = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$/
// Letters, marks (macOS stores umlauts as letter + mark) and digits of any language, plus a few safe symbols. No quotes,
// shell characters, control, invisible or look-alike characters. Safe inside the single quotes of the remote command.
export const SEGMENT = /^[\p{L}\p{M}\p{N} ._+@=,:~()-]+$/u
export const isOpenableName = (name) => SEGMENT.test(name) && name !== '.' && name !== '..'
const MAX_FOLDERS = 1000
const MAX_OUTPUT_BYTES = 1024 * 1024
const TIMEOUT_MS = 60_000 // a VPN that has been idle can need a while for the first connection; ssh itself gives up first (ConnectTimeout)

export function parseSshAddress(text) {
  const match = /^ssh:\/\/([^/]+)(\/.*)?$/.exec(String(text ?? '').trim())
  if (!match || !HOST.test(match[1])) return null
  let path
  try {
    path = decodeURIComponent(match[2] ?? '/')
  } catch {
    return null
  }
  const segments = path.split('/').filter((segment) => segment !== '')
  if (!segments.every(isOpenableName)) return null
  return { host: match[1], path: `/${segments.join('/')}` }
}

export function parentOf(path) {
  if (path === '/') return null
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

export function sshBrowseArgs({ host, path }) {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '--', host, `cd -- '${path}' && ls -1Ap`]
}

// `ls -p` marks folders with a trailing slash. Hidden and oddly named entries are left out.
export function parseFolderListing(stdout) {
  const folders = []
  for (const line of String(stdout).split('\n')) {
    if (!line.endsWith('/')) continue
    const name = line.slice(0, -1)
    if (name.startsWith('.') || !isOpenableName(name)) continue
    folders.push(name)
    if (folders.length >= MAX_FOLDERS) break
  }
  return folders
}

// NoDefaultCurrentDirectoryInExePath: on Windows a program name is looked up in the current folder first; this
// stops a planted ssh.exe there from running (process-runner.js does the same for git and datalad).
export function sshExecOptions(env = process.env) {
  return { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' } }
}

export function runSsh(args) {
  return new Promise((resolve, reject) => {
    execFile('ssh', args, sshExecOptions(), (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') return reject(error)
      resolve({ code: typeof error?.code === 'number' ? error.code : error ? 255 : 0, stdout, stderr, timedOut: Boolean(error?.killed) })
    })
  })
}

// Plain words for the usual failures. The server's own text is only looked at, never shown.
function explain({ stderr = '', timedOut }, host) {
  if (timedOut) return 'The server did not answer in time. Check the address and your network or VPN.'
  if (/permission denied/i.test(stderr)) return 'The server did not accept your key. This browser cannot ask for a password: set up key login for this server first.'
  if (/host key verification failed|REMOTE HOST IDENTIFICATION/i.test(stderr)) return 'This computer does not know the server yet. Connect once in a terminal (ssh the-server), accept its fingerprint, then try again.'
  if (/could not resolve|name or service not known|nodename nor servname/i.test(stderr)) {
    return `This computer does not know a server called "${host}". Use the server's full name or number in the address, or add it to your SSH config file (Host ${host}, HostName ..., User ...).`
  }
  if (/no route|connection (refused|timed out)|network is unreachable/i.test(stderr)) return 'Cannot reach the server. Check your network or VPN.'
  if (/no such file|not a directory/i.test(stderr)) return 'This folder does not exist on the server.'
  return 'Could not list the folders on the server.'
}

export async function listSshFolders(address, { run = runSsh } = {}) {
  const parsed = parseSshAddress(address)
  if (!parsed) throw new Error('Type the address like ssh://server/folder/path first.')
  let result
  try {
    result = await run(sshBrowseArgs(parsed))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('OpenSSH is not installed on this computer, so the server cannot be browsed.')
    throw new Error('Could not list the folders on the server.')
  }
  if (result.code !== 0) throw new Error(explain(result, parsed.host))
  const parent = parentOf(parsed.path)
  const base = `ssh://${parsed.host}`
  return {
    address: `${base}${parsed.path === '/' ? '' : parsed.path}`,
    host: parsed.host,
    path: parsed.path,
    parent: parent === null ? null : `${base}${parent === '/' ? '' : parent}`,
    folders: parseFolderListing(result.stdout)
  }
}
