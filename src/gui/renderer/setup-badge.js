// The red number on the Setup button: how many of the basic tools (from the environment report) are missing.
export function setupBadge(report) {
  const count = (report?.checks ?? []).filter((check) => check.status === 'missing').length
  return { count, label: count ? `Setup, ${count} ${count === 1 ? 'tool' : 'tools'} missing` : 'Setup' }
}
