import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Deterministic scripted adapter for the tool-castudio Loader fixture. Each
 * model call consumes the next scripted response: one `cad_workbench` tool
 * call followed by a closing text answer, per turn.
 */

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallChunks(rawCallId: string, name: string, args: object, note: string): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: note },
    { type: 'block-end', index: 0, block: { type: 'text', text: note } },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 1, id: callId, argumentsDelta: argumentsJson.slice(5) },
    {
      type: 'block-end',
      index: 1,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const SCRIPT: StreamChunk[][] = [
  toolCallChunks('call-state', 'cad_workbench', { action: 'state' }, 'reading the workbench'),
  textChunks('state noted'),
  toolCallChunks('call-fit', 'cad_workbench', { action: 'fit', view: 'top' }, 'framing the top view'),
  textChunks('fit applied'),
  toolCallChunks('call-select', 'cad_workbench', { action: 'select', part: '螺栓 01' }, 'selecting the bolt'),
  textChunks('selection applied'),
  toolCallChunks('call-snapshot', 'cad_workbench', { action: 'snapshot' }, 'capturing the viewport'),
  textChunks('snapshot saved'),
]

class ToolCastudioMockAdapter extends LlmAdapter {
  async * stream(): AsyncIterable<StreamChunk> {
    const chunks = SCRIPT.shift()
    if (chunks === undefined) throw new Error('tool-castudio mock: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

export const name = 'tool-castudio-mock-llm'
export const inject = ['llm']

/** Register the test-only `tool-castudio-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['tool-castudio-mock'], new ToolCastudioMockAdapter())
}
