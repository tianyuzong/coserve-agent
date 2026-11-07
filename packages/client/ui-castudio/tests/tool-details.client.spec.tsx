// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StudioTool } from '../src/client/StudioPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { StudioRow } from '../src/client/types.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh) => zh[key]

it('opens persisted write arguments and the actual result, retaining the file target', () => {
  const message: StudioRow = { id: 'write-one', role: 'tool', toolName: 'write', timestamp: 1,
    args: { path: 'model.py', content: 'diameter = 42\n' }, text: 'Successfully wrote to model.py' }
  const view = render(<StudioTool message={message} t={t} />)
  expect(view.getByText('model.py')).toBeTruthy()
  expect(view.queryByRole('region', { name: '工具调用详情' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: /写入/ }))
  const details = view.getByRole('region', { name: '工具调用详情' })
  expect(details.textContent).toContain('调用参数')
  expect(details.textContent).toContain('diameter = 42')
  expect(details.textContent).toContain('执行结果')
  expect(details.textContent).toContain(message.text)
  expect(details.textContent).toContain('已完成')
  expect(view.getByText('model.py')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: /写入/ }))
  expect(view.queryByRole('region', { name: '工具调用详情' })).toBeNull()
})

it('updates an expanded running command with its failure output without losing its arguments', () => {
  const message: StudioRow = { id: 'command-one', role: 'tool', toolName: 'powershell', timestamp: 1,
    args: { command: 'Get-Content missing.txt' }, text: '', pending: true }
  const view = render(<StudioTool message={message} t={t} />)
  fireEvent.click(view.getByRole('button', { name: /powershell/ }))
  expect(view.getByText('等待工具返回结果…')).toBeTruthy()
  view.rerender(<StudioTool message={{ ...message, pending: false, error: true, text: 'File not found' }} t={t} />)
  const details = view.getByRole('region', { name: '工具调用详情' })
  expect(details.textContent).toContain('Get-Content missing.txt')
  expect(details.textContent).toContain('File not found')
  expect(details.textContent).toContain('执行失败')
})

it('explains unavailable historical input and empty output instead of expanding a blank row', () => {
  const view = render(<StudioTool message={{ id: 'legacy', role: 'tool', toolName: 'read', timestamp: 1, text: '' }} t={t} />)
  fireEvent.click(view.getByRole('button', { name: '读取' }))
  expect(view.getByText('这条历史记录未保存调用参数')).toBeTruthy()
  expect(view.getByText('工具未返回文本结果')).toBeTruthy()
})
