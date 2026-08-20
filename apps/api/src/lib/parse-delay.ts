export function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)(m|h|d)$/)
  if (!match) throw new Error(`Invalid delay format: ${delay}. Expected e.g. 0m, 2h, 5d`)
  const n = parseInt(match[1], 10)
  switch (match[2]) {
    case 'm':
      return n * 60_000
    case 'h':
      return n * 3_600_000
    case 'd':
      return n * 86_400_000
    default:
      throw new Error(`Unknown delay unit: ${match[2]}`)
  }
}
