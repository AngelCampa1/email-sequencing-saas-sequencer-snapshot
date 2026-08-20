// @vitest-environment jsdom
import '../test/interaction-setup'

import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useUrlState } from './use-url-state'

function makeWrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(MemoryRouter, { initialEntries }, children)
  }
}

describe('useUrlState', () => {
  it('reads an existing param from the URL', () => {
    const { result } = renderHook(() => useUrlState('foo'), {
      wrapper: makeWrapper(['/?foo=bar']),
    })
    expect(result.current[0]).toBe('bar')
  })

  it('returns defaultValue when param is absent', () => {
    const { result } = renderHook(() => useUrlState('missing', 'default-val'), {
      wrapper: makeWrapper(['/']),
    })
    expect(result.current[0]).toBe('default-val')
  })

  it('returns empty string when param is absent and no default', () => {
    const { result } = renderHook(() => useUrlState('missing'), {
      wrapper: makeWrapper(['/']),
    })
    expect(result.current[0]).toBe('')
  })

  it('setter updates the param value', () => {
    const { result } = renderHook(() => useUrlState('foo'), {
      wrapper: makeWrapper(['/?foo=bar']),
    })
    act(() => {
      result.current[1]('newval')
    })
    expect(result.current[0]).toBe('newval')
  })

  it('setter to empty string removes the param', () => {
    const { result } = renderHook(() => useUrlState('foo'), {
      wrapper: makeWrapper(['/?foo=bar']),
    })
    act(() => {
      result.current[1]('')
    })
    expect(result.current[0]).toBe('')
  })

  it('setter to the defaultValue removes the param', () => {
    const { result } = renderHook(() => useUrlState('tab', 'global'), {
      wrapper: makeWrapper(['/?tab=product']),
    })
    act(() => {
      result.current[1]('global')
    })
    // after removing, reading with defaultValue returns 'global'
    expect(result.current[0]).toBe('global')
  })

  it('preserves other existing params when setting', () => {
    // We track two keys independently — set one and make sure the other survives
    const { result: r1 } = renderHook(() => useUrlState('foo'), {
      wrapper: makeWrapper(['/?foo=a&other=keep']),
    })
    const { result: r2 } = renderHook(() => useUrlState('other'), {
      wrapper: makeWrapper(['/?foo=a&other=keep']),
    })

    act(() => {
      r1.current[1]('changed')
    })

    // The 'other' hook is on its own MemoryRouter so it isn't affected —
    // what matters is the setter passes prev-params through, not that both
    // hooks share state. To test real param preservation we need a shared router.
    expect(r2.current[0]).toBe('keep')
  })

  it('preserves other params in the same router context when setting', () => {
    // Use a single hook that reads two keys by calling useUrlState twice inside one component
    const { result } = renderHook(
      () => ({
        foo: useUrlState('foo'),
        other: useUrlState('other'),
      }),
      {
        wrapper: makeWrapper(['/?foo=a&other=keep']),
      },
    )

    act(() => {
      result.current.foo[1]('changed')
    })

    expect(result.current.foo[0]).toBe('changed')
    expect(result.current.other[0]).toBe('keep')
  })
})
