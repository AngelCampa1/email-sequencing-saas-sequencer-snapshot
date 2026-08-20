// @vitest-environment jsdom
import '../../test/interaction-setup'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton, TableSkeleton } from './skeleton'

describe('Skeleton', () => {
  it('renders a decorative pulse block', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />)
    const block = container.firstChild as HTMLElement
    expect(block).toHaveClass('animate-pulse')
    expect(block).toHaveClass('h-4')
  })
})

describe('TableSkeleton', () => {
  it('exposes a polite loading status to assistive tech', () => {
    render(<TableSkeleton rows={3} cols={4} />)
    const status = screen.getByRole('status')
    // Screen readers announce the loading state once on mount.
    expect(status).toHaveAccessibleName(/loading/i)
  })

  it('hides the decorative pulse bars from assistive tech', () => {
    const { container } = render(<TableSkeleton rows={2} cols={3} />)
    // Every animated bar is aria-hidden so the only thing announced is the
    // single "Loading" status label, not a wall of empty boxes.
    const bars = container.querySelectorAll('.animate-pulse')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      expect(bar.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('renders the requested number of rows and columns', () => {
    const { container } = render(<TableSkeleton rows={4} cols={5} />)
    expect(container.querySelectorAll('.animate-pulse').length).toBe(20)
  })
})
