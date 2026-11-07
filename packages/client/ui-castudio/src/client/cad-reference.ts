import type { ReferenceInsert, SessionInput, TokenSpan, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** Stable owner key retained by native draft reference nodes. */
export const CAD_REFERENCE_SOURCE = 'castudio-selection'

interface CadSelection {
  meshId: string
  name: string
  file: string
  isDemo: boolean
  triangle?: number
  cadFace?: { id: string }
  [key: string]: unknown
}

interface CadReference {
  projectId: string
  label: string
  selection: CadSelection
}

function isSelection(value: unknown): value is CadSelection {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.meshId === 'string' && typeof item.name === 'string'
    && typeof item.file === 'string' && typeof item.isDemo === 'boolean'
    && (item.triangle === undefined || Number.isInteger(item.triangle))
    && (item.cadFace === undefined || (typeof item.cadFace === 'object' && item.cadFace !== null
      && 'id' in item.cadFace && typeof item.cadFace.id === 'string'))
}

function readReference(ref: string): CadReference | undefined {
  let value: unknown
  try { value = JSON.parse(ref) } catch (_error) { return undefined /* A stale or malformed persisted reference is not a CAD selection. */ }
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  return typeof item.projectId === 'string' && typeof item.label === 'string' && isSelection(item.selection)
    ? { projectId: item.projectId, label: item.label, selection: item.selection } : undefined
}

/**
 * Turn a viewport selection into a self-contained native reference, preserved across draft reloads.
 * @param projectId - owning CAD project.
 * @param selection - iframe selection payload.
 * @param labels - localized face and triangle labels.
 * @returns the native chip, or undefined for an invalid selection message.
 */
export function cadReference(
  projectId: string, selection: unknown, labels: { face: string; triangle: string },
): ReferenceInsert | undefined {
  if (!isSelection(selection)) return undefined
  const detail = selection.cadFace ? `${labels.face} ${selection.cadFace.id}`
    : selection.triangle !== undefined ? `${labels.triangle} ${selection.triangle}` : ''
  const label = detail ? `${selection.name} · ${detail}` : selection.name
  return {
    source: CAD_REFERENCE_SOURCE, ref: JSON.stringify({ projectId, label, selection }),
    label, appearance: 'file', clipboardText: `@${label}`,
  }
}

function sameSelection(left: CadReference, right: CadReference): boolean {
  return left.projectId === right.projectId && left.selection.file === right.selection.file
    && left.selection.meshId === right.selection.meshId && left.selection.cadFace?.id === right.selection.cadFace?.id
    && left.selection.triangle === right.selection.triangle
}

/**
 * Add one reference without replacing selected prose or duplicating an already attached component.
 * @param input - native session input facade.
 * @param reference - validated CAD reference.
 * @param span - native editor insertion position and revision.
 * @returns whether this selection is attached.
 */
export function attachCadReference(input: SessionInput, reference: ReferenceInsert, span: TokenSpan): boolean {
  const selected = readReference(reference.ref)
  if (!selected) return false
  const duplicate = input.state.getSnapshot().occurrences.some((item) => {
    if (item.source !== CAD_REFERENCE_SOURCE) return false
    const existing = readReference(item.ref)
    return existing !== undefined && sameSelection(existing, selected)
  })
  return duplicate || input.insertReference(reference, { ...span, start: span.end })
}

/** Native submit-time codec; reference payloads are logged through the ordinary DSH message path. */
export const cadReferenceSource: InputTriggerSource = {
  name: CAD_REFERENCE_SOURCE, trigger: '@', showGroupTitle: false,
  candidates: async () => [], onPick: () => undefined,
  codec: {
    clipboardText: ref => `@${readReference(ref)?.label ?? ''}`,
    async serialize(ref, signal) {
      signal.throwIfAborted()
      const selection = readReference(ref)
      if (!selection) throw new Error('Invalid CAD selection reference')
      return `<cad-selection>${JSON.stringify(selection).replaceAll('<', '\\u003c')}</cad-selection>`
    },
  },
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** A CAD reference already serialized into an ordinary user message. */
    'cad-selection': { label: string; file: string }
  }
}

/** Keep sent selections compact while the durable message retains the complete geometry context. */
export const cadReferenceRule: UserTextRule<'cad-selection'> = {
  id: 'cad-selection', order: 5,
  match(text, from) {
    const pattern = /<cad-selection>(.*?)<\/cad-selection>/gs
    pattern.lastIndex = from
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const value = readReference(match[1] ?? '')
      if (value) return { id: 'cad-selection', start: match.index, end: match.index + match[0].length,
        data: { label: value.label, file: value.selection.file } }
    }
    return undefined
  },
}
