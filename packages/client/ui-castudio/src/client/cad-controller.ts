import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { StudioBridge } from './types.ts'

/** A CAD project is an ordinary DSH filesystem workspace. */
export interface CadProject { id: string; name: string; workspacePath: string; workspaceUrl: string }
/** A transport that never answered is unreachable; anything else was answered with a rejection. */
export type CadErrorKind = 'connection' | 'operation'
export interface CadError { kind: CadErrorKind; message: string }
/**
 * What the last project action left behind: a created project waiting to be opened,
 * or a created project whose workspace could not be opened. Both stay recoverable.
 */
export interface CadNotice { kind: 'created' | 'open-failed'; projectId: string; projectName: string; message?: string }
export interface CadState { projects: CadProject[]; pending: boolean; error: CadError | null; notice: CadNotice | null; theme: 'light' | 'dark' }

/** Match the canonical Windows path without depending on Node in the renderer. */
export function projectForWorkspace(projects: readonly CadProject[], directory: string | undefined): CadProject | undefined {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return directory ? projects.find(project => normalize(project.workspacePath) === normalize(directory)) : undefined
}

/** The service rejecting a request is an operation failure; an unanswered request is a connection failure. */
export function cadErrorKind(error: unknown): CadErrorKind {
  const message = String((error as Error)?.message ?? error)
  return /fetch failed|failed to fetch|networkerror|econnrefused|econnreset|etimedout|socket hang up/i.test(message) ? 'connection' : 'operation'
}

/**
 * Own project discovery and lifecycle only. Conversation, models and execution remain with DSH.
 *
 * Creating a project and showing it are two separate steps: the project always exists after a
 * successful create, while opening its workspace can fail on its own and stays retryable.
 */
export class CadController {
  readonly snapshot = createSnapshotStore<CadState>({ projects: [], pending: false, error: null, notice: null, theme: 'light' })
  private disposed = false
  constructor(
    private readonly bridge: StudioBridge,
    /** Register the project's DSH workspace and navigate to it. */
    private readonly openWorkspace: (project: CadProject) => Promise<void>,
    /** Drop the empty DSH workspace a deleted project would otherwise leave in the sidebar. */
    private readonly forgetWorkspace: (project: CadProject) => Promise<void> = async () => {},
  ) {}

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

  private notice(notice: CadNotice | null): void {
    if (!this.disposed) this.snapshot.update((state) => { state.notice = notice })
  }

  /** Resolves to whether the action completed, so the editor can stay open on a rejected name. */
  private async run(action: () => Promise<void>): Promise<boolean> {
    if (this.disposed || this.snapshot.getSnapshot().pending) return false
    this.snapshot.update((state) => { state.pending = true; state.error = null })
    try { await action(); return !this.disposed }
    catch (error) {
      if (!this.disposed) {
        const message = String((error as Error)?.message ?? error)
        this.snapshot.update((state) => { state.error = { kind: cadErrorKind(error), message } })
      }
      return false
    }
    finally { if (!this.disposed) this.snapshot.update((state) => { state.pending = false }) }
  }

  async load(): Promise<boolean> { return this.run(() => this.projects()) }

  private async openProject(id: string): Promise<void> {
    const project = this.snapshot.getSnapshot().projects.find(item => item.id === id)
    if (!project) throw new Error('CAD project not found')
    await this.bridge.request(`/api/dsh/projects/${encodeURIComponent(id)}/prepare`, 'POST')
    if (!this.disposed) await this.openWorkspace(project)
  }

  async open(id: string): Promise<boolean> { return this.run(() => this.openProject(id)) }

  /**
   * Create a project, optionally opening it.
   * `keep` leaves the current conversation alone: the project appears in the project menu.
   * `open` switches to a new session for the project. A failed open is reported as a notice and
   * never discards the project or masks the failure as a lost connection.
   */
  async create(name: string, mode: 'open' | 'keep' = 'open'): Promise<boolean> {
    this.notice(null)
    return this.run(async () => {
      const created = await this.bridge.request('/api/projects', 'POST', { name }) as { id: string }
      await this.projects()
      const project = this.snapshot.getSnapshot().projects.find(item => item.id === created.id)
      if (!project) throw new Error('CAD project not found after creation')
      if (mode === 'keep') { this.notice({ kind: 'created', projectId: project.id, projectName: project.name }); return }
      await this.openCreated(project)
    })
  }

  /** Open a just-created project; a workspace failure becomes a recovery notice, not a dead end. */
  private async openCreated(project: CadProject): Promise<void> {
    this.notice(null)
    try { await this.openProject(project.id) }
    catch (error) {
      if (this.disposed) return
      this.snapshot.update((state) => {
        state.error = null
        state.notice = { kind: 'open-failed', projectId: project.id, projectName: project.name, message: String((error as Error)?.message ?? error) }
      })
    }
  }

  async retryOpen(id: string): Promise<boolean> {
    return this.run(async () => {
      const project = this.snapshot.getSnapshot().projects.find(item => item.id === id)
      if (!project) throw new Error('CAD project not found')
      await this.openCreated(project)
    })
  }

  /** Deleting a project also removes the empty workspace registered for it. */
  async remove(id: string): Promise<boolean> {
    return this.run(async () => {
      const project = this.snapshot.getSnapshot().projects.find(item => item.id === id)
      if (!project) throw new Error('CAD project not found')
      await this.bridge.request(`/api/projects/${encodeURIComponent(id)}`, 'DELETE')
      await this.forgetWorkspace(project)
      await this.projects()
      this.notice(null)
    })
  }

  async rename(id: string, name: string): Promise<boolean> {
    return this.run(async () => {
      await this.bridge.request(`/api/projects/${encodeURIComponent(id)}`, 'PATCH', { name })
      await this.projects()
    })
  }

  dismissNotice(): void { this.notice(null) }
  setTheme(theme: 'light' | 'dark'): void { this.snapshot.update((state) => { state.theme = theme }) }
  dispose(): void { this.disposed = true }
}
