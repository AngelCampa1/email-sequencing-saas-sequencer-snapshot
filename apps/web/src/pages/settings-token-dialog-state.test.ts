import { describe, expect, it } from 'vitest'
import {
  canSubmitTokenMapping,
  initialTokenDialogFormState,
  tokenDialogFormReducer,
} from './SettingsPage'

describe('service token setup dialog form state', () => {
  it('resets canceled token mapping input when the dialog closes', () => {
    const state = {
      ...initialTokenDialogFormState,
      label: 'Production token',
      accessServiceTokenId: '00000000000000000000000000000000.access',
      submitError: 'failed',
    }

    expect(tokenDialogFormReducer(state, { type: 'dialogClosed' })).toEqual(
      initialTokenDialogFormState,
    )
  })

  it('resets token mapping input after a successful save', () => {
    const state = {
      ...initialTokenDialogFormState,
      label: 'Production token',
      accessServiceTokenId: '00000000000000000000000000000000.access',
    }

    expect(tokenDialogFormReducer(state, { type: 'submitSucceeded' })).toEqual(
      initialTokenDialogFormState,
    )
  })

  it('rejects invalid Access client ids before mutation submission', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_camaudit',
        accessServiceTokenId: 'not-a-token',
      }),
    ).toBe(false)
  })

  it('accepts trimmed Cloudflare Access client ids for mutation submission', () => {
    expect(
      canSubmitTokenMapping({
        isPending: false,
        productId: 'prod_camaudit',
        accessServiceTokenId: ' 00000000000000000000000000000000.access ',
      }),
    ).toBe(true)
  })
})
