import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { StudioBridge } from './types.ts'

/** A CAD project is an ordinary DSH filesystem workspace. */
export interface CadProject { id: string; name: string; workspacePath: string; workspaceUrl: string }
export interface CadState { projects: CadProject[]; pending: boolean; error: string | null; theme: 'light' | 'dark' }

/** Match the canonical Windows path without depending on Node in the renderer. */
export function projectForWorkspace(projects: readonly CadProject[], directory: string | undefined): CadProject | undefined {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return directory ? projects.find(project => normalize(project.workspacePath) === normalize(directory)) : undefined
}

/** Own project discovery only. Conversation, models and execution remain with DSH. */
export class CadController {
  readonly snapshot = createSnapshotStore<CadState>({ projects: [], pending: false, error: null, theme: 'light' })
  private disposed = false
  constructor(private readonly bridge: StudioBridge, private readonly openWorkspace: (project: CadProject) => Promise<void>) {}

  private async projects(): Promise<void> {
    const response = await this.bridge.request('/api/dsh/projects')
    if (!Array.isArray(response) || !response.every(project => project && typeof project.id === 'string'
      && typeof project.name === 'string' && typeof project.workspacePath === 'string')) throw new Error('Invalid CAD project response')
    const projects = await Promise.all(response.map(async (project) => {
      const url = new URL(await this.bridge.workspaceUrl(project.id))
      url.searchParams.set('harness', 'dsh')
      return {
        id: project.id as string, name: project.name as string,
        workspacePath: project.workspacePath as string, workspaceUrl: url.href,
      }
    }))
    if (!this.disposed) this.snapshot.update((state) => { state.projects = projects })
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.disposed || this.snapshot.getSnapshot().pending) return
    this.snapshot.update((state) => { state.pending = true; state.error = null })
    try { await action() }
    catch (error) { if (!this.disposed) this.snapshot.update((state) => { state.error = String(error) }) }
    finally { if (!this.disposed) this.snapshot.update((state) => { state.pending = false }) }
  }

  async load(): Promise<void> { await this.run(() => this.projects()) }
  private async openProject(id: string): Promise<void> {
    const project = this.snapshot.getSnapshot().projects.find(item => item.id === id)
    if (!project) throw new Error('CAD project not found')
    await this.bridge.request(`/api/dsh/projects/${encodeURIComponent(id)}/prepare`, 'POST')
    if (!this.disposed) await this.openWorkspace(project)
  }
  async open(id: string): Promise<void> { await this.run(() => this.openProject(id)) }
  async create(name: string): Promise<void> {
    await this.run(async () => {
      const created = await this.bridge.request('/api/projects', 'POST', { name }) as { id: string }
      await this.projects()
      if (!this.disposed) await this.openProject(created.id)
    })
  }
  setTheme(theme: 'light' | 'dark'): void { this.snapshot.update((state) => { state.theme = theme }) }
  dispose(): void { this.disposed = true }
}
