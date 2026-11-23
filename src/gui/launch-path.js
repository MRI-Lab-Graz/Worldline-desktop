import { win32 } from 'node:path'

// `worldline /path/to/project` (also the second start of the app): the first absolute path after argv[0].
// Only a suggestion: the renderer opens it through the normal detect + trust-prompt flow.
export function launchProjectPath(argv) {
  return (argv ?? []).slice(1).find((arg) => !arg.startsWith('-') && win32.isAbsolute(arg)) ?? null
}
