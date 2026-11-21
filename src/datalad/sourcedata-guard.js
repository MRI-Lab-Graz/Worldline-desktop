// A project that tracks sourcedata/ (raw, possibly identifiable data in plain git) must only go to the internal lab
// server, never to a public host. Same rule as PRISM Studio had in share_publish.py; this is its one home now.
import { SAFE_NAME_PATTERN } from './adapter.js'

const PUBLIC_HOSTS = ['github.com', 'gitlab.com', 'gin.g-node.org', 'bitbucket.org', 'codeberg.org', 'openneuro.org']

const hostOf = (url) => {
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url)
  if (ssh) return ssh[1]
  // scp form user@host:path; a one-letter "host" is a Windows drive (C:\share), not a server.
  const scp = /^(?:[^@/\\]+@)?([^/\\:]{2,}):(?!\\)/.exec(url)
  return scp ? scp[1] : null
}

export function isPublicTarget(url) {
  const text = String(url ?? '').trim().replace(/^[a-z][a-z0-9.-]*\+/i, '') // git+ssh://..., any "<tool>+" prefix
  if (/^(https?|git):\/\//i.test(text)) return true
  const host = hostOf(text)?.toLowerCase().replace(/\.$/, '') // "github.com." is github.com
  return Boolean(host) && PUBLIC_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
const couldNotCheck = (detail) => `Could not check where this project is sent (${detail}), so nothing was sent. Try again.`

// Returns why the push must not happen, or null when it may. Fails closed: a git error refuses.
export async function pushRefusal({ runner, projectPath, remoteName }) {
  // Not yet validated by the adapter (it runs after this): a name must never reach git as an option.
  if (remoteName !== undefined && !(typeof remoteName === 'string' && SAFE_NAME_PATTERN.test(remoteName))) {
    return couldNotCheck('invalid remote name')
  }
  const git = (...args) => runner.run('git', ['-C', projectPath, ...args])
  const tracked = await git('ls-files', '--', 'sourcedata')
  if (tracked.exitCode !== 0) return couldNotCheck(tracked.stderr || `exit ${tracked.exitCode}`)
  if (lines(tracked.stdout).length === 0) return null
  let names = [remoteName]
  if (!remoteName) {
    // No remote named: datalad picks its own default, so every remote must be fine.
    const all = await git('remote')
    if (all.exitCode !== 0) return couldNotCheck(all.stderr || `exit ${all.exitCode}`)
    names = lines(all.stdout)
  }
  for (const name of names) {
    const urls = await git('remote', 'get-url', '--push', '--all', name)
    if (urls.exitCode !== 0) return couldNotCheck(urls.stderr || `exit ${urls.exitCode}`)
    if (lines(urls.stdout).some(isPublicTarget)) {
      return `"${name}" is a public host and this project tracks sourcedata/ (raw data). Send it only to the internal lab server.`
    }
  }
  return null
}
