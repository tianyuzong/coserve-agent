// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { applyStudioEvent, StudioController } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import type { StudioBridge, StudioEventEnvelope, StudioMessage, StudioState, StudioStatus } from '../src/client/types.ts'

const projects = [{ id: 'project-one', name: 'Design one', createdAt: '', updatedAt: '' }, { id: 'project-two', name: 'Design two', createdAt: '', updatedAt: '' }]
const status: StudioStatus = { pi: '0.85.1', models: [{ provider: 'studio', id: 'model', name: 'Model' }], settings: { provider: 'studio', model: 'model', thinking: 'off' }, hasCredentials: true, busyProjects: [] }

function fixture() {
  let listener: ((message: StudioEventEnvelope) => void) | undefined
  const subscriptions = new Map<string, string>()
  const bridge: StudioBridge = {
    request: vi.fn(async path => path === '/api/projects' ? projects : path === '/api/status' ? status : []),
    subscribe: vi.fn(async (projectId, id) => { subscriptions.set(projectId, id) }),
    unsubscribe: vi.fn(async () => {}),
    onEvent: (callback) => { listener = callback; return () => { listener = undefined } },
    workspaceUrl: async id => `http://127.0.0.1:4317/?embedded=1&project=${id}`,
  }
  const reportTeardownError = vi.fn()
  const controller = new StudioController(bridge, key => en[key], reportTeardownError)
  const emit = (type: string, data: unknown, id: number, projectId = 'project-one') => listener?.({ subscriptionId: subscriptions.get(projectId)!, event: { id, type, data } })
  return {
    controller, bridge, emit, subscriptions, reportTeardownError,
    sendEnvelope: (message: StudioEventEnvelope) => listener?.(message),
  }
}

