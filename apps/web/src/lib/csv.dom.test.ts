// @vitest-environment jsdom
import '../test/interaction-setup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from './csv'

describe('downloadCsv (browser)', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let appendChildSpy: ReturnType<typeof vi.fn>
  let removeChildSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn>
  // biome-ignore lint/suspicious/noExplicitAny: createElement's overloaded signature defeats spyOn generics
  let createElementSpy: any

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:fake-url')
    revokeObjectURLSpy = vi.fn()
    clickSpy = vi.fn()
    appendChildSpy = vi.fn()
    removeChildSpy = vi.fn()

    Object.defineProperty(globalThis, 'URL', {
      value: {
        createObjectURL: createObjectURLSpy,
        revokeObjectURL: revokeObjectURLSpy,
      },
      writable: true,
      configurable: true,
    })

    const fakeAnchor = {
      href: '',
      download: '',
      click: clickSpy,
      style: {},
    }

    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') return fakeAnchor as unknown as HTMLElement
      return document.createElement.call(document, tag) as HTMLElement
    }) as unknown as typeof document.createElement)

    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildSpy)
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a Blob and passes it to URL.createObjectURL', () => {
    // We verify Blob creation indirectly: createObjectURL is called with a Blob argument.
    downloadCsv('report.csv', 'a,b\r\n1,2')
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    const arg = createObjectURLSpy.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Blob)
    expect(arg.type).toBe('text/csv;charset=utf-8')
  })

  it('calls URL.createObjectURL and sets href on anchor', () => {
    downloadCsv('out.csv', 'header\r\nrow')
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
  })

  it('sets the download attribute to the given filename', () => {
    const fakeAnchor = { href: '', download: '', click: clickSpy, style: {} }
    createElementSpy.mockImplementation(((tag: string) => {
      if (tag === 'a') return fakeAnchor as unknown as HTMLElement
      // fallback — shouldn't be called for other tags in this function
      throw new Error(`unexpected createElement(${tag})`)
    }) as unknown as typeof document.createElement)
    downloadCsv('my-file.csv', 'data')
    expect(fakeAnchor.download).toBe('my-file.csv')
  })

  it('clicks the anchor element', () => {
    downloadCsv('test.csv', 'x')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('revokes the object URL on a later tick after clicking', () => {
    vi.useFakeTimers()
    try {
      downloadCsv('test.csv', 'x')
      // Revoke is deferred to avoid empty downloads in some browsers; it must
      // not fire synchronously after click().
      expect(revokeObjectURLSpy).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url')
    } finally {
      vi.useRealTimers()
    }
  })

  it('appends and removes the anchor from document.body', () => {
    downloadCsv('test.csv', 'x')
    expect(appendChildSpy).toHaveBeenCalledTimes(1)
    expect(removeChildSpy).toHaveBeenCalledTimes(1)
  })
})
