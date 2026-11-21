import { parseSshAddress, isOpenableName } from '../gui/ssh-browse.js'

// Pure helpers for "send creates the missing subject folders on the server". Origins are URL/remote
// POSIX paths, so '/' is used explicitly. Everything that reaches a remote command line is checked
// here and refused (throw or null), never cleaned up silently.
const SUBJECT = /^sub-[A-Za-z0-9][A-Za-z0-9+._-]{0,62}$/
const MAX_SUBJECTS = 500
const isSubject = (name) => typeof name === 'string' && SUBJECT.test(name)
const segmentsOf = (path) => path.split('/').filter((s) => s !== '')

export function parseServerOrigin(url) {
  return parseSshAddress(url)
}

export function underFavorite(origin, favorites) {
  if (!checkedOrigin(origin)) return false
  const host = String(origin?.host ?? '').toLowerCase()
  const have = segmentsOf(String(origin?.path ?? ''))
  for (const favorite of Array.isArray(favorites) ? favorites : []) {
    const fav = parseSshAddress(favorite)
    if (!fav || fav.host.toLowerCase() !== host) continue
    const want = segmentsOf(fav.path)
    if (want.length <= have.length && want.every((s, i) => s === have[i])) return true
  }
  return false
}

export function wantedOrigin(projectOrigin, subject) {
  if (!isSubject(subject)) return null
  const checked = checkedOrigin(projectOrigin)
  return checked ? `ssh://${checked.host}${checked.path === '/' ? '' : checked.path}/${subject}` : null
}

// A host or path that parseSshAddress would not accept is refused; the path must be absolute and already normalised.
function checkedOrigin(origin) {
  if (!origin || typeof origin.host !== 'string' || typeof origin.path !== 'string') return null
  if (!origin.path.startsWith('/') || !isSafePath(origin.path)) return null
  const parsed = parseSshAddress(`ssh://${origin.host}/`)
  return parsed && parsed.host === origin.host ? { host: origin.host, path: origin.path } : null
}
const isSafePath = (path) => path === '/' || (!path.endsWith('/') && path.slice(1).split('/').every(isOpenableName))

export function ensureSshArgs(origin, subjects) {
  const checked = checkedOrigin(origin)
  if (!checked) throw new Error('The server address is not safe to use.')
  if (!Array.isArray(subjects) || subjects.length === 0) throw new Error('There are no subject folders to create.')
  const names = [...new Set(subjects)]
  if (names.length > MAX_SUBJECTS) throw new Error(`Too many subject folders at once (more than ${MAX_SUBJECTS}).`)
  const bad = names.find((name) => !isSubject(name))
  if (bad !== undefined) throw new Error(`"${String(bad).slice(0, 80)}" is not a valid subject folder name.`)
  const quoted = [checked.path, ...names].map((s) => `'${s}'`).join(' ')
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '--', checked.host, `worldline-ensure-subjects ${quoted}`]
}

export function parseEnsureOutput(stdout) {
  const result = { created: [], exists: [], refused: [] }
  if (typeof stdout !== 'string') return result
  for (const line of stdout.split(/\r?\n/)) {
    let m
    if ((m = /^created (sub-\S+)$/.exec(line)) && isSubject(m[1])) result.created.push(m[1])
    else if ((m = /^exists (sub-\S+)$/.exec(line)) && isSubject(m[1])) result.exists.push(m[1])
    else if ((m = /^refused (\S+) (.*)$/.exec(line)) && (m[1] === '(empty)' || isSubject(m[1]))) result.refused.push({ name: m[1], reason: m[2] })
  }
  return result
}

// Plain words for a failed ssh call. The server's own text is only looked at, never shown.
export function explainSshFailure({ stderr = '', code, timedOut, missing } = {}) {
  if (missing) return 'This computer has no ssh program. Install the OpenSSH Client (Windows: Settings > Optional features) and try again.'
  if (code === 127 || /worldline-ensure-subjects: (command )?not found/i.test(stderr)) return 'The lab server is not set up for this yet. Ask its administrator to install worldline-ensure-subjects. Sending your saves carried on without it.'
  if (timedOut) return 'The server did not answer in time. Check your network or VPN.'
  if (/permission denied/i.test(stderr)) return 'The server did not accept your key. Set up key login for this server first.'
  if (/host key verification failed|REMOTE HOST IDENTIFICATION/i.test(stderr)) return 'This computer does not know the server yet. Connect once in a terminal (ssh the-server), accept its fingerprint, then try again.'
  if (/could not resolve|name or service not known|nodename nor servname/i.test(stderr)) return 'This computer does not know that server. Use its full name in the address.'
  if (/no route|connection (refused|timed out)|network is unreachable/i.test(stderr)) return 'Cannot reach the server. Check your network or VPN.'
  return 'The server could not be reached or did not answer as expected.'
}

// Free text from the server: no control characters, at most 120 characters.
export const safeReason = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 120)
