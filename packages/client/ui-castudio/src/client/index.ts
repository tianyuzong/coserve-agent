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
import { CadController } from './cad-controller.ts'
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
  const controller = new CadController(bridge, async (project) => {
    const workspace = await ctx.workspaces.create({ path: project.workspacePath })
    if (workspace.title !== project.name) await ctx.workspaces.rename(workspace.workspaceId, project.name)
    await ctx.uiWorkspace.openWorkspace(workspace.workspaceId)
  })
  controller.setTheme(ctx.theme.getTheme().active.colorScheme)
  ctx.on('theme/change', theme => controller.setTheme(theme.active.colorScheme))
  ctx.effect(() => () => controller.dispose(), 'castudio.controller')
  const face: CadFace = {
    hooks: { cad: controller.snapshot },
    refresh: () => { void controller.load() },
    createProject: () => { void controller.create(t('newName')) },
    openProject: (id) => { void controller.open(id) },
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
  void controller.load()
}
