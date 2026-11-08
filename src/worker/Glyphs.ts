export type Face = { advances: Uint16Array; ascent: number; descent: number; family: string; glyphs: Map<number, number>; units: number }

export function face(data: ArrayBuffer, family: string): Face {
  const view = new DataView(data)
  const tables = new Map<string, number>()
  const count = view.getUint16(4)
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16
    tables.set(String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)), view.getUint32(at + 8))
  }
  const table = (name: string) => {
    const at = tables.get(name)
    if (at === undefined) throw new Error(`The font has no ${name} table`)
    return at
  }
  const head = table('head')
  const hhea = table('hhea')
  const hmtx = table('hmtx')
  const metrics = view.getUint16(hhea + 34)
  const total = view.getUint16(table('maxp') + 4)
  const advances = new Uint16Array(total)
  for (let index = 0; index < total; index++) advances[index] = view.getUint16(hmtx + Math.min(index, metrics - 1) * 4)
  return { advances, ascent: view.getInt16(hhea + 4), descent: -view.getInt16(hhea + 6), family, glyphs: cmap(view, table('cmap')), units: view.getUint16(head + 18) }
}

function cmap(view: DataView, at: number) {
  const glyphs = new Map<number, number>()
  const count = view.getUint16(at + 2)
  for (let index = 0; index < count; index++) {
    const sub = at + view.getUint32(at + 4 + index * 8 + 4)
    const format = view.getUint16(sub)
    if (format === 4) {
      const segments = view.getUint16(sub + 6) / 2
      const ends = sub + 14
      const starts = ends + segments * 2 + 2
      const deltas = starts + segments * 2
      const offsets = deltas + segments * 2
      for (let segment = 0; segment < segments; segment++) {
        const end = view.getUint16(ends + segment * 2)
        const start = view.getUint16(starts + segment * 2)
        const delta = view.getInt16(deltas + segment * 2)
        const offset = view.getUint16(offsets + segment * 2)
        for (let code = start; code <= end && code !== 0xffff; code++) {
          const glyph = offset === 0 ? (code + delta) & 0xffff : view.getUint16(offsets + segment * 2 + offset + (code - start) * 2)
          if (glyph && !glyphs.has(code)) glyphs.set(code, offset === 0 ? glyph : (glyph + delta) & 0xffff)
        }
      }
    }
    if (format === 12) {
      const groups = view.getUint32(sub + 12)
      for (let group = 0; group < groups; group++) {
        const base = sub + 16 + group * 12
        const start = view.getUint32(base)
        const end = view.getUint32(base + 4)
        const first = view.getUint32(base + 8)
        for (let code = start; code <= end; code++) if (!glyphs.has(code)) glyphs.set(code, first + code - start)
      }
    }
  }
  return glyphs
}

export function clean(face: Face, text: string) {
  return [...text.normalize('NFC').replace(/\s+/g, ' ')].filter((char) => char === ' ' || face.glyphs.has(char.codePointAt(0) ?? 0)).join('').replace(/\s+/g, ' ').trim()
}

export function width(face: Face, text: string, size: number, spacing = 0) {
  let units = 0
  let count = 0
  for (const char of text) {
    const glyph = face.glyphs.get(char.codePointAt(0) ?? 0)
    units += glyph === undefined ? face.units * 0.6 : (face.advances[glyph] ?? 0)
    count++
  }
  return (units / face.units) * size + spacing * count
}

export function wrap(face: Face, text: string, size: number, room: number, lines: number, spacing = 0) {
  const words = clean(face, text).split(' ').filter(Boolean)
  const out: string[] = []
  let line = ''
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? ''
    const next = line ? `${line} ${word}` : word
    if (width(face, next, size, spacing) <= room) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = word
    while (width(face, line, size, spacing) > room) {
      let cut = line.length - 1
      while (cut > 1 && width(face, line.slice(0, cut), size, spacing) > room) cut--
      out.push(line.slice(0, cut))
      line = line.slice(cut)
    }
    if (out.length >= lines) {
      out.length = lines
      return ellipsis(face, out, size, room, spacing)
    }
  }
  if (line) out.push(line)
  if (out.length > lines) {
    out.length = lines
    return ellipsis(face, out, size, room, spacing)
  }
  return out
}

function ellipsis(face: Face, lines: string[], size: number, room: number, spacing: number) {
  let last = (lines.at(-1) ?? '').replace(/[\s,;:.\u2014\u2013-]+$/, '')
  while (last && width(face, `${last}…`, size, spacing) > room) last = last.replace(/\s*\S+$/, '') || last.slice(0, -1)
  return [...lines.slice(0, -1), `${last.replace(/[\s,;:.\u2014\u2013-]+$/, '')}…`]
}
