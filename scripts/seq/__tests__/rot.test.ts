import { describe, expect, it } from 'vitest'
import { buildRotReport, buildRotSql, parseRotRows } from '../commands/rot.js'

describe('seq rot D1 report', () => {
  it('reports active sequences with no enrollments in the cutoff window', () => {
    const report = buildRotReport([
      {
        slug: 'camaudit-lead-magnet-tenant-checklist',
        product: 'camaudit',
        active: 1,
        recent_enrollments: 0,
        total_enrollments: 12,
        last_enrolled_at: '2026-01-01T00:00:00.000Z',
      },
      {
        slug: 'grantpipe-nurture-value-1',
        product: 'grantpipe',
        active: 1,
        recent_enrollments: 3,
        total_enrollments: 9,
        last_enrolled_at: '2026-05-18T00:00:00.000Z',
      },
    ])

    expect(report).toEqual([
      {
        slug: 'camaudit-lead-magnet-tenant-checklist',
        product: 'camaudit',
        recentEnrollments: 0,
        totalEnrollments: 12,
        lastEnrolledAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('treats never-enrolled active sequences as rot candidates', () => {
    const report = buildRotReport([
      {
        slug: 'grantpipe-fulfillment-welcome',
        product: 'grantpipe',
        active: 1,
        recent_enrollments: 0,
        total_enrollments: 0,
        last_enrolled_at: null,
      },
    ])

    expect(report[0]).toMatchObject({
      slug: 'grantpipe-fulfillment-welcome',
      totalEnrollments: 0,
      lastEnrolledAt: null,
    })
  })

  it('parses numeric D1 row fields defensively', () => {
    const rows = parseRotRows([
      {
        slug: 'floriva-fulfillment-welcome',
        product: 'floriva-web',
        active: '1',
        recent_enrollments: '0',
        total_enrollments: '4',
        last_enrolled_at: '2026-01-02T00:00:00.000Z',
      },
    ])

    expect(rows).toEqual([
      {
        slug: 'floriva-fulfillment-welcome',
        product: 'floriva-web',
        active: 1,
        recent_enrollments: 0,
        total_enrollments: 4,
        last_enrolled_at: '2026-01-02T00:00:00.000Z',
      },
    ])
  })

  it('scopes enrollment counts by product as well as sequence slug', () => {
    const sql = buildRotSql('2026-01-01T00:00:00.000Z')

    expect(sql).toContain('r.product_id = s.product_id')
  })
})
