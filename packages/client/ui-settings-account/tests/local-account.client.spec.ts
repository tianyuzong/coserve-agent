// @vitest-environment jsdom
import { afterEach, expect, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

const it = createClientTest({ roster: webApp })
afterEach(() => { vi.unstubAllGlobals() })

it('mounts local desktop identity without cloud login, balance, onboarding or account streams', async ({ start, mock }) => {
  vi.stubGlobal('dshDesktop', {})
  const client = await start()
  expect(client.ctx.slots.entries('settings.launcher')).toHaveLength(1)
  expect(client.ctx.slots.entries('settings.section').some(entry => entry.options.id === 'account')).toBe(true)
  expect(client.ctx.slots.entries('settings.models.sign-in')).toHaveLength(0)
  expect(client.ctx.slots.entries('shell.overlay').some(entry => entry.options.id === 'desktop-onboarding')).toBe(false)
  expect(mock.streams.end('account/watch')).toBe(0)
  expect(mock.remote.account.startSignIn).not.toHaveBeenCalled()
  expect(mock.remote.account.getProfile).not.toHaveBeenCalled()
  expect(mock.remote.account.getBalance).not.toHaveBeenCalled()
  await client.unload('@deepseek-ai/dsh-client-ui-settings-account')
  expect(client.ctx.slots.entries('settings.launcher')).toHaveLength(0)
  expect(client.ctx.slots.entries('settings.section').some(entry => entry.options.id === 'account')).toBe(false)
}, 60_000)
