import { describe, expect, it } from 'vitest'
import { queryKeys } from './queryKeys'

describe('queryKeys', () => {
  it('me() returns ["me"]', () => {
    expect(queryKeys.me()).toEqual(['me'])
  })

  it('contactDetailAll() is a strict prefix of contactDetail(id)', () => {
    const all = queryKeys.contactDetailAll()
    const detail = queryKeys.contactDetail('abc-123')
    // The wildcard key must be a prefix — every element of `all` must match
    // the corresponding element of `detail` at the same index.
    expect(detail.length).toBeGreaterThan(all.length)
    all.forEach((segment, i) => {
      expect(detail[i]).toBe(segment)
    })
  })

  // sequences — optional productSlug branches
  it('sequences() without arg returns ["sequences"]', () => {
    expect(queryKeys.sequences()).toEqual(['sequences'])
  })

  it('sequences(slug) with arg returns ["sequences", { product: slug }]', () => {
    expect(queryKeys.sequences('my-product')).toEqual(['sequences', { product: 'my-product' }])
  })

  // contacts — optional params branches
  it('contacts() without arg returns ["contacts"]', () => {
    expect(queryKeys.contacts()).toEqual(['contacts'])
  })

  it('contacts({}) with an all-undefined params object returns ["contacts"]', () => {
    expect(queryKeys.contacts({ q: undefined, product: undefined })).toEqual(['contacts'])
  })

  it('contacts(params) with args returns ["contacts", params]', () => {
    expect(queryKeys.contacts({ q: 'alice', product: 'grantpipe' })).toEqual([
      'contacts',
      { q: 'alice', product: 'grantpipe' },
    ])
  })

  // suppressions — optional params branches
  it('suppressions() without arg returns ["suppressions"]', () => {
    expect(queryKeys.suppressions()).toEqual(['suppressions'])
  })

  it('suppressions({}) with all-undefined params returns ["suppressions"]', () => {
    expect(queryKeys.suppressions({ scope: undefined, q: undefined })).toEqual(['suppressions'])
  })

  it('suppressions(params) with args returns ["suppressions", params]', () => {
    expect(queryKeys.suppressions({ scope: 'global', q: 'a@b.com' })).toEqual([
      'suppressions',
      { scope: 'global', q: 'a@b.com' },
    ])
  })

  it('suppressions() is a strict prefix of suppressions(params) for invalidation', () => {
    const all = queryKeys.suppressions()
    const scoped = queryKeys.suppressions({ scope: 'global' })
    expect(scoped.length).toBeGreaterThan(all.length)
    all.forEach((segment, i) => {
      expect(scoped[i]).toBe(segment)
    })
  })

  // audit — page, all, list
  it('audit.all() returns ["audit"]', () => {
    expect(queryKeys.audit.all()).toEqual(['audit'])
  })

  it('audit.page(n) returns ["audit", n]', () => {
    expect(queryKeys.audit.page(2)).toEqual(['audit', 2])
  })

  it('audit.list(params) returns ["audit", params]', () => {
    expect(queryKeys.audit.list({ page: 1, actor: 'a@b.com' })).toEqual([
      'audit',
      { page: 1, actor: 'a@b.com' },
    ])
  })
})
