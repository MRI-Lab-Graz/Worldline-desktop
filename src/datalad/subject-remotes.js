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
