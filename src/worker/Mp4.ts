export function units(stream: Uint8Array) {
  const found: Uint8Array[] = []
  let start = -1
  let index = 0
  while (index + 2 < stream.length) {
    if (stream[index] === 0 && stream[index + 1] === 0 && stream[index + 2] === 1) {
      if (start >= 0) found.push(stream.subarray(start, index - (index > start && stream[index - 1] === 0 ? 1 : 0)))
      index += 3
      start = index
      continue
    }
    index++
  }
  if (start >= 0) found.push(stream.subarray(start))
  return found.filter((unit) => unit.length > 0)
}

function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, size)
  for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index)
  let at = 8
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function full(type: string, version: number, flags: number, ...parts: Uint8Array[]) {
  return box(type, words([(version << 24) | flags]), ...parts)
}

function words(values: number[]) {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0))
  return out
}

function shorts(values: number[]) {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setUint16(index * 2, value & 0xffff))
  return out
}

function bytes(values: number[]) {
  return Uint8Array.from(values)
}

const matrix = words([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000])

export function mux(frames: Uint8Array[], options: { fps: number; height: number; width: number }) {
  const timescale = 90_000
  const delta = Math.round(timescale / options.fps)
  const duration = delta * frames.length
  let sps: Uint8Array | undefined
  let pps: Uint8Array | undefined
  const keys: number[] = []
  const samples = frames.map((frame, index) => {
    const kept: Uint8Array[] = []
    for (const unit of units(frame)) {
      const type = (unit[0] ?? 0) & 0x1f
      if (type === 5 && keys.at(-1) !== index + 1) keys.push(index + 1)
      if (type === 7) sps ??= Uint8Array.from(unit, (byte, at) => (at === 2 ? byte | 0xc0 : byte))
      else if (type === 8) pps ??= unit
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
  const avcc = box('avcC', bytes([1, sps[1] ?? 66, sps[2] ?? 0, sps[3] ?? 31, 0xff, 0xe1]), shorts([sps.length]), sps, bytes([1]), shorts([pps.length]), pps)
  const colr = box('colr', bytes([0x6e, 0x63, 0x6c, 0x78]), shorts([1, 1, 1]), bytes([0]))
  const pasp = box('pasp', words([1, 1]))
  const avc1 = box(
    'avc1',
    bytes([0, 0, 0, 0, 0, 0]),
    shorts([1, 0, 0]),
    words([0, 0, 0]),
    shorts([options.width, options.height]),
    words([0x480000, 0x480000, 0]),
    shorts([1]),
    new Uint8Array(32),
    shorts([0x18, 0xffff]),
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
      full('mvhd', 0, 0, words([0, 0, 1000, millis, 0x10000]), shorts([0x100, 0]), words([0, 0]), matrix, words([0, 0, 0, 0, 0, 0, 2])),
      box(
        'trak',
        full('tkhd', 0, 3, words([0, 0, 1, 0, millis, 0, 0]), shorts([0, 0, 0, 0]), matrix, words([options.width << 16, options.height << 16])),
        box(
          'mdia',
          full('mdhd', 0, 0, words([0, 0, timescale, duration]), shorts([0x55c4, 0])),
          full('hdlr', 0, 0, words([0]), bytes([0x76, 0x69, 0x64, 0x65]), words([0, 0, 0]), new TextEncoder().encode('Swarms\0')),
          box('minf', full('vmhd', 0, 1, shorts([0, 0, 0, 0])), box('dinf', full('dref', 0, 0, words([1]), full('url ', 0, 1))), table(offset)),
        ),
      ),
    )
  const type = box('ftyp', bytes([0x69, 0x73, 0x6f, 0x6d]), words([0x200]), bytes([0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31]))
  const head = type.length + movie(0).length + 8
  const moov = movie(head)
  const payload = samples.reduce((sum, sample) => sum + sample.length, 0)
  const out = new Uint8Array(head + payload)
  out.set(type, 0)
  out.set(moov, type.length)
  new DataView(out.buffer).setUint32(type.length + moov.length, 8 + payload)
  out.set(bytes([0x6d, 0x64, 0x61, 0x74]), type.length + moov.length + 4)
  let at = head
  for (const sample of samples) {
    out.set(sample, at)
    at += sample.length
  }
  return out
}
