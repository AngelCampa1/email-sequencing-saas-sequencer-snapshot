import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileCommand } from '../commands/compile.js'

describe('seq compile command', () => {
  const originalCwd = process.cwd()

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
  })

  it('rejects variant subject maps that do not match declared variants', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-compile-test-'))
    const sequenceDir = join(root, 'sequences', 'camaudit')
    mkdirSync(sequenceDir, { recursive: true })
    writeFileSync(
      join(sequenceDir, 'bad-subjects.yaml'),
      `
slug: bad-subjects
product: camaudit
version: 1
variants:
  - id: control
    weight: 50
  - id: treatment
    weight: 50
steps:
  - id: step1
    delay: 0m
    template: test
    subject:
      bogus: "Wrong subject"
  - id: step2
    delay: 3d
    template: test
    subject: Two
  - id: step3
    delay: 4d
    template: test
    subject: Three
  - id: step4
    delay: 3d
    template: test
    subject: Four
  - id: step5
    delay: 4d
    template: test
    subject: Five
  - id: step6
    delay: 7d
    template: test
    subject: Six
  - id: step7
    delay: 7d
    template: test
    subject: Seven
`,
    )
    process.chdir(root)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`)
    }) as never)

    await expect(
      compileCommand.parseAsync(['node', 'compile', '--no-bundle'], { from: 'node' }),
    ).rejects.toThrow('process.exit 1')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('subject keys'))
  })

  it('rejects duplicate sequence slugs before writing a bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'seq-compile-test-'))
    const sequenceDir = join(root, 'sequences', 'camaudit')
    mkdirSync(sequenceDir, { recursive: true })
    const sequence = (subject: string) => `
slug: duplicate-slug
product: camaudit
version: 1
steps:
${Array.from({ length: 14 }, (_, i) => {
  const n = i + 1
  const subjectLine = n === 1 ? `"${subject}"` : `Day ${n}`
  return `  - id: step${n}
    delay: 1d
    template: lead-magnets/tenant-checklist-delivery
    subject: ${subjectLine}`
}).join('\n')}
`
    writeFileSync(join(sequenceDir, 'one.yaml'), sequence('One'))
    writeFileSync(join(sequenceDir, 'two.yaml'), sequence('Two'))
    process.chdir(root)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`)
    }) as never)

    await expect(
      compileCommand.parseAsync(['node', 'compile', '--no-bundle'], { from: 'node' }),
    ).rejects.toThrow('process.exit 1')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate sequence slug "duplicate-slug"'),
    )
  })
})
