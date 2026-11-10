/** Type declarations for castudio-service-check.mjs. */

/**
 * Boot one CAStudio service directory under a Node-compatible executable and
 * assert both the SPA and the project API answer. Always stops the child and
 * removes the temporary data directory, including on failure.
 * @param options.serviceDirectory - Staged or packaged tree containing server/index.ts and node_modules/tsx.
 * @param options.node - Node-compatible executable (Electron Node mode is enabled for the child).
 * @param options.environment - Base environment; credential-shaped and Node-injection variables are removed.
 * @param options.timeoutMs - Readiness deadline in milliseconds.
 * @param options.platform - Target platform override for tests.
 * @returns The port the service bound.
 */
export function checkCAStudioService(options: {
  readonly serviceDirectory: string
  readonly node: string
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}): Promise<number>
