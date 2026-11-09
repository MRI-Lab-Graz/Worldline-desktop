import { escapeHtml } from './escape-html.js'

// The Files tree says things with small symbols instead of words; every symbol has a name for screen readers
// and a tooltip, and renderFilesLegend() spells them out once above the list. Plain inline SVG: it looks the same
// on Windows, macOS and Linux and needs no library.
const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
const CLOUD = 'M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9H7z'
const PATHS = {
  get: `<path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" ${stroke}/>`,
  drop: `<path d="${CLOUD} M9.5 13.5l2 2 3.5-3.5" ${stroke}/>`,
  unlock: `<path d="M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.6-1.6" ${stroke}/>`,
  open: `<path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" ${stroke}/>`,
  cloud: `<path d="${CLOUD}" ${stroke}/>`,
  partial: `<path d="${CLOUD}" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
}

const svg = (name, extraClass = '') =>
  `<svg class="row-icon${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`

const symbol = (html, label, extraClass = '') =>
  `<span class="row-mark${extraClass ? ` ${extraClass}` : ''}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${html}</span>`

// Only the exceptions get a marker: content that is here is the normal case.
export function renderAnnexBadge(annexPresent) {
  if (annexPresent === 'partial') return symbol(svg('partial', 'row-icon-partial'), 'Partly downloaded')
  if (annexPresent === false) return symbol(svg('cloud'), 'Not downloaded')
  return ''
}

const CHANGE_LABELS = {
  modified: 'Changed since the last save',
  changed: 'Changed since the last save',
  added: 'New, not saved yet',
  untracked: 'New, not saved yet',
  deleted: 'Deleted since the last save',
  renamed: 'Renamed since the last save',
  conflict: 'Conflict: needs your decision'
}

// One dot on the item that changed; a folder only gets a quiet ring, so a change deep inside is not shouted at
// every level above it.
export function renderChangeMarker({ type, gitStatus }) {
  if (!gitStatus) return ''
  const inside = type === 'directory' && gitStatus === 'changed'
  const label = inside ? 'Something inside changed since the last save' : (CHANGE_LABELS[gitStatus] ?? CHANGE_LABELS.changed)
  const kind = inside ? 'row-dot-inside' : gitStatus === 'conflict' ? 'row-dot-conflict' : ''
  return symbol(`<span class="row-dot${kind ? ` ${kind}` : ''}"></span>`, label)
}

// `attributes` (data-… of the caller) are escaped here; the label and title come from the app, not the dataset.
export function renderActionButton({ action, label, title }, attributes = {}) {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  const tip = title ? `${label}: ${title}` : label
  return `<button type="button" class="button button-ghost row-action"${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(tip)}">${svg(action)}</button>`
}

export function renderFilesLegend() {
  const item = (marker, words) => `<span class="legend-item">${marker}${words}</span>`
  return (
    '<p class="hint finder-legend">' +
    item(renderChangeMarker({ type: 'file', gitStatus: 'modified' }), 'changed since the last save') +
    item(renderChangeMarker({ type: 'directory', gitStatus: 'changed' }), 'something inside changed') +
    item(renderAnnexBadge(false), 'not downloaded') +
    item(renderAnnexBadge('partial'), 'partly downloaded') +
    '</p>'
  )
}
