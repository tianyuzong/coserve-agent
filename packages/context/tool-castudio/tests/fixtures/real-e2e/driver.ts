#!/usr/bin/env node
/** Test driver that sends four turns through one Headless Loader composition against a real CAStudio service. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('real-e2e driver requires a config path')
if (process.env['COSERVE_CASTUDIO_URL'] === undefined) {
  throw new Error('real-e2e driver requires COSERVE_CASTUDIO_URL')
}
if (process.env['TOOL_CASTUDIO_MOCK_SCRIPT'] === undefined) {
  throw new Error('real-e2e driver requires TOOL_CASTUDIO_MOCK_SCRIPT')
}

const ctx = await bootProductionProfile({
  binName: 'tool-castudio-real-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'inspect the workbench' })
  await runFixtureTurn(ctx, { task: 'frame the top view' })
  await runFixtureTurn(ctx, { task: 'select the named part' })
  await runFixtureTurn(ctx, { task: 'capture the viewport' })
} finally {
  await ctx.fiber.dispose()
}
