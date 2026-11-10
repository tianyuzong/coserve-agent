import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

// Keep the Loader config under tests so both modes exercise the same deployable
// topology: local fixture source plus bare plugins owned by the workspace.
const driver = fileURLToPath(new URL(
  './fixtures/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  './fixtures/tool-castudio.patch.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

function messageText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

describe('cad_workbench through the production headless profile', () => {
  it('runs state, fit, select, and snapshot against a live fake workbench', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'tool-castudio headless smoke',
      tempDirPrefix: 'tool-castudio-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(4)

    const calls = events.filter(
      (event): event is SessionEvent<'tool/call'> => event.type === 'tool/call'
        && event.data.name === 'cad_workbench')
    expect(calls).toHaveLength(4)
    expect(calls.map(call => (JSON.parse(call.data.arguments) as { action: string }).action))
      .toEqual(['state', 'fit', 'select', 'snapshot'])
    const fitCall = calls[1]!
    expect(JSON.parse(fitCall.data.arguments)).toMatchObject({ action: 'fit', view: 'top' })
    const selectCall = calls[2]!
    expect(JSON.parse(selectCall.data.arguments)).toMatchObject({ action: 'select', part: '螺栓 01' })

    const results = events.filter(
      (event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.data.message.isError).not.toBe(true)
    }
    const resultText = (callId: string): string => {
      const result = results.find(entry => String(entry.data.message.toolCallId) === callId)
      expect(result, `tool/result for ${callId}`).toBeDefined()
      return messageText(result!.data.message.content)
    }

    const stateText = resultText(String(calls[0]!.data.callId))
    expect(stateText).toContain('CAD workbench "Fixture Bracket" (id fixture-project)')
    expect(stateText).toContain('Selection: "底座" (mesh-a)')

    const fitText = resultText(String(calls[1]!.data.callId))
    expect(fitText).toContain('fit view applied')

    const selectText = resultText(String(calls[2]!.data.callId))
    expect(selectText).toContain('select part applied')
    expect(selectText).toContain('Selection: "螺栓 01" (mesh-b)')

    const snapshotText = resultText(String(calls[3]!.data.callId))
    expect(snapshotText).toContain('viewport snapshot saved')
    expect(snapshotText).toContain('artifacts/viewport/viewport-20260101-000000-000.png')
    expect(snapshotText).toContain('read_image')

    // The persisted presentation payload lets a Host card re-narrow the result.
    const snapshotResult = results.find(
      entry => String(entry.data.message.toolCallId) === String(calls[3]!.data.callId))!
    expect(snapshotResult.data.meta).toMatchObject({
      project: { id: 'fixture-project', name: 'Fixture Bracket' },
      action: 'snapshot',
    })

    // The durable workbench reading re-injects only when its stable summary
    // changes: the tool-driven selection change reaches the next turn.
    const contexts = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'castudio-context')
    expect(contexts).toHaveLength(2)
    const firstText = messageText(contexts[0]!.data.content)
    const secondText = messageText(contexts[1]!.data.content)
    expect(firstText).toContain('Selection: "底座" (mesh-a)')
    expect(secondText).toContain('Selection: "螺栓 01" (mesh-b)')
    expect(secondText).toContain('cad_workbench tool')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
