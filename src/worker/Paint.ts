import * as Limits from '../shared/Limits.ts'

const paint = Limits.WorkerPaint

export type Canvas = { data: Uint8Array; height: number; width: number }

export type Color = readonly [number, number, number]

export function hex(value: string): Color {
  const raw = value.replace('#', '')
  return [parseInt(raw.slice(0, 2), paint.hexRadix), parseInt(raw.slice(2, paint.hexBlueAt), paint.hexRadix), parseInt(raw.slice(paint.hexBlueAt, paint.hexEnd), paint.hexRadix)]
}

function blend(canvas: Canvas, x: number, y: number, color: Color, alpha: number) {
  if (alpha <= 0) return
  const at = (y * canvas.width + x) * paint.rgbaBytes
  const keep = 1 - Math.min(1, alpha)
  const data = canvas.data
  data[at] = (data[at] ?? 0) * keep + color[0] * (1 - keep)
  data[at + 1] = (data[at + 1] ?? 0) * keep + color[1] * (1 - keep)
  data[at + 2] = (data[at + 2] ?? 0) * keep + color[2] * (1 - keep)
}

function shade(canvas: Canvas, left: number, top: number, right: number, bottom: number, cover: (x: number, y: number) => number, color: Color, alpha: number) {
  const x0 = Math.max(0, Math.floor(left))
  const y0 = Math.max(0, Math.floor(top))
  const x1 = Math.min(canvas.width - 1, Math.ceil(right))
  const y1 = Math.min(canvas.height - 1, Math.ceil(bottom))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blend(canvas, x, y, color, cover(x + paint.halfPixel, y + paint.halfPixel) * alpha)
}

function clamp(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function disc(canvas: Canvas, cx: number, cy: number, radius: number, color: Color, alpha = 1) {
  if (radius <= 0 || alpha <= 0) return
  shade(canvas, cx - radius - 1, cy - radius - 1, cx + radius + 1, cy + radius + 1, (x, y) => clamp(radius + paint.halfPixel - Math.hypot(x - cx, y - cy)), color, alpha)
}

export function ring(canvas: Canvas, cx: number, cy: number, radius: number, stroke: number, color: Color, alpha = 1) {
  if (radius <= 0 || alpha <= 0) return
  const half = stroke / 2
  shade(canvas, cx - radius - half - 1, cy - radius - half - 1, cx + radius + half + 1, cy + radius + half + 1, (x, y) => clamp(half + paint.halfPixel - Math.abs(Math.hypot(x - cx, y - cy) - radius)), color, alpha)
}

export function diamond(canvas: Canvas, cx: number, cy: number, radius: number, color: Color, alpha = 1) {
  shade(canvas, cx - radius - 1, cy - radius - 1, cx + radius + 1, cy + radius + 1, (x, y) => clamp((radius - Math.abs(x - cx) - Math.abs(y - cy)) * paint.diagonalScale + paint.halfPixel), color, alpha)
}

export function segment(canvas: Canvas, ax: number, ay: number, bx: number, by: number, stroke: number, color: Color, alpha = 1) {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const half = stroke / 2
  shade(
    canvas,
    Math.min(ax, bx) - half - 1,
    Math.min(ay, by) - half - 1,
    Math.max(ax, bx) + half + 1,
    Math.max(ay, by) + half + 1,
    (x, y) => {
      const t = length ? clamp(((x - ax) * dx + (y - ay) * dy) / length) : 0
      return clamp(half + paint.halfPixel - Math.hypot(x - ax - t * dx, y - ay - t * dy))
    },
    color,
    alpha,
  )
}

export function plus(canvas: Canvas, x: number, y: number, size: number, stroke: number, color: Color, alpha = 1) {
  const half = (size - 1) / 2
  segment(canvas, x - half, y, x + half, y, stroke, color, alpha)
  shade(canvas, x - stroke, y - half - 1, x + stroke, y + half + 1, (px, py) => (Math.abs(py - y) < stroke / 2 + paint.halfPixel ? 0 : clamp(stroke / 2 + paint.halfPixel - Math.hypot(px - x, Math.max(0, Math.abs(py - y) - half)))), color, alpha)
}

export function bar(canvas: Canvas, left: number, top: number, wide: number, high: number, color: Color, alpha = 1) {
  if (wide <= 0) return
  const radius = Math.min(high, wide) / 2
  shade(
    canvas,
    left - 1,
    top - 1,
    left + wide + 1,
    top + high + 1,
    (x, y) => {
      const qx = Math.abs(x - left - wide / 2) - wide / 2 + radius
      const qy = Math.abs(y - top - high / 2) - high / 2 + radius
      return clamp(paint.halfPixel - (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius))
    },
    color,
    alpha,
  )
}

export function copy(from: Canvas, to: Canvas, left: number, top: number, wide: number, high: number) {
  const x0 = Math.max(0, Math.floor(left))
  const x1 = Math.min(to.width, Math.ceil(left + wide))
  if (x1 <= x0) return
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(to.height, Math.ceil(top + high)); y++) {
    const start = (y * to.width + x0) * paint.rgbaBytes
    to.data.set(from.data.subarray(start, start + (x1 - x0) * paint.rgbaBytes), start)
  }
}

const table = (() => {
  const out = new Uint32Array(paint.crcTableSize)
  for (let index = 0; index < paint.crcTableSize; index++) {
    let value = index
    for (let bit = 0; bit < paint.byteBits; bit++) value = value & 1 ? paint.crcPolynomial ^ (value >>> 1) : value >>> 1
    out[index] = value >>> 0
  }
  return out
})()

function crc(parts: Uint8Array[]) {
  let value: number = paint.crcSeed
  for (const part of parts) for (const byte of part) value = (table[(value ^ byte) & paint.byteMask] ?? 0) ^ (value >>> paint.byteBits)
  return (value ^ paint.crcSeed) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const name = new TextEncoder().encode(type)
  const out = new Uint8Array(paint.chunkOverhead + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(name, paint.chunkTypeAt)
  out.set(data, paint.chunkDataAt)
  view.setUint32(paint.chunkDataAt + data.length, crc([name, data]))
  return out
}

export async function png(canvas: Canvas) {
  const { data, height, width } = canvas
  const stride = width * paint.rgbBytes
  const rows = new Uint8Array((stride + 1) * height)
  const line = new Uint8Array(stride)
  const last = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      line[x * paint.rgbBytes] = data[(y * width + x) * paint.rgbaBytes] ?? 0
      line[x * paint.rgbBytes + 1] = data[(y * width + x) * paint.rgbaBytes + 1] ?? 0
      line[x * paint.rgbBytes + 2] = data[(y * width + x) * paint.rgbaBytes + 2] ?? 0
    }
    const at = y * (stride + 1)
    rows[at] = paint.paethFilter
    for (let x = 0; x < stride; x++) {
      const a = x >= paint.rgbBytes ? (line[x - paint.rgbBytes] ?? 0) : 0
      const b = y > 0 ? (last[x] ?? 0) : 0
      const c = x >= paint.rgbBytes && y > 0 ? (last[x - paint.rgbBytes] ?? 0) : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      rows[at + 1 + x] = ((line[x] ?? 0) - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & paint.byteMask
    }
    last.set(line)
  }
  const packed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const header = new Uint8Array(paint.headerBytes)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(paint.headerHeightAt, height)
  header.set([paint.bitDepth, paint.truecolor, 0, 0, 0], paint.headerDepthAt)
  const parts = [Uint8Array.from(paint.signature), chunk('IHDR', header), chunk('IDAT', packed), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
