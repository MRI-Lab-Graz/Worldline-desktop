import { accessSync, statSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, delimiter } from 'node:path'

// Windows searches the child's cwd before PATH, so a dataset could ship its own
// git.exe/datalad.exe. Resolve tools ourselves and spawn by absolute path.
// Only absolute PATH entries count: '', '.' and relative ones mean "the cwd".
// A Finder/Dock launch gets a minimal PATH without Homebrew/MacPorts, so search them last.
const MAC_TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']
// macos-install.sh puts Python, DataLad and git-annex here (the app's data folder). It is searched first, so a
// broken Homebrew or conda copy of the same tool cannot win.
export const MAC_PRIVATE_BIN = join(homedir(), 'Library', 'Application Support', 'Worldline Desktop', 'datalad-env', 'bin')

export function resolveTool(
  name,
  {
    pathEnv = process.env.PATH ?? process.env.Path ?? '',
    platform = process.platform,
    extraDirs = MAC_TOOL_DIRS,
    privateDirs = [MAC_PRIVATE_BIN]
  } = {}
) {
  if (/[\\/]/.test(name)) {
    return null
  }
  // Windows runs only .exe/.com directly; .cmd/.bat shims need a shell, which we never use here.
  const exts = platform === 'win32' ? ['.exe', '.com'] : ['']
  const dirs = pathEnv.split(delimiter)
  if (platform === 'darwin') {
    dirs.unshift(...privateDirs)
  }
  if (platform !== 'win32') {
    dirs.push(...extraDirs)
  }
  for (const dir of dirs) {
    if (!dir || !isAbsolute(dir)) {
      continue
    }
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      try {
        if (!statSync(candidate).isFile()) {
          continue
        }
        if (platform !== 'win32') {
          accessSync(candidate, constants.X_OK)
        }
        return candidate
      } catch {
        // not here, keep looking
      }
    }
  }
  return null
}

// The private environment goes in front (it is ours); the Homebrew/MacPorts folders go behind the existing PATH.
export function withToolDirs(env, platform = process.platform) {
  if (platform !== 'darwin') return env
  const have = (env.PATH ?? '').split(delimiter).filter((dir) => dir && dir !== MAC_PRIVATE_BIN)
  const add = MAC_TOOL_DIRS.filter((dir) => !have.includes(dir))
  return { ...env, PATH: [MAC_PRIVATE_BIN, ...have, ...add].join(delimiter) }
}
