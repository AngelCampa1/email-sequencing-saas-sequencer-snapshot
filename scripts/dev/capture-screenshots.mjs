/**
 * Capture the dashboard screenshot set in portfolio/screenshots/.
 *
 * Playwright is deliberately NOT a dependency of this repo: it is only ever needed
 * to regenerate documentation images, so paying for a browser download on every
 * `pnpm install` would be a poor trade. Install it globally instead:
 *
 *   npm i -g playwright && playwright install chromium
 *
 * Then, because ESM import resolution ignores NODE_PATH, run through the wrapper
 * that sets it (this script resolves the global install itself, see resolvePlaywright):
 *
 *   pnpm screenshots
 *
 * Prerequisites, in order. Skipping `seq sync` leaves the Sequences and Templates
 * pages empty, because the template catalog is derived from seq_sequences:
 *
 *   pnpm build
 *   pnpm db:migrate:local
 *   pnpm seq compile && pnpm seq sync
 *   pnpm seed:dev
 *   cd apps/api && pnpm exec wrangler dev --local --port 8799
 *
 * Options:
 *   --base <url>   Worker origin (default http://127.0.0.1:8799, or $SCREENSHOT_BASE)
 *   --only <re>    Capture only shots whose name matches this regular expression
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'portfolio', 'screenshots')

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}
const BASE = argOf('--base') ?? process.env.SCREENSHOT_BASE ?? 'http://127.0.0.1:8799'
const ONLY = argOf('--only') ? new RegExp(argOf('--only')) : null

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

/**
 * Resolve Playwright from the global npm root. CommonJS resolution honours
 * NODE_PATH where ESM `import` does not, so createRequire is what makes a
 * global-only install usable from an .mjs file.
 */
function resolvePlaywright() {
  try {
    return require('playwright')
  } catch {}
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim()
    return require(join(globalRoot, 'playwright'))
  } catch {}
  console.error(
    [
      'Playwright not found. It is intentionally not a dependency of this repo.',
      '',
      '  npm i -g playwright',
      '  playwright install chromium',
      '',
      'Then re-run: pnpm screenshots',
    ].join('\n'),
  )
  process.exit(1)
}

const { chromium } = resolvePlaywright()

/**
 * Injected before every capture.
 *
 * `reducedMotion: 'reduce'` only sets the media query; Radix animates through
 * Tailwind `data-[state=open]:animate-in` utilities that do not consult it, so
 * durations have to be zeroed directly. The caret rule matters more than it
 * looks: Radix dialogs autofocus their first field, so without it roughly a
 * third of the dialog shots would differ run to run purely on blink phase.
 */
