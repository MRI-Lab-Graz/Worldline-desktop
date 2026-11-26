// A folder that was sent as ordinary files and has since become a nested dataset leaves the project's files: a server
// with a checked-out copy then deletes them there, and if the folder has no place of its own nothing replaces them.
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { ADJUSTED_BRANCH_PATTERN, SAFE_NAME_PATTERN } from './adapter.js'

const couldNotCheck = (detail) => `Could not check what is already on the server (${detail}), so nothing was sent. Try again.`

// Returns why the push must not happen, or null when it may. Fails closed: a git error refuses.
export async function emptiedFolderRefusal({ runner, projectPath, remoteName, beforeContact = async () => {} }) {
  // Not yet validated by the adapter (it runs after this): a name must never reach git as an option.
  if (remoteName !== undefined && !(typeof remoteName === 'string' && SAFE_NAME_PATTERN.test(remoteName))) {
    return couldNotCheck('invalid remote name')
  }
  const git = (...args) => runner.run('git', ['-C', projectPath, ...args])
  const head = await git('symbolic-ref', '-q', '--short', 'HEAD')
  if (head.exitCode !== 0) return couldNotCheck('no current branch')
  const current = head.stdout.trim()
  const branch = ADJUSTED_BRANCH_PATTERN.exec(current)?.[1] ?? current // Windows: git-annex's adjusted branch
  let remote = remoteName
  if (!remote) {
    const configured = await git('config', '--get', `branch.${branch}.remote`)
    if (configured.exitCode === 1) return null // no server set up for this branch
    if (configured.exitCode !== 0) return couldNotCheck(configured.stderr || `exit ${configured.exitCode}`)
    remote = configured.stdout.trim()
    if (!SAFE_NAME_PATTERN.test(remote)) return couldNotCheck('invalid remote name') // from the config: same rule
  }
  const there = `refs/remotes/${remote}/${branch}`
  const known = await git('rev-parse', '-q', '--verify', there)
  if (known.exitCode === 1) return null // never sent there
  if (known.exitCode !== 0) return couldNotCheck(known.stderr || `exit ${known.exitCode}`)
  const diff = await git('diff', '--raw', '-z', '--no-renames', there, 'HEAD')
  if (diff.exitCode !== 0) return couldNotCheck(diff.stderr || `exit ${diff.exitCode}`)

  const tokens = diff.stdout.split('\0')
  const nested = []
  const removed = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const [, newMode, , , status] = tokens[i].split(' ')
    if (newMode === '160000') nested.push(tokens[i + 1])
    if (status === 'D') removed.push(tokens[i + 1])
  }
  const converted = nested.filter((path) => removed.some((file) => file.startsWith(`${path}/`)))
  if (converted.length > 0) await beforeContact() // asking a server runs the folder's own settings: trust first
  const emptied = []
  for (const folder of converted) {
    // Only a place that really answers counts: otherwise the project is still sent and the server folder is emptied.
    const path = join(projectPath, folder)
    // Only a real folder (a link could point at another repository, whose settings would run) with its own .git
    // (without one, git would look upwards and ask the main project's server instead).
    const own = (await lstat(path).then((info) => info.isDirectory(), () => false)) && (await lstat(join(path, '.git')).then(() => true, () => false))
    const reachable = own && (await runner.run('git', ['-C', path, 'ls-remote', '--quiet', remote], { timeoutMs: 60_000 })).exitCode === 0
    if (!reachable) emptied.push(folder)
  }
  if (emptied.length === 0) return null
  const names = emptied.slice(0, 5).join(', ') + (emptied.length > 5 ? ` and ${emptied.length - 5} more` : '')
  return `Nothing was sent: sending now would empty ${names} on the server. ${emptied.length === 1 ? 'This folder is' : 'These folders are'} on the server as ${emptied.length === 1 ? 'an ordinary folder' : 'ordinary folders'}, but here ${emptied.length === 1 ? 'it has' : 'they have'} been turned into ${emptied.length === 1 ? 'a nested dataset' : 'nested datasets'} with no place there yet. Ask whoever looks after the server to set that up first.`
}
