/** CAstudio's existing REST and SSE wire contracts, independent of DSH Sessions. */
export interface StudioProject { id: string; name: string; createdAt: string; updatedAt: string }
export interface StudioMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  timestamp: number
  toolName?: string
  args?: unknown
  error?: boolean
}
export interface StudioRow extends StudioMessage { pending?: boolean }
export interface StudioEvent { id: number; type: string; data: unknown }
export interface StudioEventEnvelope { subscriptionId: string; event?: StudioEvent; error?: string }
export interface StudioStatus {
  pi: string
  hasCredentials: boolean
  busyProjects: string[]
  models: { provider: string; id: string; name: string }[]
  settings: { provider: string; model: string; thinking: string }
}
export interface StudioBridge {
  request(path: string, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<unknown>
  subscribe(projectId: string, subscriptionId: string, afterEventId?: number): Promise<void>
  unsubscribe(subscriptionId: string): Promise<void>
  onEvent(listener: (message: StudioEventEnvelope) => void): () => void
  workspaceUrl(projectId: string): Promise<string>
}
export interface StudioState {
  phase: 'loading' | 'ready' | 'error'
  projects: StudioProject[]
  projectId: string | null
  messages: StudioRow[]
  status: StudioStatus | null
  workspaceUrl: string | null
  busy: boolean
  pending: boolean
  connected: boolean
  error: string | null
  draft: string
  selection: unknown
}
