import { describe, expect, it, vi } from 'vitest'
import { CadController, cadErrorKind, projectForWorkspace } from '../src/client/cad-controller.ts'
import type { StudioBridge } from '../src/client/types.ts'

interface Row { id: string; name: string; workspacePath: string }

/** A transport that answers like the local CAD service and tracks the projects it created. */
function harness() {
  const projects: Row[] = [{ id: 'project-1', name: 'CAD', workspacePath: 'C:\\CAD\\project' }]
  const request = vi.fn(async (path: string, method?: string) => {
    if (path === '/api/dsh/projects') return projects.map(item => ({ ...item }))
    if (path === '/api/projects' && method === 'POST') {
      const created = { id: 'project-2', name: '新设计', workspacePath: 'C:\\CAD\\project-2' }
      projects.push(created)
      return { ...created }
    }
    if (method === 'DELETE' && path.startsWith('/api/projects/')) {
      const id = path.slice('/api/projects/'.length)
      projects.splice(projects.findIndex(item => item.id === id), 1)
      return { deleted: true, id }
    }
    return { ok: true }
  })
  const transport = {
    request, subscribe: vi.fn(), unsubscribe: vi.fn(), onEvent: vi.fn(),
    workspaceUrl: vi.fn(async (id: string) => `http://127.0.0.1:4317/?embedded=1&project=${id}`),
  } as unknown as StudioBridge
  return { transport, request, projects }
}

const createdProject = expect.objectContaining({ id: 'project-2', name: '新设计' })

describe('native CAD workspace integration', () => {
  it('prepares the project and opens its actual native workspace without starting a Pi conversation', async () => {
    const { transport, request } = harness()
    const open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    expect(await controller.open('project-1')).toBe(true)
    expect(request).toHaveBeenNthCalledWith(1, '/api/dsh/projects')
    expect(request).toHaveBeenNthCalledWith(2, '/api/dsh/projects/project-1/prepare', 'POST')
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1', workspacePath: 'C:\\CAD\\project', workspaceUrl: expect.stringContaining('harness=dsh') }))
    expect(transport.subscribe).not.toHaveBeenCalled()
    expect(projectForWorkspace(controller.snapshot.getSnapshot().projects, 'c:/CAD/project/')).toBeDefined()
    expect(projectForWorkspace(controller.snapshot.getSnapshot().projects, 'C:/CAD/project-other')).toBeUndefined()
  })

  it('reports preparation failures as operation errors and allows a retry', async () => {
    const { transport, request } = harness()
    const open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    request.mockRejectedValueOnce(new Error('service unavailable'))
    expect(await controller.open('project-1')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(controller.snapshot.getSnapshot()).toMatchObject({ pending: false, error: { kind: 'operation', message: expect.stringContaining('service unavailable') } })
    expect(await controller.open('project-1')).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does not navigate after disposal while preparation is in flight', async () => {
    const { transport, request } = harness()
    const open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    let release!: () => void
    request.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }) }))
    const pending = controller.open('project-1')
    controller.dispose()
    release()
    expect(await pending).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('distinguishes an unreachable service from a rejected operation', () => {
    expect(cadErrorKind(new TypeError('fetch failed'))).toBe('connection')
    expect(cadErrorKind(new Error('connect ECONNREFUSED 127.0.0.1:4317'))).toBe('connection')
    expect(cadErrorKind(new Error('项目里还有 2 个文件'))).toBe('operation')
  })

  it('creates a project and opens it only after it exists', async () => {
    const { transport, request } = harness()
    const open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    expect(await controller.create('新设计', 'open')).toBe(true)
    expect(request).toHaveBeenCalledWith('/api/projects', 'POST', { name: '新设计' })
    expect(open).toHaveBeenCalledWith(createdProject)
    expect(controller.snapshot.getSnapshot()).toMatchObject({
      notice: null,
      error: null,
      projects: expect.arrayContaining([createdProject]),
    })
  })

  it('keeps a created project when opening its workspace fails, and retries without recreating it', async () => {
    const { transport, request } = harness()
    const open = vi.fn(async (): Promise<void> => { throw new Error('workspace busy') })
    const controller = new CadController(transport, open)
    await controller.load()
    expect(await controller.create('新设计', 'open')).toBe(true)
    const state = controller.snapshot.getSnapshot()
    expect(state.error).toBeNull()
    expect(state.notice).toMatchObject({ kind: 'open-failed', projectId: 'project-2', projectName: '新设计' })
    expect(state.projects.map(project => project.id)).toEqual(['project-1', 'project-2'])
    open.mockResolvedValue(undefined)
    expect(await controller.retryOpen('project-2')).toBe(true)
    expect(open).toHaveBeenCalledTimes(2)
    expect(controller.snapshot.getSnapshot().notice).toBeNull()
    expect(request.mock.calls.filter(([path, method]) => path === '/api/projects' && method === 'POST')).toHaveLength(1)
  })

  it('creates without leaving the current conversation when asked to', async () => {
    const { transport } = harness()
    const open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    expect(await controller.create('新设计', 'keep')).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(controller.snapshot.getSnapshot().notice).toMatchObject({ kind: 'created', projectId: 'project-2' })
    controller.dismissNotice()
    expect(controller.snapshot.getSnapshot().notice).toBeNull()
  })

  it('deletes a project and drops the DSH workspace registered for it', async () => {
    const { transport, request } = harness()
    const forget = vi.fn(async () => {})
    const controller = new CadController(transport, async () => {}, forget)
    await controller.load()
    expect(await controller.remove('project-1')).toBe(true)
    expect(request).toHaveBeenCalledWith('/api/projects/project-1', 'DELETE')
    expect(forget).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1' }))
    expect(controller.snapshot.getSnapshot().projects).toEqual([])
  })

  it('surfaces a refused delete instead of dropping the project locally', async () => {
    const { transport, request } = harness()
    const controller = new CadController(transport, async () => {})
    await controller.load()
    request.mockRejectedValueOnce(new Error('项目里还有 2 个文件（例如 models/a.step），请先清空模型和产物再删除'))
    expect(await controller.remove('project-1')).toBe(false)
    expect(controller.snapshot.getSnapshot().error).toMatchObject({ kind: 'operation' })
    expect(controller.snapshot.getSnapshot().projects.map(project => project.id)).toEqual(['project-1'])
  })
})
