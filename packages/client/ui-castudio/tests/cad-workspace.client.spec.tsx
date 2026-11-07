// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { CadOpenButton, CadWorkspace } from '../src/client/CadWorkspace.tsx'
import { zh } from '../src/client/locales.ts'
import type { CadState } from '../src/client/cad-controller.ts'

afterEach(cleanup)
const state: CadState = { pending: false, error: null, theme: 'light', projects: [{ id: 'cad-one', name: 'CAD', workspacePath: 'C:/CAD', workspaceUrl: 'http://127.0.0.1:4317/?embedded=1&harness=dsh&project=cad-one' }] }
const props = (cwd = 'C:/CAD') => ({
  sessionId: 'native-session', t: (key: keyof typeof zh) => zh[key],
  useCad: (select: (state: CadState) => unknown) => select(state),
  useSessions: (select: (sessions: { byId: Record<string, { cwd: string }> }) => unknown) => select({ byId: { 'native-session': { cwd } } }),
  openProject: vi.fn(), createProject: vi.fn(), refresh: vi.fn(), appendContext: vi.fn(), attachSelection: vi.fn(), openCad: vi.fn(),
  inputActions: { captureInsertion: () => ({ start: 3, end: 3, draftRev: 2 }) },
})

function renderCad(face: ReturnType<typeof props>) {
  return render(<CadWorkspace {...face as unknown as ComponentProps<typeof CadWorkspace>} />)
}

it('sends resolved native styling when the trusted iframe becomes ready after its load event', () => {
  const view = renderCad(props())
  const frame = view.getByTitle('CAD 工作台') as HTMLIFrameElement
  frame.style.setProperty('--dsw-alias-bg-base', 'rgb(20, 20, 20)')
  frame.style.fontFamily = 'Segoe UI'
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  const ready = { type: 'castudio:ready', projectId: 'cad-one' }
  fireEvent(window, new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:4317', data: ready }))
  expect(post).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:4317', data: ready }))
  expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'castudio:theme', projectId: 'cad-one', tokens: expect.objectContaining({ '--embed-bg': 'rgb(20, 20, 20)', '--embed-font': '"Segoe UI"' }),
  }), 'http://127.0.0.1:4317')
  post.mockRestore()
})

it('attaches viewport choices through native references while leaving draft text alone', () => {
  const face = props()
  const view = renderCad(face)
  const frame = view.getByTitle('CAD 工作台') as HTMLIFrameElement
  const selection = { meshId: 'ring', name: '定位环', file: 'model.step', isDemo: false }
  const message = { type: 'castudio:selection', projectId: 'cad-one', selection }
  fireEvent(window, new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:4317', data: message }))
  expect(face.attachSelection).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:4317', data: message }))
  expect(face.attachSelection).toHaveBeenCalledWith('native-session', 'cad-one', selection, { start: 3, end: 3, draftRev: 2 })
  expect(face.appendContext).not.toHaveBeenCalled()
})

it('routes only messages from the active CAD frame and project into the native draft', () => {
  const face = props()
  const view = renderCad(face)
  const frame = view.getByTitle('CAD 工作台') as HTMLIFrameElement
  const message = { type: 'castudio:draft', projectId: 'cad-one', text: 'Inspect this face' }
  fireEvent(window, new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:4317', data: message }))
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'https://other.example', data: message }))
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:4317', data: { ...message, projectId: 'other' } }))
  expect(face.appendContext).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:4317', data: message }))
  expect(face.appendContext).toHaveBeenCalledWith('native-session', message.text)
})

it('opens the CAD surface for a CAD session and keeps the native hero action available elsewhere', () => {
  const face = props()
  const view = render(<CadOpenButton {...face as unknown as ComponentProps<typeof CadOpenButton>} />)
  expect(face.openCad).toHaveBeenCalledTimes(1)
  const unrelated = props('C:/other')
  view.rerender(<CadOpenButton {...unrelated as unknown as ComponentProps<typeof CadOpenButton>} />)
  expect(unrelated.openCad).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'CAD 工作台' }))
  expect(unrelated.openCad).toHaveBeenCalledTimes(1)
})