describe('CAstudio native conversation adapter', () => {
  it('loads saved tool arguments on every project reopening', async () => {
    const f = fixture()
    const history: StudioMessage[] = [{ id: 'saved-read', role: 'tool', toolName: 'read', timestamp: 1,
      args: { path: 'model.py' }, text: 'diameter = 42' }]
    vi.mocked(f.bridge.request).mockImplementation(async path => path === '/api/projects' ? projects : path === '/api/status' ? status : history)
    await f.controller.load()
    expect(f.controller.snapshot.getSnapshot().messages).toEqual(history)
    await f.controller.selectProject('project-two')
    await f.controller.selectProject('project-one')
    expect(f.controller.snapshot.getSnapshot().messages[0]?.args).toEqual({ path: 'model.py' })
    await f.controller.dispose()
  })

  it('renders one real streamed assistant settlement and preserves tool arguments and failures', async () => {
    const f = fixture()
    await f.controller.load()
    f.emit('delta', { id: 'answer', text: 'Hello ' }, 1)
    f.emit('delta', { id: 'answer', text: 'world' }, 2)
    f.emit('delta', { id: 'answer', text: 'world' }, 2)
    f.emit('message', { id: 'answer', role: 'assistant', text: 'Hello world', timestamp: 1 }, 3)
    f.emit('tool_start', { id: 'tool', toolName: 'powershell', args: { command: 'Get-ChildItem' } }, 4)
    f.emit('tool_update', { id: 'tool', text: 'partial' }, 5)
    f.emit('message', { id: 'tool', role: 'tool', toolName: 'powershell', text: 'failure', error: true, timestamp: 2 }, 6)
    expect(f.controller.snapshot.getSnapshot().messages).toMatchObject([
      { id: 'answer', text: 'Hello world', pending: false },
      { id: 'tool', text: 'failure', error: true, args: { command: 'Get-ChildItem' }, pending: false },
    ])
    await f.controller.dispose()
  })

  it('forwards the actual prompt and selection without inventing an optimistic transcript', async () => {
    const f = fixture()
    await f.controller.load()
    f.controller.setDraft('Create a bracket')
    await f.controller.send()
    expect(f.bridge.request).toHaveBeenCalledWith('/api/projects/project-one/prompt', 'POST', { text: 'Create a bracket', selection: null })
    expect(f.controller.snapshot.getSnapshot().messages).toEqual([])
    f.emit('message', { id: 'user', role: 'user', text: 'Create a bracket', timestamp: 1 }, 1)
    f.emit('run_start', {}, 2)
    expect(f.controller.snapshot.getSnapshot().busy).toBe(true)
    await f.controller.stop()
    expect(f.bridge.request).toHaveBeenCalledWith('/api/projects/project-one/stop', 'POST')
    expect(f.controller.snapshot.getSnapshot().busy).toBe(true)
    f.emit('run_end', {}, 3)
    expect(f.controller.snapshot.getSnapshot().busy).toBe(false)
    await f.controller.dispose()
  })

  it('keeps events emitted while history loads and does not erase a stream failure', async () => {
    const f = fixture()
    let settleHistory!: (messages: StudioMessage[]) => void
    vi.mocked(f.bridge.request).mockImplementation(async (path) => {
      if (path === '/api/projects') return projects
      if (path === '/api/status') return status
      return new Promise<StudioMessage[]>((resolve) => { settleHistory = resolve })
    })
    const loading = f.controller.load()
    await vi.waitFor(() => expect(settleHistory).toBeTypeOf('function'))
    f.emit('message', { id: 'live', role: 'assistant', text: 'Live', timestamp: 2 }, 1)
    f.emit('run_start', {}, 2)
    f.sendEnvelope({ subscriptionId: f.subscriptions.get('project-one')!, error: 'stream interrupted' })
    settleHistory([{ id: 'past', role: 'user', text: 'Earlier', timestamp: 1 }])
    await loading
    expect(f.controller.snapshot.getSnapshot()).toMatchObject({ connected: false, busy: true, error: 'stream interrupted' })
    expect(f.controller.snapshot.getSnapshot().messages.map(row => row.id)).toEqual(['past', 'live'])
    await f.controller.dispose()
  })

  it('unsubscribes the old project, rejects its late events, and retains unsent drafts', async () => {
    const f = fixture()
    await f.controller.load()
    const oldSubscription = f.subscriptions.get('project-one')!
    f.controller.setDraft('Unsent idea')
    await f.controller.selectProject('project-two')
    expect(f.bridge.unsubscribe).toHaveBeenCalledWith(oldSubscription)
    f.emit('message', { id: 'stale', role: 'assistant', text: 'Wrong project', timestamp: 1 }, 1)
    expect(f.controller.snapshot.getSnapshot().messages).toEqual([])
    await f.controller.selectProject('project-one')
    expect(f.controller.snapshot.getSnapshot().draft).toBe('Unsent idea')
    await f.controller.dispose()
  })

  it('accepts viewport context only from the configured iframe, origin and project', async () => {
    const f = fixture()
    await f.controller.load()
    const frame = document.createElement('iframe')
    document.body.append(frame)
    f.controller.bindWorkbench(frame)
    const message = { type: 'castudio:selection', projectId: 'project-one', selection: { file: 'part.step', face: 3 } }
    const dispatch = (origin: string, source: Window | null, data = message) => f.controller.receiveWorkbench(new MessageEvent('message', { origin, source, data }))
    dispatch('https://elsewhere.example', frame.contentWindow)
    dispatch('http://127.0.0.1:4317', window)
    dispatch('http://127.0.0.1:4317', frame.contentWindow, { ...message, projectId: 'project-two' })
    expect(f.controller.snapshot.getSnapshot().selection).toBeNull()
    dispatch('http://127.0.0.1:4317', frame.contentWindow)
    expect(f.controller.snapshot.getSnapshot().selection).toEqual(message.selection)
    f.controller.setDraft('Change the face')
    await f.controller.send()
    expect(f.bridge.request).toHaveBeenCalledWith('/api/projects/project-one/prompt', 'POST', { text: 'Change the face', selection: message.selection })
    frame.remove()
    await f.controller.dispose()
  })

  it('keeps a rejected prompt in the composer with the backend error', async () => {
    const f = fixture()
    await f.controller.load()
    f.controller.setDraft('Keep this request')
    vi.mocked(f.bridge.request).mockRejectedValueOnce(new Error('Model unavailable'))
    await f.controller.send()
    expect(f.controller.snapshot.getSnapshot()).toMatchObject({ draft: 'Keep this request', pending: false, error: 'Message could not be sent: Model unavailable' })
    await f.controller.dispose()
  })

  it('leaves unrelated CAD events outside the chat transcript', () => {
    const state: StudioState = fixture().controller.snapshot.getSnapshot()
    expect(applyStudioEvent(state, { id: 1, type: 'artifacts_changed', data: {} })).toBe(state)
  })

  it('rejects damaged external messages without breaking the transcript', async () => {
    const f = fixture()
    await f.controller.load()
    f.emit('message', null, 1)
    f.emit('message', { id: 'bad', role: 'assistant', text: 42, timestamp: 1 }, 2)
    f.emit('message', { id: 'bad', role: 'unknown', text: 'bad', timestamp: 1 }, 3)
    f.emit('message', { id: 'bad', role: 'assistant', text: 'bad', timestamp: null }, 4)
    f.emit('message', { id: 'valid', role: 'assistant', text: 'Valid', timestamp: 1 }, 5)
    expect(f.controller.snapshot.getSnapshot().messages).toMatchObject([{ id: 'valid', text: 'Valid' }])
    await f.controller.dispose()
  })

  it('owns an unsubscribe failure during teardown', async () => {
    const f = fixture()
    await f.controller.load()
    const failure = new Error('Bridge stopped')
    vi.mocked(f.bridge.unsubscribe).mockRejectedValueOnce(failure)
    await expect(f.controller.dispose()).resolves.toBeUndefined()
    expect(f.reportTeardownError).toHaveBeenCalledWith(failure)
  })

  it('updates embedded appearance without navigating its editor', async () => {
    const f = fixture()
    f.controller.setTheme('dark')
    await f.controller.load()
    const url = f.controller.snapshot.getSnapshot().workspaceUrl
    expect(new URL(url!).searchParams.get('theme')).toBe('dark')
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    f.controller.bindWorkbench(frame)
    f.controller.setTheme('light')
    expect(post).toHaveBeenCalledWith({ type: 'castudio:theme', projectId: 'project-one', theme: 'light' }, 'http://127.0.0.1:4317')
    expect(f.controller.snapshot.getSnapshot().workspaceUrl).toBe(url)
    frame.remove()
    await f.controller.dispose()
  })
})
