export type SecretTicket = { request: number }

export type SecretClientState = {
  /** Begin a request bound to this gate; aborts any in-flight request. */
  begin: () => { ticket: SecretTicket; signal: AbortSignal }
  /** True only while no newer request or unmount superseded this ticket. */
  isCurrent: (ticket: SecretTicket) => boolean
  /** Abort the in-flight request and stale its ticket (unmount/close). */
  cancel: () => void
}

/**
 * Stale-result guard for the settings page: a response must only be applied
 * to the exact request generation it was issued from, so a late resolution
 * after another load or an unmount is dropped instead of overwriting state.
 * Writes stay outside the gate on purpose — a save or delete is a deliberate
 * user action, never a replayed background read.
 */
export function createSecretClientState(): SecretClientState {
  let request = 0
  let controller: AbortController | null = null
  return {
    begin: () => {
      controller?.abort()
      controller = new AbortController()
      request += 1
      return { ticket: { request }, signal: controller.signal }
    },
    isCurrent: (ticket) => ticket.request === request,
    cancel: () => {
      controller?.abort()
      controller = null
      request += 1
    },
  }
}
