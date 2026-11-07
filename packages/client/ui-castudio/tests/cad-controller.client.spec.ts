import { describe, expect, it, vi } from 'vitest'
import { CadController, projectForWorkspace } from '../src/client/cad-controller.ts'
import type { StudioBridge } from '../src/client/types.ts'

describe('native CAD workspace integration', () => {
  const project = { id: 'project-1', name: 'CAD', workspacePath: 'C:\\CAD\\project' }
  const bridge = () => ({
    request: vi.fn(async (path: string) => path === '/api/dsh/projects' ? [project] : project),
    workspaceUrl: vi.fn(async () => 'http://127.0.0.1:4317/?embedded=1&project=project-1'),
    subscribe: vi.fn(), unsubscribe: vi.fn(), onEvent: vi.fn(),
  }) as unknown as StudioBridge

  it('prepares the project and opens its actual native workspace without starting a Pi conversation', async () => {
    const transport = bridge(), open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    await controller.open(project.id)
    expect(transport.request).toHaveBeenNthCalledWith(1, '/api/dsh/projects')
    expect(transport.request).toHaveBeenNthCalledWith(2, '/api/dsh/projects/project-1/prepare', 'POST')
    expect(transport.request).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ ...project, workspaceUrl: expect.stringContaining('harness=dsh') }))
    expect(transport.subscribe).not.toHaveBeenCalled()
    expect(projectForWorkspace(controller.snapshot.getSnapshot().projects, 'c:/CAD/project/')).toBeDefined()
    expect(projectForWorkspace(controller.snapshot.getSnapshot().projects, 'C:/CAD/project-other')).toBeUndefined()
  })

  it('does not navigate when preparation fails and allows a retry', async () => {
    const transport = bridge(), open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    vi.mocked(transport.request).mockRejectedValueOnce(new Error('service unavailable'))
    await controller.open(project.id)
    expect(open).not.toHaveBeenCalled()
    expect(controller.snapshot.getSnapshot()).toMatchObject({ pending: false, error: expect.stringContaining('service unavailable') })
    await controller.open(project.id)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does not navigate after disposal while preparation is in flight', async () => {
    const transport = bridge(), open = vi.fn(async () => {})
    const controller = new CadController(transport, open)
    await controller.load()
    let release!: () => void
    vi.mocked(transport.request).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(project) }))
    const pending = controller.open(project.id)
    controller.dispose()
    release()
    await pending
    expect(open).not.toHaveBeenCalled()
  })
})
