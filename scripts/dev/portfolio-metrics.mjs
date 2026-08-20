/**
 * Regenerates every number in README.md's "Scale and shape" table and in
 * portfolio/METRICS.md, from the tracked working tree.
 *
 *   node scripts/dev/portfolio-metrics.mjs
 *
 * Definitions, stated because they are the whole meaning of the numbers:
 *
 *   source    tracked .ts/.tsx that is not a test and not a generated .d.ts
 *   test      tracked .ts/.tsx under __tests__/ or system-tests/, or named *.test.ts(x)
 *   LOC       newline count, the same thing `wc -l` reports
 *
 * Type-escape counts are source-only. Tests are allowed to lie to the type
 * system to build a fixture; production code is not, so counting both together
 * would flatter the source and inflate nothing useful.
 *
 * The "not counted" section at the end exists so the totals cannot be mistaken
 * for a measure of the whole repository. YAML sequences, SQL migrations and
 * screenshots are real content that these LOC figures deliberately exclude.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const GENERATED = /\.d\.ts$/
const IS_TEST = /(\.test\.tsx?$|(^|\/)__tests__\/|(^|\/)system-tests\/)/

const files = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const read = (f) => readFileSync(resolve(ROOT, f), 'utf8')
const loc = (fs) => fs.reduce((n, f) => n + read(f).split('\n').length - 1, 0)
const count = (fs, re) => fs.reduce((n, f) => n + (read(f).match(re)?.length ?? 0), 0)
const n = (x) => x.toLocaleString('en-US')

const ts = files.filter((f) => /\.tsx?$/.test(f) && !GENERATED.test(f))
const source = ts.filter((f) => !IS_TEST.test(f))
const tests = ts.filter((f) => IS_TEST.test(f))

const yaml = files.filter((f) => f.startsWith('sequences/') && f.endsWith('.yaml'))
const steps = count(yaml, /^ {2}- id:/gm)
const migrations = files.filter((f) => /^packages\/db\/migrations\/\d+.*\.sql$/.test(f))
const schema = files.filter((f) => /^packages\/db\/src\/schema\/.*\.ts$/.test(f))
const screenshots = files.filter((f) => f.startsWith('portfolio/screenshots/'))
const generated = files.filter((f) => /\.tsx?$/.test(f) && GENERATED.test(f))

const row = (k, v) => console.log(`| ${k} | ${v} |`)

console.log('| | |')
console.log('| --- | --- |')
row('Application TypeScript', `**${n(loc(source))} LOC** across ${source.length} files`)
row('Test code', `**${n(loc(tests))} LOC** across ${tests.length} files`)
row('Test-to-source ratio', `**${(loc(tests) / loc(source)).toFixed(2)}:1**`)
row('Sequence content', `**${yaml.length} YAML sequences**, ${n(steps)} steps`)
row('D1 tables', `${count(schema, /\bsqliteTable\(/g)}`)
row('Database migrations', `${migrations.length}`)
row(
  'Indexes declared in schema',
  `${count(schema, /\bindex\(/g) + count(schema, /\buniqueIndex\(/g)} ` +
    `(${count(schema, /\bindex\(/g)} plain, ${count(schema, /\buniqueIndex\(/g)} unique)`,
)
row('Screenshots', `${screenshots.length}`)
row('`@ts-expect-error` in source', `${count(source, /@ts-expect-error/g)}`)
row('`as any` in source', `${count(source, /\bas any\b/g)}`)
row('`Record<string, any>` in source', `${count(source, /Record<string,\s*any>/g)}`)

console.log('\nNot counted above:')
console.log(`  ${generated.length} generated .d.ts files`)
console.log(`  ${migrations.length} .sql migration files`)
console.log(`  ${yaml.length} .yaml sequence files`)
console.log(`  ${screenshots.length} .png screenshots`)
console.log(`  ${files.length} files tracked in total`)
console.log(`\n  ${count(tests, /\bas any\b/g)} \`as any\` and`)
console.log(`  ${count(tests, /@ts-expect-error/g)} \`@ts-expect-error\` in test code, excluded above.`)
console.log('\nTest and coverage counts come from `pnpm test` and `pnpm test:web:coverage`,')
console.log('not from this script. It counts files, not behaviour.')
