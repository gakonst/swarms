import { assert } from '../shared/Assert.ts'
import * as Limits from '../shared/Limits.ts'

export const header = 'traceparent'

export type Context = { flags: number; parent: string | null; span: string; trace: string }

export type Span = { count: number; ms: number; name: string }

const { flagsRadix, spanBytes, traceBytes } = Limits.Telemetry

const pattern = /^00-(?<trace>[0-9a-f]{32})-(?<span>[0-9a-f]{16})-(?<flags>[0-9a-f]{2})$/

const zero = /^0+$/

function hex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(flagsRadix).padStart(2, '0')).join('')
}

function id(bytes: number) {
  for (let tries = 0; tries < Limits.Telemetry.idTries; tries++) {
    const value = hex(bytes)
    if (!zero.test(value)) return value
  }
  assert(false, 'random trace ids are not all zero', bytes)
}

export function parse(value: string | null | undefined) {
  const groups = pattern.exec((value ?? '').trim().toLowerCase())?.groups
  if (!groups?.['trace'] || !groups['span'] || !groups['flags'] || zero.test(groups['trace']) || zero.test(groups['span'])) return undefined
  return { flags: Number.parseInt(groups['flags'], flagsRadix), span: groups['span'], trace: groups['trace'] }
}

export function start(given: string | null | undefined): Context {
  const parent = parse(given)
  const context = parent
    ? { flags: parent.flags, parent: parent.span, span: id(spanBytes), trace: parent.trace }
    : { flags: 0, parent: null, span: id(spanBytes), trace: id(traceBytes) }
  assert(
    context.trace.length === traceBytes * 2 && context.span.length === spanBytes * 2,
    'a trace context holds a trace id and a span id of the W3C sizes',
    context,
  )
  return context
}

export function format(context: Context) {
  return '00-' + context.trace + '-' + context.span + '-' + context.flags.toString(flagsRadix).padStart(2, '0')
}

export function child(context: Context) {
  return format({ ...context, parent: context.span, span: id(spanBytes) })
}

export function sampled(context: Context) {
  return (context.flags & 1) === 1
}

export function report(context: Context, worker: string, name: string, status: number, ms: number, spans: readonly Span[]) {
  assert(spans.length <= Limits.Telemetry.spans, 'a request reports a bounded number of spans', spans.length)
  if (!sampled(context) && ms < Limits.Telemetry.slowMs) return
  console.log(JSON.stringify({ ms, name, parent: context.parent, span: context.span, spans, status, trace: context.trace, worker }))
}
