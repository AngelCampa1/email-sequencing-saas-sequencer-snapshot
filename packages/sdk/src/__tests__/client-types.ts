import type {
  EventResponse,
  LeadMagnetDownloadResponse,
  SequencerClient,
  UnsubscribeResponse,
} from '../index'

type LeadMagnetDownloadRequest = Parameters<SequencerClient['downloadLeadMagnet']>[1]
type ProductUnsubscribeRequest = Parameters<SequencerClient['unsubscribe']>[0]
type FireEventOptions = Parameters<SequencerClient['fireEvent']>[1]

const leadMagnetDownloadRequest: LeadMagnetDownloadRequest = {
  email: 'user@example.com',
  source: 'lead_magnet_form',
  utm: { source: 'site' },
}

const productUnsubscribeRequest: ProductUnsubscribeRequest = {
  email: 'user@example.com',
  product: 'camaudit',
  scope: 'product',
  reason: 'manual',
}

// @ts-expect-error Product API unsubscribe calls must name the product owned by the Access token.
const missingProductUnsubscribeRequest: ProductUnsubscribeRequest = {
  email: 'user@example.com',
}

const globalUnsubscribeRequest: ProductUnsubscribeRequest = {
  email: 'user@example.com',
  product: 'camaudit',
  // @ts-expect-error Product API service tokens cannot create global suppressions.
  scope: 'global',
}

const unsubscribeSuccess: UnsubscribeResponse = {
  ok: true,
  email: 'user@example.com',
  scope: 'product',
  notified_runs: 1,
}

const unsubscribeDeliveryFailure: UnsubscribeResponse = {
  ok: false,
  error: 'unsubscribe_delivery_failed',
  email: 'user@example.com',
  scope: 'product',
  notified_runs: 1,
  failed_runs: ['run_failed'],
}

const leadMagnetConversionDeliveryFailure: LeadMagnetDownloadResponse = {
  ok: false,
  error: 'conversion_event_delivery_failed',
  detail: 'Lead magnet asset is available, but conversion event delivery failed',
  asset_url: 'https://sequencer.ventoralabs.com/assets/lead-magnets/tenant?token=tok_1',
  run_id: 'run_1',
  status: 'already_running',
  notified_runs: 1,
  failed_runs: ['run_failed'],
}

const idempotentEventReplay: EventResponse = {
  ok: true,
  event: 'reply_received',
  notified_runs: 0,
  duplicate: true,
  in_progress: true,
}

const eventTransition: EventResponse = {
  ok: true,
  event: 'onboarding_completed',
  notified_runs: 1,
  transitioned_runs: ['run_dollar_trail'],
}

const fireEventOptions: FireEventOptions = {
  idempotencyKey: 'event-key',
}

void leadMagnetDownloadRequest
void productUnsubscribeRequest
void missingProductUnsubscribeRequest
void globalUnsubscribeRequest
void unsubscribeSuccess
void unsubscribeDeliveryFailure
void leadMagnetConversionDeliveryFailure
void idempotentEventReplay
void eventTransition
void fireEventOptions
