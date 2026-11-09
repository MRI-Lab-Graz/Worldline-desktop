import { lstatSync, realpathSync } from 'node:fs'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isUnsafeBackupLocation } from './path-confinement.js'

// GitHub-style: the typed name must equal the project's name exactly. One copy, shared with the page.
export { projectNameMatches } from './renderer/delete-project-view.js'

function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

// Fail closed. The folder must BE an opened project (not inside one, not above one), a real folder (not a link),
// hold a .git, and not be a drive root, the home folder, a folder above it, or a whole drive.
export function assertDeletableProject(path, { roots, home = homedir() }) {
  const target = typeof path === 'string' && path !== '' ? real(path) : null
  if (!target || ![...roots].some((root) => real(root) === target)) {
    throw new Error('This folder is not an opened project, so it cannot be deleted.')
  }
  if (isUnsafeBackupLocation(target, { home })) {
    throw new Error('This folder is too big to delete safely (a drive, your home folder or a folder above it) and cannot be deleted.')
  }
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error('This project is a link to another folder, so it cannot be deleted.')
  }
  try {
    lstatSync(join(target, '.git'))
  } catch {
    throw new Error('This folder is not a project (it has no .git folder), so it cannot be deleted.')
  }
  return target
}

// git-annex stores data read-only, in read-only folders; Windows also refuses read-only files. Make everything
// writable first, never following a link out of the project.
async function makeWritable(dir) {
  await chmod(dir, 0o700)
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await makeWritable(child)
    } else {
      await chmod(child, 0o600).catch(() => {})
    }
  }
}

// Files and bytes the dialog shows. Links are skipped: they are removed, never followed.
export async function folderSize(dir) {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      const inner = await folderSize(child)
      files += inner.files
      bytes += inner.bytes
    } else {
      files += 1
      bytes += (await lstat(child)).size
    }
  }
  return { files, bytes }
}

export async function deleteProjectFolder(path, options) {
  const target = assertDeletableProject(path, options)
  await makeWritable(target)
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) // retries: Windows locks files briefly
  return target
}