const DETERMINISM_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
  * { caret-color: transparent !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  [data-sonner-toaster] { display: none !important; }
`

const settled = new WeakSet()

/** Two rAF ticks, so layout after the last state commit has actually painted. */
const paint = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: DETERMINISM_CSS })
  settled.delete(page)
}

/**
 * Settle in three layers, because none is sufficient alone: a positive signal
 * that the data actually arrived, a negative signal that no skeleton remains,
 * then network quiet. `networkidle` is safe here only because the app has no
 * polling and no websockets (the QueryClient sets staleTime but no refetchInterval).
 */
async function settle(page, { heading, expect: expectText } = {}) {
  if (heading) await page.getByRole('heading', { name: heading, exact: false }).first().waitFor()
  if (expectText) await page.getByText(expectText, { exact: false }).first().waitFor()
  await page
    .locator('.animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await paint(page)
  settled.add(page)
}

async function openOverlay(page, trigger, role = 'dialog') {
  await trigger.click()
  const overlay = page.getByRole(role).last()
  await overlay.waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await paint(page)
  return overlay
}

async function closeOverlay(page) {
  await page.keyboard.press('Escape')
  await page
    .getByRole('dialog')
    .last()
    .waitFor({ state: 'hidden', timeout: 3000 })
    .catch(() => {})
  await paint(page)
}

let captured = 0
let skipped = 0

async function shot(page, dir, name, { fullPage = false } = {}) {
  if (ONLY && !ONLY.test(name)) {
    skipped++
    return
  }
  await paint(page)
  await page.screenshot({ path: join(OUT, dir, `${name}.png`), fullPage })
  captured++
  console.log(`  ${dir}/${name}.png`)
}

/**
 * Each entry is [name, fn]. Written as a flat list so `--only` can target any
 * single shot while iterating, without re-running the whole set.
 */
function desktopShots(page) {
  return [
    [
      '01-overview',
      async () => {
        await goto(page, '/')
        await settle(page, { heading: 'Overview', expect: 'Emails Sent' })
      },
    ],
    [
      '02-overview-loading',
      async () => {
        // Hold the response open so the skeleton state is what gets captured.
        await page.route('**/api/internal/overview*', () => {})
        await goto(page, '/')
        await page.getByRole('heading', { name: 'Overview' }).waitFor()
        await page.waitForTimeout(400)
        await paint(page)
      },
    ],
    [
      '03-overview-error',
      async () => {
        // Must fulfil on EVERY call: the QueryClient retries, so the error state
        // only renders after the retries are exhausted. Fulfilling once yields a
        // spinner screenshot instead.
        await page.unroute('**/api/internal/overview*').catch(() => {})
        await page.route('**/api/internal/overview*', (r) =>
          r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
        )
        await goto(page, '/')
        await page.getByRole('heading', { name: 'Overview' }).waitFor()
        await page.waitForTimeout(3500)
        await paint(page)
        await page.unroute('**/api/internal/overview*')
      },
    ],

    [
      '04-products',
      async () => {
        await goto(page, '/products')
        await settle(page, { heading: 'Products', expect: 'camaudit' })
      },
    ],
    [
      '05-products-new-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'New product' }))
      },
    ],
    [
      '06-products-delete-dialog',
      async () => {
        await closeOverlay(page)
        // Products uses a plain dialog for its destructive confirm, where
        // Contacts and Block list use alertdialog. Not interchangeable.
        await openOverlay(page, page.getByRole('button', { name: 'Delete camaudit' }))
      },
    ],

    [
      '07-sequences',
      async () => {
        await goto(page, '/sequences')
        await settle(page, { heading: 'Sequences', expect: 'camaudit-white-label-pricing-sheet' })
      },
    ],
    [
      '08-sequences-detail-dialog',
      async () => {
        await openOverlay(
          page,
          page.getByRole('button', { name: 'View camaudit-white-label-pricing-sheet' }),
        )
      },
    ],
    [
      '09-sequences-edit-dialog',
      async () => {
        await closeOverlay(page)
        await openOverlay(
          page,
          page.getByRole('button', { name: 'Edit camaudit-white-label-pricing-sheet' }),
        )
      },
    ],
    [
      '10-sequences-new-dialog',
      async () => {
        await closeOverlay(page)
        await openOverlay(page, page.getByRole('button', { name: 'New sequence' }))
      },
    ],

    [
      '11-contacts',
      async () => {
        await closeOverlay(page)
        await goto(page, '/contacts')
        await settle(page, { heading: 'Contacts', expect: '@example.com' })
      },
    ],
    [
      '12-contacts-search',
      async () => {
        await page.getByPlaceholder('Search name or email...').fill('sarah')
        await page.waitForTimeout(600)
        await settle(page)
      },
    ],
    [
      '13-contacts-empty-search',
      async () => {
        await page.getByPlaceholder('Search name or email...').fill('zzzz-no-such-contact')
        await page.waitForTimeout(600)
        await paint(page)
      },
    ],
    [
      '14-contacts-detail-sheet',
      async () => {
        await page.getByPlaceholder('Search name or email...').fill('sarah')
        await page.waitForTimeout(600)
        await openOverlay(
          page,
          page.getByRole('button', { name: 'sarah.chen@meridian-properties.example.com' }),
        )
      },
    ],
    [
      '15-contacts-new-dialog',
      async () => {
        await closeOverlay(page)
        await openOverlay(page, page.getByRole('button', { name: 'New contact' }))
      },
    ],
    [
      '16-contacts-delete-alert',
      async () => {
        await closeOverlay(page)
        await openOverlay(
          page,
          page.getByRole('button', { name: 'Delete contact' }).first(),
          'alertdialog',
        )
      },
    ],

    [
      '17-lead-magnets',
      async () => {
        await closeOverlay(page)
        await goto(page, '/lead-magnets')
        await settle(page, { heading: 'Lead Magnets', expect: 'White-Label Pricing Sheet' })
      },
    ],
    [
      '18-lead-magnets-new-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'New lead magnet' }))
      },
    ],
    [
      '19-lead-magnets-edit-dialog',
      async () => {
        await closeOverlay(page)
        await openOverlay(page, page.getByRole('button', { name: 'Edit' }).first())
      },
    ],
    [
      '20-lead-magnets-row-selection',
      async () => {
        await closeOverlay(page)
        await page.getByLabel('Select all lead magnets').check()
        await paint(page)
      },
    ],

    [
      '21-suppressions-global',
      async () => {
        await goto(page, '/suppressions')
        await settle(page, { heading: 'Block list', expect: 'All products' })
      },
    ],
    [
      '22-suppressions-product',
      async () => {
        await page.getByRole('tab', { name: /One product/ }).click()
        await page.waitForTimeout(500)
        await settle(page)
      },
    ],
    [
      '23-suppressions-block-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'Block an address' }))
      },
    ],
    [
      '24-suppressions-unblock-alert',
      async () => {
        await closeOverlay(page)
        await openOverlay(
          page,
          page.getByRole('button', { name: 'Unblock' }).first(),
          'alertdialog',
        )
      },
    ],

    [
      '25-templates',
      async () => {
        await closeOverlay(page)
        await goto(page, '/templates')
        await settle(page, { heading: 'Email Templates', expect: 'Preview' })
      },
    ],
    [
      '26-templates-preview-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'Preview' }).first())
        // The preview iframe uses srcDoc with sandbox="allow-same-origin" (no
        // allow-scripts), so contentDocument is readable from the parent. Wait for
        // its images or the shot captures broken-image placeholders.
        await page
          .waitForFunction(
            () => {
              const f = document.querySelector('iframe')
              const d = f && f.contentDocument
              return !!d && d.readyState === 'complete' && [...d.images].every((i) => i.complete)
            },
            { timeout: 15_000 },
          )
          .catch(() => {})
        await paint(page)
      },
    ],

    [
      '27-deliverability',
      async () => {
        await closeOverlay(page)
        await goto(page, '/deliverability')
        await settle(page, { heading: 'Deliverability', expect: 'camaudit.io' })
      },
    ],
    [
      '28-deliverability-assign-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'Assign' }).first())
      },
    ],

    [
      '29-audit',
      async () => {
        await closeOverlay(page)
        await goto(page, '/audit')
        // The table humanizes actions, so "sequence.updated" renders as "Sequence updated".
        await settle(page, { heading: 'Audit Log', expect: 'Sequence updated' })
      },
    ],
    [
      '30-audit-row-expanded',
      async () => {
        await page.getByRole('button', { name: /Show changes for audit entry/ }).first().click()
        await paint(page)
      },
    ],

    [
      '31-settings',
      async () => {
        await goto(page, '/settings')
        await settle(page, { heading: 'Settings', expect: 'camaudit' })
      },
    ],
    [
      '32-settings-cf-setup-expanded',
      async () => {
        await page.getByRole('button', { name: /Cloudflare Setup Commands/ }).click()
        await paint(page)
      },
    ],
    [
      '33-settings-token-dialog',
      async () => {
        await openOverlay(page, page.getByRole('button', { name: 'Setup Token' }).first())
      },
    ],

    [
      '34-not-found',
      async () => {
        await closeOverlay(page)
        await goto(page, '/no-such-page')
        await page.getByText('Page not found', { exact: false }).waitFor()
        await paint(page)
      },
    ],
  ]
}

function mobileShots(page) {
  return [
    [
      'm01-overview',
      async () => {
        await goto(page, '/')
        await settle(page, { heading: 'Overview', expect: 'Emails Sent' })
      },
    ],
    [
      'm02-sequences',
      async () => {
        await goto(page, '/sequences')
        await settle(page, { heading: 'Sequences', expect: 'camaudit-white-label-pricing-sheet' })
      },
    ],
    [
      'm03-contacts',
      async () => {
        await goto(page, '/contacts')
        await settle(page, { heading: 'Contacts', expect: '@example.com' })
      },
    ],
    [
      'm04-contacts-detail-sheet',
      async () => {
        await page.getByPlaceholder('Search name or email...').fill('sarah')
        await page.waitForTimeout(600)
        await openOverlay(
          page,
          page.getByRole('button', { name: 'sarah.chen@meridian-properties.example.com' }),
        )
      },
    ],
    [
      'm05-suppressions',
      async () => {
        await closeOverlay(page)
        await goto(page, '/suppressions')
        await settle(page, { heading: 'Block list', expect: 'All products' })
      },
    ],
    [
      'm06-templates-preview-dialog',
      async () => {
        await goto(page, '/templates')
        await settle(page, { heading: 'Email Templates', expect: 'Preview' })
        await openOverlay(page, page.getByRole('button', { name: 'Preview' }).first())
        await page.waitForTimeout(1200)
        await paint(page)
      },
    ],
    [
      'm07-settings',
      async () => {
        await closeOverlay(page)
        await goto(page, '/settings')
        await settle(page, { heading: 'Settings', expect: 'camaudit' })
      },
    ],
  ]
}

async function run() {
  const health = await fetch(`${BASE}/health`).catch(() => null)
  if (!health?.ok) {
    console.error(
      `No Worker at ${BASE}. Start it first:\n` +
        '  pnpm build && pnpm db:migrate:local && pnpm seq compile && pnpm seq sync && pnpm seed:dev\n' +
        '  cd apps/api && pnpm exec wrangler dev --local --port 8799',
    )
    process.exit(1)
  }

  for (const dir of ['desktop', 'mobile']) {
    await mkdir(join(OUT, dir), { recursive: true })
    if (!ONLY) {
      for (const f of await readdir(join(OUT, dir))) {
        if (f.endsWith('.png')) await rm(join(OUT, dir, f))
      }
    }
  }

  const browser = await chromium.launch({
    args: [
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--hide-scrollbars',
    ],
  })

  const common = {
    colorScheme: 'light', // the dashboard is light-mode only; pin it regardless
    reducedMotion: 'reduce',
    timezoneId: 'America/Chicago',
    locale: 'en-US',
    deviceScaleFactor: 2,
  }

  for (const [label, viewport, list] of [
    ['desktop', DESKTOP, desktopShots],
    ['mobile', MOBILE, mobileShots],
  ]) {
    console.log(`\n${label} (${viewport.width}x${viewport.height})`)
    const context = await browser.newContext({ ...common, viewport })
    const page = await context.newPage()
    for (const [name, fn] of list(page)) {
      try {
        await fn()
        await shot(page, label, name)
      } catch (err) {
        console.error(`  FAILED ${label}/${name}: ${String(err).split('\n')[0]}`)
        process.exitCode = 1
      }
    }
    await context.close()
  }

  await browser.close()
  console.log(`\ncaptured ${captured}${skipped ? `, skipped ${skipped}` : ''} -> portfolio/screenshots/`)
}

await run()
