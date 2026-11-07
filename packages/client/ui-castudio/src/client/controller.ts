import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { StudioBridge, StudioEvent, StudioEventEnvelope, StudioMessage, StudioProject, StudioRow, StudioState, StudioStatus } from './types.ts'
import type { StudioKey } from './locales.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The external SSE boundary admits only the fields the native transcript uses. */
function studioMessage(value: unknown): value is StudioMessage {
  return record(value) && typeof value.id === 'string' && value.id.length > 0
    && (value.role === 'user' || value.role === 'assistant' || value.role === 'tool' || value.role === 'system')
    && typeof value.text === 'string' && typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
    && (value.toolName === undefined || typeof value.toolName === 'string')
    && (value.error === undefined || typeof value.error === 'boolean')
}

/** Merge by the CAstudio message identity; SSE settlements replace their transient row. */
export function mergeRows(history: readonly StudioRow[], live: readonly StudioRow[]): StudioRow[] {
  const rows = new Map(history.map(row => [row.id, row]))
  for (const row of live) rows.set(row.id, row)
  return [...rows.values()].sort((left, right) => left.timestamp - right.timestamp)
}

/** Fold only events emitted by the existing CAstudio harness. */
export function applyStudioEvent(state: StudioState, event: StudioEvent): StudioState {
  const data = event.data
  if (!record(data)) return state
  const rows = state.messages
  const id = typeof data.id === 'string' ? data.id : ''
  const existing = rows.find(row => row.id === id)
  switch (event.type) {
    case 'message':
      if (!studioMessage(data)) return state
      return { ...state, messages: mergeRows(rows, [{ ...existing, ...data, pending: false }]) }
    case 'delta': {
      if (!id || typeof data.text !== 'string') return state
      const row: StudioRow = { id, role: 'assistant', timestamp: existing?.timestamp ?? Date.now(), text: (existing?.text ?? '') + data.text, pending: true }
      return { ...state, messages: mergeRows(rows, [row]) }
    }
    case 'tool_start': {
      if (!id || typeof data.toolName !== 'string') return state
      return { ...state, messages: mergeRows(rows, [{ id, role: 'tool', toolName: data.toolName, args: data.args, text: '', timestamp: Date.now(), pending: true }]) }
    }
    case 'tool_update':
      if (!existing || typeof data.text !== 'string') return state
      return { ...state, messages: mergeRows(rows, [{ ...existing, text: data.text }]) }
    case 'run_start': return { ...state, busy: true }
    case 'run_end': return { ...state, busy: false, messages: rows.map(row => row.pending ? { ...row, pending: false } : row) }
    default: return state
  }
}

interface ActiveProject {
  projectId: string
  subscriptionId: string
  lastEventId: number
  activityObserved: boolean
}

/** Owns CAstudio data, transport lifetime and draft state across panel remounts. */
export class StudioController {
  readonly snapshot = createSnapshotStore<StudioState>({
    phase: 'loading', projects: [], projectId: null, messages: [], status: null, workspaceUrl: null,
    busy: false, pending: false, connected: false, error: null, draft: '', selection: null,
  })
  private active: ActiveProject | null = null
  private disposed = false
  private workbench: Window | null = null
  private colorScheme: 'light' | 'dark' = 'light'
  private drafts = new Map<string, string>()
  private readonly detachEvents: () => void

  constructor(
    private readonly bridge: StudioBridge,
    private readonly t: (key: StudioKey) => string,
    private readonly reportTeardownError: (error: unknown) => void,
  ) {
    this.detachEvents = bridge.onEvent(message => this.receive(message))
  }

  private fail(key: StudioKey, error: unknown): void {
    if (this.disposed) return
    const detail = error instanceof Error ? error.message : String(error)
    this.snapshot.update((state) => { state.pending = false; state.error = `${this.t(key)}: ${detail}` })
  }

