// @vitest-environment jsdom
import '../../test/interaction-setup'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TablePagination } from './table-pagination'

describe('TablePagination click handlers', () => {
  it('calls onPrev when Prev button is clicked', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<TablePagination page={2} pageSize={10} total={50} onPrev={onPrev} onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: /prev/i }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('calls onNext when Next button is clicked', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<TablePagination page={1} pageSize={10} total={50} onPrev={onPrev} onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('does not call onPrev when Prev is disabled (page 1)', () => {
    const onPrev = vi.fn()
    render(<TablePagination page={1} pageSize={10} total={50} onPrev={onPrev} onNext={vi.fn()} />)
    const prevBtn = screen.getByRole('button', { name: /prev/i })
    expect(prevBtn).toBeDisabled()
    fireEvent.click(prevBtn)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('does not call onNext when Next is disabled (last page)', () => {
    const onNext = vi.fn()
    render(<TablePagination page={5} pageSize={10} total={50} onPrev={vi.fn()} onNext={onNext} />)
    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).toBeDisabled()
    fireEvent.click(nextBtn)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('calls onPageSizeChange with the numeric value when page-size select changes', async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()
    render(
      <TablePagination
        page={1}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={onPageSizeChange}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    // Drive the real Radix Select so the component's onValueChange→Number(v)
    // conversion arrow is exercised end to end.
    await user.click(screen.getByRole('combobox', { name: /rows per page/i }))
    await waitFor(() => {
      expect(screen.getByRole('option', { name: '25' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('option', { name: '25' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(25)
  })
})
