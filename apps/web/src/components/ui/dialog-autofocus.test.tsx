// @vitest-environment jsdom
import '../../test/interaction-setup'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTrigger } from './dialog'

function Harness({ withAutofocus }: { withAutofocus: boolean }) {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent title="Add something">
        <form>
          <input aria-label="First field" {...(withAutofocus ? { 'data-autofocus': true } : {})} />
          <input aria-label="Second field" />
        </form>
      </DialogContent>
    </Dialog>
  )
}

describe('DialogContent initial focus', () => {
  it('focuses the [data-autofocus] field when the dialog opens', async () => {
    const user = userEvent.setup()
    render(<Harness withAutofocus />)

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByLabelText('First field')).toHaveFocus()
    })
  })

  it('leaves Radix default focus (the close button) when no field opts in', async () => {
    const user = userEvent.setup()
    render(<Harness withAutofocus={false} />)

    await user.click(screen.getByText('Open'))

    // Without an opt-in target, focus must not land on a form field; Radix's
    // default sends it to the close button instead.
    await waitFor(() => {
      expect(screen.getByLabelText('Close')).toHaveFocus()
    })
    expect(screen.getByLabelText('First field')).not.toHaveFocus()
  })
})