  async load(): Promise<void> {
    if (this.disposed) return
    this.snapshot.update((state) => { state.error = null; state.pending = true })
    try {
      let projects = await this.bridge.request('/api/projects') as StudioProject[]
      if (this.disposed) return
      if (projects.length === 0) {
        projects = [await this.bridge.request('/api/projects', 'POST', { name: this.t('newName') }) as StudioProject]
      }
      if (this.disposed) return
      this.snapshot.update((state) => { state.projects = projects })
      const selected = this.snapshot.getSnapshot().projectId
      const project = projects.find(item => item.id === selected) ?? projects[0]
      if (project) await this.selectProject(project.id)
    } catch (error) {
      if (this.disposed) return
      this.snapshot.update((state) => { state.phase = 'error'; state.connected = false })
      this.fail('connectionFailed', error)
    }
  }

  async selectProject(projectId: string): Promise<void> {
    if (this.disposed) return
    const previous = this.active
    if (previous) this.drafts.set(previous.projectId, this.snapshot.getSnapshot().draft)
    const active: ActiveProject = { projectId, subscriptionId: randomUUID(), lastEventId: 0, activityObserved: false }
    this.active = active
    this.workbench = null
    this.snapshot.update((state) => {
      state.projectId = projectId; state.messages = []; state.workspaceUrl = null; state.phase = 'loading'
      state.error = null; state.pending = true; state.connected = false; state.busy = false
      state.draft = this.drafts.get(projectId) ?? ''; state.selection = null
    })
    try {
      if (previous) await this.bridge.unsubscribe(previous.subscriptionId)
      if (this.active !== active || this.disposed) return
      // The listener and identity are already installed before opening the stream.
      await this.bridge.subscribe(projectId, active.subscriptionId)
      if (this.active !== active || this.disposed) { await this.bridge.unsubscribe(active.subscriptionId); return }
      this.snapshot.update((state) => { state.connected = true })
      const [messages, status, workspaceUrl] = await Promise.all([
        this.bridge.request(`/api/projects/${encodeURIComponent(projectId)}/messages`) as Promise<StudioMessage[]>,
        this.bridge.request('/api/status') as Promise<StudioStatus>,
        this.bridge.workspaceUrl(projectId),
      ])
      if (this.active !== active || this.disposed) return
      this.snapshot.update((state) => {
        state.messages = mergeRows(messages, state.messages)
        const workspace = new URL(workspaceUrl)
        workspace.searchParams.set('theme', this.colorScheme)
        state.status = status; state.workspaceUrl = workspace.href; state.phase = 'ready'; state.pending = false
        if (!active.activityObserved) state.busy = status.busyProjects.includes(projectId)
      })
    } catch (error) {
      if (this.active !== active || this.disposed) return
      this.snapshot.update((state) => { state.phase = 'error'; state.connected = false })
      this.fail('connectionFailed', error)
    }
  }

  private receive(message: StudioEventEnvelope): void {
    const active = this.active
    if (!active || this.disposed || message.subscriptionId !== active.subscriptionId) return
    if (message.error) {
      this.snapshot.update((state) => { state.connected = false; state.error = message.error ?? null })
      return
    }
    const event = message.event
    if (!event || !Number.isSafeInteger(event.id) || typeof event.type !== 'string' || event.id <= active.lastEventId) return
    active.lastEventId = event.id
    if (event.type === 'run_start' || event.type === 'run_end') active.activityObserved = true
    this.snapshot.set(applyStudioEvent(this.snapshot.getSnapshot(), event))
  }

  setDraft(text: string): void { this.snapshot.update((state) => { state.draft = text }) }
  clearSelection(): void { this.snapshot.update((state) => { state.selection = null }) }
  bindWorkbench(element: HTMLIFrameElement | null): void { this.workbench = element?.contentWindow ?? null }

  setTheme(theme: 'light' | 'dark'): void { this.colorScheme = theme; this.workbenchLoaded() }

