// @vitest-environment jsdom
import '../../test/interaction-setup'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the csv module so downloadCsv is spied on
vi.mock('../../lib/csv', () => ({
  toCsv: vi.fn(() => 'Name\r\nAlice'),
  downloadCsv: vi.fn(),
}))

import * as csvModule from '../../lib/csv'
import { ExportButton } from './data-export'

const cols = [{ header: 'Name', accessor: (r: { name: string }) => r.name }]
const rows = [{ name: 'Alice' }]

describe('ExportButton (interaction)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls downloadCsv with filename and csv text when clicked', () => {
    render(<ExportButton rows={rows} columns={cols} filename="export.csv" />)
    fireEvent.click(screen.getByRole('button'))
    expect(csvModule.downloadCsv).toHaveBeenCalledTimes(1)
    expect(csvModule.downloadCsv).toHaveBeenCalledWith('export.csv', 'Name\r\nAlice')
  })

  it('does not call downloadCsv when button is disabled (empty rows)', () => {
    render(<ExportButton rows={[]} columns={cols} filename="export.csv" />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(csvModule.downloadCsv).not.toHaveBeenCalled()
  })

  it('passes the correct csv string from toCsv to downloadCsv', () => {
    const toCsvMock = vi.mocked(csvModule.toCsv)
    toCsvMock.mockReturnValueOnce('Name\r\nBob')
    render(<ExportButton rows={rows} columns={cols} filename="bob.csv" />)
    fireEvent.click(screen.getByRole('button'))
    expect(csvModule.downloadCsv).toHaveBeenCalledWith('bob.csv', 'Name\r\nBob')
  })
})
