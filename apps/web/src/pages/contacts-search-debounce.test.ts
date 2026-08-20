import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ContactsSearchTimerRef,
  clearContactsSearchTimer,
  scheduleContactsSearchUpdate,
} from './ContactsPage'

describe('contacts search debounce timer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the previous pending search update before scheduling a new one', () => {
    vi.useFakeTimers()
    const timerRef: ContactsSearchTimerRef = { current: null }
    const updateSearch = vi.fn()

    scheduleContactsSearchUpdate(timerRef, 'first@example.com', updateSearch)
    scheduleContactsSearchUpdate(timerRef, 'second@example.com', updateSearch)
    vi.advanceTimersByTime(300)

    expect(updateSearch).toHaveBeenCalledTimes(1)
    expect(updateSearch).toHaveBeenCalledWith('second@example.com')
  })

  it('cancels a pending search update during cleanup', () => {
    vi.useFakeTimers()
    const timerRef: ContactsSearchTimerRef = { current: null }
    const updateSearch = vi.fn()

    scheduleContactsSearchUpdate(timerRef, 'user@example.com', updateSearch)
    clearContactsSearchTimer(timerRef)
    vi.advanceTimersByTime(300)

    expect(updateSearch).not.toHaveBeenCalled()
    expect(timerRef.current).toBeNull()
  })
})
