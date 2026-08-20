export function parseWranglerSecretListOutput(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('[')) continue

    try {
      const parsed = JSON.parse(lines.slice(i).join('\n'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      continue
    }
  }

  return []
}
