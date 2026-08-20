import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildSparklinePoints, Sparkline } from './sparkline'

describe('buildSparklinePoints', () => {
  it('returns empty string for empty values', () => {
    expect(buildSparklinePoints([], 80, 20)).toBe('')
  })

  it('returns empty string for single value', () => {
    expect(buildSparklinePoints([5], 80, 20)).toBe('')
  })

  it('maps two points to correct corners', () => {
    const result = buildSparklinePoints([0, 10], 80, 20)
    // First point: x=0, y=20 (lowest value = bottom). Second: x=80, y=0 (highest = top).
    expect(result).toBe('0,20 80,0')
  })

  it('ascending series produces increasing x and decreasing y', () => {
    const pts = buildSparklinePoints([0, 5, 10], 80, 20)
    const pairs = pts.split(' ').map((p) => p.split(',').map(Number))
    expect(pairs[0][0]).toBe(0)
    expect(pairs[1][0]).toBe(40)
    expect(pairs[2][0]).toBe(80)
    // y: 10 is highest → y=0; 5 is mid → y=10; 0 is lowest → y=20
    expect(pairs[0][1]).toBe(20)
    expect(pairs[1][1]).toBe(10)
    expect(pairs[2][1]).toBe(0)
  })

  it('descending series produces correct y values', () => {
    const pts = buildSparklinePoints([10, 5, 0], 80, 20)
    const pairs = pts.split(' ').map((p) => p.split(',').map(Number))
    // y: 10→0, 5→10, 0→20
    expect(pairs[0][1]).toBe(0)
    expect(pairs[1][1]).toBe(10)
    expect(pairs[2][1]).toBe(20)
  })

  it('all-equal values draw flat horizontal midline', () => {
    const pts = buildSparklinePoints([7, 7, 7], 80, 20)
    const pairs = pts.split(' ').map((p) => p.split(',').map(Number))
    // All y should be at vertical center = 10 (height/2)
    for (const pair of pairs) {
      expect(pair[1]).toBe(10)
    }
  })

  it('rounds coordinates to at most 2 decimal places', () => {
    const pts = buildSparklinePoints([1, 2, 4], 100, 30)
    const parts = pts.split(' ')
    for (const part of parts) {
      const [x, y] = part.split(',')
      const xDecimals = (x.split('.')[1] ?? '').length
      const yDecimals = (y.split('.')[1] ?? '').length
      expect(xDecimals).toBeLessThanOrEqual(2)
      expect(yDecimals).toBeLessThanOrEqual(2)
    }
  })

  it('handles negative values correctly', () => {
    const pts = buildSparklinePoints([-10, 0, 10], 80, 20)
    const pairs = pts.split(' ').map((p) => p.split(',').map(Number))
    // -10 is min → y=20; 0 is mid → y=10; 10 is max → y=0
    expect(pairs[0][1]).toBe(20)
    expect(pairs[1][1]).toBe(10)
    expect(pairs[2][1]).toBe(0)
  })
})

describe('Sparkline component', () => {
  it('renders an svg element', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)
    expect(html).toContain('<svg')
    expect(html).toContain('</svg>')
  })

  it('applies default width and height', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)
    expect(html).toContain('width="80"')
    expect(html).toContain('height="20"')
  })

  it('accepts custom width and height', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} width={120} height={40} />)
    expect(html).toContain('width="120"')
    expect(html).toContain('height="40"')
  })

  it('includes role="img"', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)
    expect(html).toContain('role="img"')
  })

  it('includes aria-label when provided', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} aria-label="Sends over time" />)
    expect(html).toContain('aria-label="Sends over time"')
  })

  it('renders a polyline with fill="none"', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)
    expect(html).toContain('fill="none"')
    expect(html).toContain('<polyline')
  })

  it('renders with currentColor stroke by default', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />)
    expect(html).toContain('stroke="currentColor"')
  })

  it('accepts className and strokeClassName', () => {
    const html = renderToStaticMarkup(
      <Sparkline values={[1, 2, 3]} className="inline-block" strokeClassName="text-green-500" />,
    )
    expect(html).toContain('inline-block')
    expect(html).toContain('text-green-500')
  })

  it('renders empty svg gracefully for empty values', () => {
    const html = renderToStaticMarkup(<Sparkline values={[]} />)
    expect(html).toContain('<svg')
    expect(html).not.toContain('<polyline')
  })

  it('renders empty svg gracefully for single value', () => {
    const html = renderToStaticMarkup(<Sparkline values={[42]} />)
    expect(html).toContain('<svg')
    expect(html).not.toContain('<polyline')
  })

  it('renders polyline points attribute with values', () => {
    const html = renderToStaticMarkup(<Sparkline values={[0, 10]} width={80} height={20} />)
    expect(html).toContain('points="0,20 80,0"')
  })
})
