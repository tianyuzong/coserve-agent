import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_COSERVE_HOME_DISPLAY,
  COSERVE_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultCoserveHome,
  dshCachePath,
  coserveHomeDisplay,
  coserveHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveCoserveHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(COSERVE_HOME_DIR_NAME).toBe('.coserve')
    expect(DEFAULT_COSERVE_HOME_DISPLAY).toBe('~/.coserve')
    expect(defaultCoserveHome()).toBe(join(homedir(), '.coserve'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.coserve')).toBe(join(homedir(), '.coserve'))
    expect(expandHomePath('~\\.coserve')).toBe(join(homedir(), '.coserve'))
    expect(expandHomePath('/tmp/.coserve')).toBe('/tmp/.coserve')
    expect(expandHomePath('~other/.coserve')).toBe('~other/.coserve')
  })

  it('resolves explicit path before COSERVE_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveCoserveHome('/tmp/explicit-dsh', { COSERVE_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveCoserveHome(undefined, { COSERVE_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveCoserveHome(undefined, {})).toBe(defaultCoserveHome())
  })

  it('treats an empty or whitespace-only COSERVE_HOME as unset', () => {
    expect(resolveCoserveHome(undefined, { COSERVE_HOME: '' })).toBe(defaultCoserveHome())
    expect(resolveCoserveHome(undefined, { COSERVE_HOME: '   ' })).toBe(defaultCoserveHome())
  })

  it('joins child segments onto the resolved COSERVE_HOME', () => {
    vi.stubEnv('COSERVE_HOME', '~/env-dsh')
    expect(coserveHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(coserveHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(coserveHomeDisplay(resolve(defaultCoserveHome()))).toBe('~/.coserve')
    expect(coserveHomeDisplay('/some/other/root')).toBe('$COSERVE_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.coserve-agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.coserve-agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.coserve-agents'))
  })

  it('resolves an explicit agents home before COSERVE_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { COSERVE_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { COSERVE_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only COSERVE_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { COSERVE_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { COSERVE_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.coserve-agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$COSERVE_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.coserve')],
    ['', join(homedir(), '.coserve')],
    ['   ', join(homedir(), '.coserve')],
    ['~/env-dsh', join(homedir(), 'env-dsh')],
    ['./relative-dsh', resolve('./relative-dsh')],
  ] as const)('resolves cache paths with COSERVE_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('COSERVE_HOME', home)
    try {
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('COSERVE_HOME', '~/env-dsh')
    try {
      expect(dshCachePath({ coserveHome: '~/explicit-dsh' })).toBe(join(homedir(), 'explicit-dsh', 'cache'))
      expect(dshCachePath({ coserveHome: './explicit-dsh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dsh/cache/attachments/request-images'))
      expect(dshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dsh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
