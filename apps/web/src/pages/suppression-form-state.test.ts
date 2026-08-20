import { describe, expect, it } from 'vitest'
import type { SuppressionRow } from '../lib/types'
import {
  addSuppressionFormReducer,
  canSubmitAddSuppression,
  initialAddSuppressionFormState,
} from './SuppressionsPage'

describe('add suppression form state', () => {
  it('resets product scope and product selection when the dialog closes', () => {
    const state = {
      ...initialAddSuppressionFormState,
      email: 'user@example.com',
      scope: 'product' as const,
      productId: 'prod_camaudit',
      reason: 'manual',
      submitError: 'failed',
    }

    expect(addSuppressionFormReducer(state, { type: 'dialogClosed' })).toEqual(
      initialAddSuppressionFormState,
    )
  })

  it('resets product scope and product selection after a successful submit', () => {
    const state = {
      ...initialAddSuppressionFormState,
      email: 'user@example.com',
      scope: 'product' as const,
      productId: 'prod_camaudit',
      reason: 'manual',
    }

    expect(addSuppressionFormReducer(state, { type: 'submitSucceeded' })).toEqual(
      initialAddSuppressionFormState,
    )
  })

  it('rejects product-scoped submissions without a selected product', () => {
    expect(
      canSubmitAddSuppression({
        isSaving: false,
        scope: 'product',
        productId: '',
      }),
    ).toBe(false)
  })

  it('accepts global submissions without a selected product', () => {
    expect(
      canSubmitAddSuppression({
        isSaving: false,
        scope: 'global',
        productId: '',
      }),
    ).toBe(true)
  })
})

describe('SuppressionRow source enum coverage', () => {
  it('includes all backend-written source literals', () => {
    // Type-level exhaustiveness guard: if any literal is missing from the union,
    // this satisfies expression will produce a compile error.
    const _allSources = [
      'manual',
      'webhook',
      'list_import',
      'complaint',
      'bounce',
      'suppression',
      'instantly_webhook',
    ] as const satisfies readonly SuppressionRow['source'][]

    expect(_allSources).toHaveLength(7)
  })
})
