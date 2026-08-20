// @vitest-environment jsdom
import '../../test/interaction-setup'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortableHeader } from './sortable-header'

describe('SortableHeader: onToggle click', () => {
  it('calls onToggle with the field key when clicked', () => {
    const onToggle = vi.fn()
    render(
      <table>
        <thead>
          <tr>
            <SortableHeader field="name" sort={null} onToggle={onToggle}>
              Name
            </SortableHeader>
          </tr>
        </thead>
      </table>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith('name')
  })

  it('calls onToggle with the correct field when there are multiple headers', () => {
    const onToggle = vi.fn()
    render(
      <table>
        <thead>
          <tr>
            <SortableHeader field="name" sort={null} onToggle={onToggle}>
              Name
            </SortableHeader>
            <SortableHeader field="email" sort={null} onToggle={onToggle}>
              Email
            </SortableHeader>
          </tr>
        </thead>
      </table>,
    )
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onToggle).toHaveBeenCalledWith('email')
  })
})
