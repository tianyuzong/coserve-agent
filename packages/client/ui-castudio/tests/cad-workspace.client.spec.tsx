// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { CadOpenButton, CadWorkspace } from '../src/client/CadWorkspace.tsx'
import { zh } from '../src/client/locales.ts'
import type { CadState } from '../src/client/cad-controller.ts'

afterEach(cleanup)
const base: CadState = {
  pending: false, error: null, notice: null, theme: 'light',
  projects: [{ id: 'cad-one', name: 'CAD', workspacePath: 'C:/CAD', workspaceUrl: 'http://127.0.0.1:4317/?embedded=1&harness=dsh&project=cad-one' }],
}
const props = (cwd = 'C:/CAD', state: CadState = base) => ({
  sessionId: 'native-session', t: (key: keyof typeof zh) => zh[key],
  useCad: (select: (state: CadState) => unknown) => select(state),
  useSessions: (select: (sessions: { byId: Record<string, { cwd: string }> }) => unknown) => select({ byId: { 'native-session': { cwd } } }),
  openProject: vi.fn(async () => true), createProject: vi.fn(async () => true), renameProject: vi.fn(async () => true),
  retryOpen: vi.fn(async () => true), deleteProject: vi.fn(async () => true), dismissNotice: vi.fn(),
  refresh: vi.fn(), appendContext: vi.fn(), attachSelection: vi.fn(), openCad: vi.fn(),
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

it('suggests a free project name and lets the user create it in place or in a new session', async () => {
  const face = props('C:/other')
  const view = renderCad(face)
  fireEvent.click(view.getByRole('button', { name: '新建项目' }))
  const input = view.getByRole('textbox', { name: '新建项目' }) as HTMLInputElement
  expect(input.value).toBe('新设计')
  fireEvent.click(view.getByRole('button', { name: '创建并打开' }))
  await waitFor(() => expect(face.createProject).toHaveBeenCalledWith('新设计', 'open'))
  await waitFor(() => expect(view.queryByRole('textbox', { name: '新建项目' })).toBeNull())
})

it('creates without switching sessions when the user asks for creation only', async () => {
  const face = props('C:/other')
  const view = renderCad(face)
  fireEvent.click(view.getByRole('button', { name: '新建项目' }))
  fireEvent.change(view.getByRole('textbox', { name: '新建项目' }), { target: { value: '齿轮箱' } })
  fireEvent.click(view.getByRole('button', { name: '仅创建' }))
  await waitFor(() => expect(face.createProject).toHaveBeenCalledWith('齿轮箱', 'keep'))
})

it('keeps the name editor open when creation is rejected', async () => {
  const face = props('C:/other')
  face.createProject.mockResolvedValueOnce(false)
  const view = renderCad(face)
  fireEvent.click(view.getByRole('button', { name: '新建项目' }))
  fireEvent.click(view.getByRole('button', { name: '创建并打开' }))
  await waitFor(() => expect(face.createProject).toHaveBeenCalled())
  expect(view.getByRole('textbox', { name: '新建项目' })).toBeTruthy()
})

it('offers the existing project when the typed name is already in use', async () => {
  const face = props('C:/other')
  const view = renderCad(face)
  fireEvent.click(view.getByRole('button', { name: '新建项目' }))
  fireEvent.change(view.getByRole('textbox', { name: '新建项目' }), { target: { value: 'CAD' } })
  expect(view.getByText(zh.nameTaken.replace('{name}', 'CAD'))).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '打开已有项目' }))
  await waitFor(() => expect(face.openProject).toHaveBeenCalledWith('cad-one'))
})

it('reports a created project with explicit open, delete and dismiss actions', async () => {
  const state: CadState = { ...base, notice: { kind: 'created', projectId: 'cad-one', projectName: 'CAD' } }
  const face = props('C:/other', state)
  const view = renderCad(face)
  expect(view.getByText(zh.createdNotice.replace('{name}', 'CAD'))).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '打开' }))
  await waitFor(() => expect(face.openProject).toHaveBeenCalledWith('cad-one'))
  await waitFor(() => expect(face.dismissNotice).toHaveBeenCalled())
  fireEvent.click(view.getByRole('button', { name: '删除项目' }))
  await waitFor(() => expect(face.deleteProject).toHaveBeenCalledWith('cad-one'))
  fireEvent.click(view.getByRole('button', { name: '收起' }))
  expect(face.dismissNotice).toHaveBeenCalledTimes(2)
})

it('turns a failed workspace open into a retryable notice rather than a connection error', () => {
  const state: CadState = { ...base, notice: { kind: 'open-failed', projectId: 'cad-one', projectName: 'CAD', message: 'workspace busy' } }
  const face = props('C:/other', state)
  const view = renderCad(face)
  expect(view.getByText(`${zh.openFailedNotice.replace('{name}', 'CAD')} workspace busy`)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '重试' }))
  expect(face.retryOpen).toHaveBeenCalledWith('cad-one')
  fireEvent.click(view.getByRole('button', { name: '删除项目' }))
  expect(face.deleteProject).toHaveBeenCalledWith('cad-one')
})

it('names connection failures and rejected actions differently', () => {
  const connection = renderCad(props('C:/other', { ...base, error: { kind: 'connection', message: 'fetch failed' } }))
  expect(connection.getByRole('alert').textContent).toContain('无法连接 CAstudio')
  cleanup()
  const operation = renderCad(props('C:/other', { ...base, error: { kind: 'operation', message: '项目里还有 2 个文件' } }))
  expect(operation.getByRole('alert').textContent).toContain('操作失败：')
  expect(operation.getByRole('alert').textContent).toContain('项目里还有 2 个文件')
})
