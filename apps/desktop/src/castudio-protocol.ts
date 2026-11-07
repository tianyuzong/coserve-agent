/** Private Electron channels for the local CAStudio service. */
export const CASTUDIO_IPC = {
  request: 'coserve-castudio:request',
  subscribe: 'coserve-castudio:subscribe',
  unsubscribe: 'coserve-castudio:unsubscribe',
  event: 'coserve-castudio:event',
  workspace: 'coserve-castudio:workspace',
} as const

/** Event envelope emitted by the CAStudio project event stream. */
export interface CAStudioEvent {
  id: number
  type: string
  data: unknown
}

/** One desktop subscription's data or terminal connection failure. */
export interface CAStudioEventMessage {
  subscriptionId: string
  event?: CAStudioEvent
  error?: string
}
