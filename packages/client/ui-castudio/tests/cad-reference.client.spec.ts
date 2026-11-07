import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionInputShell, type SessionInputDeps } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/facade.ts'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/input.ts'
import { expect, it, onTestFinished, vi } from 'vitest'
import { attachCadReference, cadReference, cadReferenceRule, cadReferenceSource } from '../src/client/cad-reference.ts'

const selection = { meshId: 'ring', name: '上端定位环', file: 'assembly.step', isDemo: false, bounds: [0, 0, 0, 10, 10, 5] }
const reference = () => cadReference('project-one', selection, { face: '面', triangle: '三角面' })!

function makeInput(sink = vi.fn<SessionInputDeps['defaultSink']>(async () => ({ kind: 'success' }))) {
  const ctx = new Context()
  const triggers: InputTriggerController = {
    launcher: createSnapshotStore<string | null>(null), lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => {}, arbitrate: () => 'pass', onSpace: () => false,
    serializeReference: (_source, ref, signal) => cadReferenceSource.codec!.serialize(ref, signal),
    adjudicate: async () => undefined, resolveClaim: async () => undefined,
    openReference: () => false, toggleSource: () => {},
  }
  const shell = new SessionInputShell({ actx: ctx, inputTriggers: () => triggers, defaultSink: sink,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token } })
  onTestFinished(() => { shell.dispose(); ctx.fiber.dispose() })
  return { shell, sink }
}

it('keeps prose and a compact native chip, deduplicates repeated picks, and sends complete CAD context', async () => {
  const { shell, sink } = makeInput()
  shell.setDraft('检查这个部件 ')
  const end = shell.snapshot.draft.length
  expect(attachCadReference(shell, reference(), { start: 0, end, draftRev: shell.snapshot.draftRev })).toBe(true)
  expect(shell.snapshot.draft).toBe('检查这个部件 @上端定位环 ')
  expect(shell.snapshot.occurrences).toMatchObject([{ appearance: 'file', label: '上端定位环' }])
  attachCadReference(shell, reference(), shell.actions.captureInsertion())
  expect(shell.snapshot.occurrences).toHaveLength(1)
  shell.submit()
  await vi.waitFor(() => expect(sink).toHaveBeenCalledOnce())
  const text = sink.mock.calls[0]![0] as string
  expect(text).toContain('检查这个部件 <cad-selection>')
  expect(text).toContain('"bounds":[0,0,0,10,10,5]')
  const node = cadReferenceRule.match(text, 0, { read: () => undefined })
  expect(node).toMatchObject({ id: 'cad-selection', data: { label: '上端定位环', file: 'assembly.step' } })
  await vi.waitFor(() => expect(shell.snapshot.occurrences).toHaveLength(0))
})

it('preserves the reference on rejection and omits it after native draft removal', async () => {
  const sink = vi.fn<SessionInputDeps['defaultSink']>(async () => ({ kind: 'error', text: 'offline' }))
  const { shell } = makeInput(sink)
  attachCadReference(shell, reference(), shell.actions.captureInsertion())
  shell.submit()
  await vi.waitFor(() => expect(shell.snapshot.phase).toBe('plain'))
  expect(shell.snapshot.occurrences).toHaveLength(1)
  shell.setDraft('只保留这句')
  sink.mockResolvedValue({ kind: 'success' })
  shell.submit()
  await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(2))
  expect(sink.mock.calls[1]![0]).toBe('只保留这句')
})

it('keeps face identity distinct and restores the complete context from its persisted reference', async () => {
  const part = reference()
  const face = cadReference('project-one', { ...selection, cadFace: { id: 'F12' } }, { face: '面', triangle: '三角面' })!
  expect(face.label).toBe('上端定位环 · 面 F12')
  const { shell } = makeInput()
  attachCadReference(shell, part, shell.actions.captureInsertion())
  attachCadReference(shell, face, shell.actions.captureInsertion())
  expect(shell.snapshot.occurrences).toHaveLength(2)
  const persisted = JSON.parse(JSON.stringify(shell.draftSnapshot)) as typeof shell.draftSnapshot
  const serialized = await cadReferenceSource.codec!.serialize(persisted.references[1]!.ref, new AbortController().signal)
  expect(serialized).toContain('"cadFace":{"id":"F12"}')
  expect(cadReference('project-one', null, { face: '面', triangle: '三角面' })).toBeUndefined()
  expect(cadReferenceRule.match('<cad-selection>bad</cad-selection>', 0, { read: () => undefined })).toBeUndefined()
})
