// The address of an OpenNeuro dataset's web page is not a repository address: git cannot clone it. OpenNeuro mirrors
// every dataset at github.com/OpenNeuroDatasets/<id>. The result is built from the validated id only, never from the
// pasted text, and it is only ever suggested to the user, never swapped in silently.
export function openNeuroRepoAddress(text) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !['openneuro.org', 'www.openneuro.org'].includes(url.hostname)) return null
  const id = /^\/datasets\/(ds\d{6})(?:\/|$)/i.exec(url.pathname)?.[1]
  return id ? `https://github.com/OpenNeuroDatasets/${id.toLowerCase()}` : null
}
