// Connection favorites: a name for an address, kept per user. Only text; nothing is run or written outside the app.
export const FAVORITES_LIMIT = 50
const NAME_MAX = 40
const ADDRESS_MAX = 500
const CONTROL = /[\u0000-\u001f\u007f]/
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

function problem(list, entry) {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  const address = typeof entry?.address === 'string' ? entry.address.trim() : ''
  if (name === '' || CONTROL.test(name)) return 'Give the favorite a name (plain text).'
  if (name.length > NAME_MAX) return `The name can have at most ${NAME_MAX} characters.`
  if (address === '' || CONTROL.test(address)) return 'Type the address (one line of plain text).'
  if (address.length > ADDRESS_MAX) return `The address can have at most ${ADDRESS_MAX} characters.`
  if (list.some((f) => same(f.name, name))) return 'A favorite with this name already exists.'
  if (list.length >= FAVORITES_LIMIT) return `You can keep at most ${FAVORITES_LIMIT} favorites.`
  return null
}

export function addFavorite(list, entry) {
  const error = problem(list, entry)
  return error ? { error } : { list: [...list, { name: entry.name.trim(), address: entry.address.trim() }] }
}

export const removeFavorite = (list, name) => list.filter((f) => f.name !== name)

// Whatever came out of storage: keep what is valid, drop the rest, never throw.
export function cleanFavorites(raw) {
  let list = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (list.length >= FAVORITES_LIMIT) break
    const added = addFavorite(list, entry)
    if (added.list) list = added.list
  }
  return list
}

// Web addresses go to the Remote URL box; folders, shares and ssh:// go to Network Folder (where Browse works).
export const favoriteTarget = (address) => (/^(https?:\/\/|gin:)/i.test(address.trim()) ? 'url' : 'network')
