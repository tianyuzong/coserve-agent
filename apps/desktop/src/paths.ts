/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveCoserveHome } from '@deepseek-ai/dsh-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param coserveHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(coserveHome: string = resolveCoserveHome()): DesktopPaths {
  return {
    profile: join(coserveHome, 'profiles', 'desktop'),
    lock: join(coserveHome, 'profiles', 'desktop', 'lock'),
  }
}
