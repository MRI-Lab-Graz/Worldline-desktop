import { formatBytes } from './data-panel.js'

// Words for the "Delete this project" dialog. A check that could not run is a warning, never "nothing at risk".
export function projectNameMatches(typed, name) {
  return typeof typed === 'string' && typeof name === 'string' && name !== '' && typed === name
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function describeDeletionRisk(risk) {
  if (!risk) return ['Could not check what would be lost.']
  const lines = []
  if (risk.hasRemote === false) lines.push('This project has no remote, so everything in it exists only on this computer.')
  if (risk.unsavedChanges === null) lines.push('Could not check for unsaved changes.')
  else if (risk.unsavedChanges > 0) lines.push(`${count(risk.unsavedChanges, 'change is', 'changes are')} not saved yet.`)
  if (risk.hasRemote !== false) {
    if (risk.unsentSaves === null) lines.push('Could not check for saves that were not sent to the remote.')
    else if (risk.unsentSaves > 0) lines.push(`${count(risk.unsentSaves, 'save has', 'saves have')} not been sent to the remote.`)
  }
  if (risk.onlyHereCount === null) lines.push('Could not check which data exists only on this computer.')
  else if (risk.onlyHereCount > 0) lines.push(`${count(risk.onlyHereCount, 'data file exists', 'data files exist')} only on this computer.`)
  return lines
}

export function describeFolderSize({ bytes, files }) {
  return `${formatBytes(bytes)}, ${count(files, 'file', 'files')}`
}

// The page remembers recent projects in three places; a deleted project must leave all of them.
export function withoutProject({ recentProjects, emojiByPath, titleByPath }, path) {
  const drop = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== path))
  return { recentProjects: recentProjects.filter((p) => p !== path), emojiByPath: drop(emojiByPath), titleByPath: drop(titleByPath) }
}
