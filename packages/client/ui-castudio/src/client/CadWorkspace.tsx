import { useEffect, useRef, useState } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { projectForWorkspace, type CadState } from './cad-controller.ts'
import { cadThemeTokens } from './cad-theme.ts'
import css from './CadWorkspace.module.css'

export interface CadFace {
  hooks: { cad: HostObservable<CadState> }
  openProject(id: string): void
  createProject(): void
  refresh(): void
  appendContext(id: SessionId, text: string): void
  attachSelection(id: SessionId, projectId: string, selection: unknown, span: TokenSpan): void
}

/** Only the CAD surface is embedded; the native conversation stays its sole host. */
export function CadWorkspace(props: PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'castudio'> & InjectFace<CadFace>) {
  const state = props.useCad(value => value)
  const directory = props.useSessions(value => value.byId[props.sessionId]?.cwd)
  const project = projectForWorkspace(state.projects, directory)
  const frame = useRef<HTMLIFrameElement>(null)
  const [menu, setMenu] = useState(false)
  const { t, sessionId, appendContext, attachSelection, inputActions } = props
  useEffect(() => {
    if (!project) return
    const receive = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(project.workspaceUrl).origin
        || event.data?.projectId !== project.id) return
      if (event.data.type === 'castudio:selection' && event.data.selection != null)
        attachSelection(sessionId, project.id, event.data.selection, inputActions.captureInsertion())
      if (event.data.type === 'castudio:draft' && typeof event.data.text === 'string' && event.data.text.trim())
        appendContext(sessionId, event.data.text)
      if (event.data.type === 'castudio:ready') sendTheme()
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [project, sessionId, appendContext, attachSelection, inputActions, state.theme])
  const sendTheme = () => {
    if (project && frame.current) frame.current.contentWindow?.postMessage({
      type: 'castudio:theme', projectId: project.id, theme: state.theme, tokens: cadThemeTokens(frame.current),
    }, new URL(project.workspaceUrl).origin)
  }
  useEffect(sendTheme, [project, state.theme])
  return <section className={css.workspace} aria-label={t('workspace')}>
    <div className={css.toolbar}>
      <Menu open={menu} onClose={() => setMenu(false)} portal compact selectedId={project?.id}
        items={state.projects.map(item => ({ id: item.id, label: item.name }))}
        onSelect={(id) => { setMenu(false); props.openProject(id) }}
        anchor={<Button className={css.project} size="sm" disabled={state.pending} aria-label={t('projects')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{project?.name ?? t('pickProject')}</Button>} />
      <Button size="sm" disabled={state.pending} onClick={props.createProject}>{t('newProject')}</Button>
      <Button size="sm" disabled={state.pending} onClick={props.refresh}>{t('refresh')}</Button>
    </div>
    {state.error && <div className={css.notice} role="alert">{t('connectionFailed')} {state.error}</div>}
    {project ? <iframe ref={frame} key={project.id} className={css.frame} title={t('workspace')} src={project.workspaceUrl} onLoad={sendTheme} />
      : <div className={css.empty} role="status">{state.pending ? t('loading') : t('pickProjectHint')}</div>}
  </section>
}

/** Contribute one utility to DSH's existing conversation header. */
export function CadOpenButton(props: PropsRuntime<'conversation.hero.options'> & PropsLocale<'castudio'> & InjectFace<{ hooks: { cad: HostObservable<CadState> }; openCad(): void }>) {
  const projects = props.useCad(value => value.projects)
  const directory = props.useSessions(value => value.byId[props.sessionId]?.cwd)
  const project = projectForWorkspace(projects, directory)
  useEffect(() => { if (project) props.openCad() }, [project?.id, props.sessionId, props.openCad])
  return <Button size="sm" onClick={props.openCad}>{props.t('workspace')}</Button>
}
