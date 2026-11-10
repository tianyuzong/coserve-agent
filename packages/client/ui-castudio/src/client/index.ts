import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { CadController, type CadProject } from './cad-controller.ts'
import { attachCadReference, cadReference, cadReferenceRule, cadReferenceSource } from './cad-reference.ts'
import { CadReference } from './CadReference.tsx'
import { CadWorkspace, CadOpenButton, type CadFace } from './CadWorkspace.tsx'
import { zh, en, type StudioKey } from './locales.ts'
import type { StudioBridge } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { castudio: StudioKey }
}

/** Attach CAD through public UI services; DSH retains the entire agent harness. */
export const inject = ['slots', 'locale', 'layout', 'theme', 'sidebarRight', 'sidebarRightTabs', 'workspaces', 'uiWorkspace', 'sessions', 'conversation', 'inputTriggers', 'uiConversation']

/** Register a CAD tab beside the original conversation, without a separate chat. */
export function apply(ctx: Context): void {
  const bridge = (globalThis as typeof globalThis & { dshCAStudio?: StudioBridge }).dshCAStudio
  if (!bridge) return
  ctx.effect(() => ctx.locale.register('castudio', { zh, en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }), 'castudio.locale')
  const t = ctx.locale.bind('castudio')
  ctx.effect(() => ctx.inputTriggers.registerSource(cadReferenceSource), 'castudio.reference-source')
  ctx.effect(() => ctx.uiConversation.userText.register(cadReferenceRule), 'castudio.reference-rule')
  ctx.effect(() => ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'cad-selection',
  }, CadReference)), 'castudio.reference-view')
  // Workspace titles must be unique: another project may already carry the same name.
  // Try the plain title first, then numbered suffixes; never let this block opening the project.
  const renameWorkspace = async (workspaceId: Parameters<typeof ctx.workspaces.rename>[0], desired: string): Promise<void> => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const title = attempt === 1 ? desired : `${desired} (${attempt})`
      try { await ctx.workspaces.rename(workspaceId, title); return }
      catch (error) {
        const message = String((error as Error)?.message ?? error)
        if (!message.includes('name-conflict')) { console.warn('castudio: workspace title left unchanged', error); return }
      }
    }
    console.warn('castudio: workspace title left unchanged; every candidate name was taken')
  }
  const normalizePath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const workspaceRow = (workspacePath: string) => ctx.workspaces.list.getSnapshot().items
    .find(row => normalizePath(row.path) === normalizePath(workspacePath))
  const workspaceIdle = (workspaceId: Parameters<typeof ctx.workspaces.delete>[0]): boolean => {
    const row = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    return row !== undefined && row.sessionIds.length === 0
  }
  /** Opening a project registers its workspace; a failed open must not leave that empty entry behind. */
  const openWorkspace = async (project: CadProject): Promise<void> => {
    const existing = workspaceRow(project.workspacePath)
    const workspace = existing ?? await ctx.workspaces.create({ path: project.workspacePath })
    try { await ctx.uiWorkspace.openWorkspace(workspace.workspaceId) }
    catch (error) {
      if (existing === undefined && workspaceIdle(workspace.workspaceId)) {
        try { await ctx.workspaces.delete(workspace.workspaceId) }
        catch { /* reopening a leftover empty entry is harmless; the failure still surfaces */ }
      }
      throw error
    }
    if (workspace.title !== project.name) await renameWorkspace(workspace.workspaceId, project.name)
  }
  /** Deleting a project drops its empty workspace too, so the sidebar keeps no dead entry. */
  const forgetWorkspace = async (project: CadProject): Promise<void> => {
    const workspace = workspaceRow(project.workspacePath)
    if (workspace === undefined || !workspaceIdle(workspace.workspaceId)) return
    try { await ctx.workspaces.delete(workspace.workspaceId) }
    catch { /* the project is gone either way; the sidebar entry can be removed from its own menu */ }
  }
  /**
   * CAD workspaces are created by this plugin, so a workspace whose project no longer exists can
   * never open again: drop that leftover. The project list is the authority, and an empty or
   * not-yet-loaded list is never evidence that every project disappeared.
   */
  const sweepOrphanWorkspaces = (): void => {
    const projects = controller.snapshot.getSnapshot().projects
    if (projects.length === 0) return
    const known = new Set(projects.map(project => project.id))
    for (const row of ctx.workspaces.list.getSnapshot().items) {
      const path = normalizePath(row.path)
      const owner = /\/\.coserve\/castudio\/projects\/([^/]+)\/workspace$/.exec(path)?.[1]
      if (row.sessionIds.length > 0 || owner === undefined || known.has(owner)) continue
      void ctx.workspaces.delete(row.workspaceId).catch(error => console.warn('castudio: stale project workspace left in place', error))
    }
  }
  const controller = new CadController(bridge, openWorkspace, forgetWorkspace)
  controller.setTheme(ctx.theme.getTheme().active.colorScheme)
  ctx.on('theme/change', theme => controller.setTheme(theme.active.colorScheme))
  ctx.effect(() => () => controller.dispose(), 'castudio.controller')
  const face: CadFace = {
    hooks: { cad: controller.snapshot },
    refresh: () => { void controller.load() },
    createProject: async (name, mode) => {
      const created = await controller.create(name, mode)
      if (created) sweepOrphanWorkspaces()
      return created
    },
    openProject: id => controller.open(id),
    retryOpen: id => controller.retryOpen(id),
    deleteProject: async (id) => {
      const removed = await controller.remove(id)
      if (removed) sweepOrphanWorkspaces()
      return removed
    },
    dismissNotice: () => controller.dismissNotice(),
    renameProject: async (id, name) => {
      const renamed = await controller.rename(id, name)
      if (!renamed) return false
      // Keep the DSH sidebar entry in step with the project name; it is only a label.
      const project = controller.snapshot.getSnapshot().projects.find(item => item.id === id)
      if (project === undefined) return true
      const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
      const workspace = ctx.workspaces.list.getSnapshot().items
        .find(row => normalize(row.path) === normalize(project.workspacePath))
      if (workspace !== undefined && workspace.title !== name) await renameWorkspace(workspace.workspaceId, name)
      return true
    },
    appendContext: (id, text) => {
      const binding = ctx.sessions.binding(id)
      if (binding) ctx.conversation.input.requestDraftInitialization(binding, { prompt: text, whenDraftExists: 'append' })
    },
    attachSelection: (id, projectId, selection, span) => {
      const binding = ctx.sessions.binding(id)
      const reference = cadReference(projectId, selection, { face: t('cadFace'), triangle: t('cadTriangle') })
      if (binding && reference) attachCadReference(ctx.conversation.input.for(binding.ctx), reference, span)
    },
  }
  const tabId = '@deepseek-ai/dsh-client-ui-castudio/cad'
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: tabId, kind: 'cad', priority: 'builtin', title: () => t('workspace'), keepMounted: true }), 'castudio.tab')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: tabId, locale: 'castudio', inject: () => face,
  }, CadWorkspace)), 'castudio.workspace')
  const openCad = () => { ctx.sidebarRight.openTab('cad') }
  const buttonFace = () => ({ hooks: { cad: controller.snapshot }, openCad })
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'cad-workspace', order: -10, locale: 'castudio', inject: buttonFace,
  }, CadOpenButton)), 'castudio.header')
  ctx.effect(() => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: 'cad-workspace', order: -10, locale: 'castudio', inject: buttonFace,
  }, CadOpenButton)), 'castudio.hero')
  ctx.layout.selectPanel(null)
  void controller.load().then((loaded) => { if (loaded) sweepOrphanWorkspaces() })
  ctx.effect(() => ctx.workspaces.list.subscribe(sweepOrphanWorkspaces), 'castudio.workspace-sweep')
}
