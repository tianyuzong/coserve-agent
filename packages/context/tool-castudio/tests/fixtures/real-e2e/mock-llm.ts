import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Deterministic scripted adapter for the real-service workbench fixture. The
 * script is a JSON array consumed one model response per `stream()` call:
 * `{ "tool": { "name", "arguments" }, "note" }` emits a tool call, and
 * `{ "text" }` emits a closing answer. The orchestrator writes the script
 * after learning the live mesh names, so `select` can target a real part name.
 */

interface ScriptEntry {
  readonly note?: string
  readonly tool?: { readonly name: string; readonly arguments: object }
  readonly text?: string
}

const scriptPath = process.env['TOOL_CASTUDIO_MOCK_SCRIPT']
if (scriptPath === undefined) throw new Error('real-e2e mock-llm requires TOOL_CASTUDIO_MOCK_SCRIPT')
const SCRIPT = JSON.parse(readFileSync(scriptPath, 'utf8')) as ScriptEntry[]

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function responseChunks(entry: ScriptEntry, index: number): StreamChunk[] {
  if (entry.tool === undefined) return textChunks(entry.text ?? '')
  const callId = ToolCallId(`call-${index}`)
  const argumentsJson = JSON.stringify(entry.tool.arguments)
  const note = entry.note ?? ''
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: note },
    { type: 'block-end', index: 0, block: { type: 'text', text: note } },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: callId, name: entry.tool.name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 1, id: callId, argumentsDelta: argumentsJson.slice(5) },
    {
      type: 'block-end',
      index: 1,
      block: { type: 'tool-call', id: callId, name: entry.tool.name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class RealE2eMockAdapter extends LlmAdapter {
  private calls = 0
  async * stream(): AsyncIterable<StreamChunk> {
    const entry = SCRIPT[this.calls]
    this.calls += 1
    if (entry === undefined) throw new Error('real-e2e mock: script exhausted')
    for (const chunk of responseChunks(entry, this.calls)) yield chunk
  }
}

export const name = 'real-e2e-mock-llm'
export const inject = ['llm']

/** Register the test-only `real-e2e-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['real-e2e-mock'], new RealE2eMockAdapter())
}
