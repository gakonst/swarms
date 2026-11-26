import * as Limits from '../shared/Limits.ts'

const iso = Limits.WorkerMp4

const ascii = (text: string) => new TextEncoder().encode(text)

export function units(stream: Uint8Array) {
  const found: Uint8Array[] = []
  let start = -1
  let index = 0
  while (index + 2 < stream.length) {
    if (stream[index] === 0 && stream[index + 1] === 0 && stream[index + 2] === 1) {
      if (start >= 0) found.push(stream.subarray(start, index - (index > start && stream[index - 1] === 0 ? 1 : 0)))
      index += iso.startCodeBytes
      start = index
      continue
    }
    index++
  }
  if (start >= 0) found.push(stream.subarray(start))
  return found.filter((unit) => unit.length > 0)
}

function box(type: string, ...parts: Uint8Array[]) {
  const size = iso.boxHeader + parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  for (let index = 0; index < iso.typeBytes; index++) out[iso.typeAt + index] = type.charCodeAt(index)
  let at = iso.boxHeader
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function full(type: string, version: number, flags: number, ...parts: Uint8Array[]) {
  return box(type, words([(version << 24) | flags]), ...parts)
}

function words(values: readonly number[]) {
  const out = new Uint8Array(values.length * iso.wordBytes)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setUint32(index * iso.wordBytes, value >>> 0))
  return out
}

function shorts(values: number[]) {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setUint16(index * 2, value & iso.shortMask))
  return out
}

function bytes(values: number[]) {
  return Uint8Array.from(values)
}

const matrix = words(iso.matrix)

export function mux(frames: Uint8Array[], options: { fps: number; height: number; width: number }) {
  const timescale = iso.timescale
  const delta = Math.round(timescale / options.fps)
  const duration = delta * frames.length
  let sps: Uint8Array | undefined
  let pps: Uint8Array | undefined
  const keys: number[] = []
  const samples = frames.map((frame, index) => {
    const kept: Uint8Array[] = []
    for (const unit of units(frame)) {
      const type = (unit[0] ?? 0) & iso.nalTypeMask
      if (type === iso.nalIdr && keys.at(-1) !== index + 1) keys.push(index + 1)
      if (type === iso.nalSps) sps ??= Uint8Array.from(unit, (byte, at) => (at === 2 ? byte | iso.constraintFlags : byte))
      else if (type === iso.nalPps) pps ??= unit
      else kept.push(words([unit.length]), unit)
    }
    const size = kept.reduce((sum, part) => sum + part.length, 0)
    const data = new Uint8Array(size)
    let at = 0
    for (const part of kept) {
      data.set(part, at)
      at += part.length
    }
    return data
  })
  if (!sps || !pps) throw new Error('The stream has no parameter sets')
  const avcc = box('avcC', bytes([1, sps[1] ?? iso.baselineProfile, sps[2] ?? 0, sps[iso.levelAt] ?? iso.defaultLevel, iso.lengthSizeByte, iso.spsCountByte]), shorts([sps.length]), sps, bytes([1]), shorts([pps.length]), pps)
  const colr = box('colr', ascii('nclx'), shorts([1, 1, 1]), bytes([0]))
  const pasp = box('pasp', words([1, 1]))
  const avc1 = box(
    'avc1',
    bytes([0, 0, 0, 0, 0, 0]),
    shorts([1, 0, 0]),
    words([0, 0, 0]),
    shorts([options.width, options.height]),
    words([iso.dpi72, iso.dpi72, 0]),
    shorts([1]),
    new Uint8Array(iso.compressorNameBytes),
    shorts([iso.colorDepth, iso.noColorTable]),
    avcc,
    colr,
    pasp,
  )
  const table = (offset: number) =>
    box(
      'stbl',
      full('stsd', 0, 0, words([1]), avc1),
      full('stts', 0, 0, words([1, frames.length, delta])),
      full('stss', 0, 0, words([keys.length, ...keys])),
      full('stsc', 0, 0, words([1, 1, frames.length, 1])),
      full('stsz', 0, 0, words([0, frames.length, ...samples.map((sample) => sample.length)])),
      full('stco', 0, 0, words([1, offset])),
    )
  const millis = Math.round((duration / timescale) * 1000)
  const movie = (offset: number) =>
    box(
      'moov',
      full('mvhd', 0, 0, words([0, 0, 1000, millis, iso.unitRate]), shorts([iso.unitVolume, 0]), words([0, 0]), matrix, words([0, 0, 0, 0, 0, 0, 2])),
      box(
        'trak',
        full('tkhd', 0, iso.trackEnabledInMovie, words([0, 0, 1, 0, millis, 0, 0]), shorts([0, 0, 0, 0]), matrix, words([options.width << iso.fixedPointShift, options.height << iso.fixedPointShift])),
        box(
          'mdia',
          full('mdhd', 0, 0, words([0, 0, timescale, duration]), shorts([iso.undeterminedLanguage, 0])),
          full('hdlr', 0, 0, words([0]), ascii('vide'), words([0, 0, 0]), ascii('Swarms\0')),
          box('minf', full('vmhd', 0, 1, shorts([0, 0, 0, 0])), box('dinf', full('dref', 0, 0, words([1]), full('url ', 0, 1))), table(offset)),
        ),
      ),
    )
  const type = box('ftyp', ascii('isom'), words([iso.minorVersion]), ascii('isomiso2avc1mp41'))
  const head = type.length + movie(0).length + iso.boxHeader
  const moov = movie(head)
  const payload = samples.reduce((sum, sample) => sum + sample.length, 0)
  const out = new Uint8Array(head + payload)
  out.set(type, 0)
  out.set(moov, type.length)
  new DataView(out.buffer).setUint32(type.length + moov.length, iso.boxHeader + payload)
  out.set(ascii('mdat'), type.length + moov.length + iso.typeAt)
  let at = head
  for (const sample of samples) {
    out.set(sample, at)
    at += sample.length
  }
  return out
}