  /** Synchronize appearance without navigating away from the active CAD editor. */
  workbenchLoaded(): void {
    const state = this.snapshot.getSnapshot()
    if (state.workspaceUrl) this.workbench?.postMessage({ type: 'castudio:theme', projectId: state.projectId, theme: this.colorScheme }, new URL(state.workspaceUrl).origin)
  }

  private async refreshStatus(): Promise<void> {
    try {
      const status = await this.bridge.request('/api/status') as StudioStatus
      if (!this.disposed) this.snapshot.update((state) => { state.status = status })
    } catch (error) { this.fail('connectionFailed', error) }
  }

  /** Accept selection/draft context only from the exact active embedded workspace. */
  receiveWorkbench(event: MessageEvent): void {
    const state = this.snapshot.getSnapshot()
    if (!state.workspaceUrl || event.source !== this.workbench || event.origin !== new URL(state.workspaceUrl).origin) return
    const data: unknown = event.data
    if (!record(data) || data.projectId !== state.projectId) return
    if (data.type === 'castudio:settings-changed') void this.refreshStatus()
    if (data.type === 'castudio:selection') this.snapshot.update((next) => { next.selection = data.selection ?? null })
    if (data.type === 'castudio:draft' && typeof data.text === 'string') {
      this.snapshot.update((next) => {
        next.draft = [next.draft, data.text].filter(Boolean).join('\n\n')
        if ('selection' in data) next.selection = data.selection ?? null
      })
    }
  }

  async createProject(): Promise<void> {
    this.snapshot.update((state) => { state.pending = true; state.error = null })
    try {
      const project = await this.bridge.request('/api/projects', 'POST', { name: this.t('newName') }) as StudioProject
      if (this.disposed) return
      this.snapshot.update((state) => { state.projects = [project, ...state.projects] })
      await this.selectProject(project.id)
    } catch (error) { this.fail('createFailed', error) }
  }

  async send(): Promise<void> {
    const state = this.snapshot.getSnapshot(), active = this.active
    if (!active || state.busy || state.pending || !state.connected || !state.draft.trim()) return
    const text = state.draft
    this.snapshot.update((next) => { next.pending = true; next.error = null })
    try {
      await this.bridge.request(`/api/projects/${encodeURIComponent(active.projectId)}/prompt`, 'POST', { text, selection: state.selection })
      if (this.active !== active || this.disposed) return
      this.snapshot.update((next) => { next.pending = false; if (next.draft === text) next.draft = ''; next.selection = null })
    } catch (error) { if (this.active === active) this.fail('sendFailed', error) }
  }

  async stop(): Promise<void> {
    const active = this.active
    if (!active) return
    this.snapshot.update((state) => { state.pending = true; state.error = null })
    try {
      await this.bridge.request(`/api/projects/${encodeURIComponent(active.projectId)}/stop`, 'POST')
      if (this.active === active && !this.disposed) this.snapshot.update((state) => { state.pending = false })
    } catch (error) { if (this.active === active) this.fail('stopFailed', error) }
  }

  async selectModel(value: string): Promise<void> {
    const state = this.snapshot.getSnapshot()
    const model = state.status?.models.find(item => `${item.provider}/${item.id}` === value)
    if (!model || state.busy || state.pending) return
    this.snapshot.update((next) => { next.pending = true; next.error = null })
    try {
      await this.bridge.request('/api/settings', 'PUT', { ...state.status?.settings, provider: model.provider, model: model.id })
      const status = await this.bridge.request('/api/status') as StudioStatus
      if (!this.disposed) this.snapshot.update((next) => { next.status = status; next.pending = false })
    } catch (error) { this.fail('modelFailed', error) }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.detachEvents()
    const active = this.active
    this.active = null; this.workbench = null
    if (active) {
      try { await this.bridge.unsubscribe(active.subscriptionId) }
      catch (error) { this.reportTeardownError(error) }
    }
  }
}
