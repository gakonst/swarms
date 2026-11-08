import type { Mood } from '../shared/Status.ts'
import type { Hive, Line, Link, Scene } from './Cards.ts'
import { tones } from './Cards.ts'
import * as Mp4 from './Mp4.ts'
import type { Canvas, Color } from './Paint.ts'
import * as Paint from './Paint.ts'

export type Raster = (svg: string, width: number, height: number) => Uint8Array

export type Encoder = { encode: (quality: number, key: boolean) => Uint8Array; pixels: () => Uint8Array }

export type Kit = { encoder: (width: number, height: number, gop: number) => Encoder; raster: Raster }

export const fps = 24

export const seconds = 6

const white: Color = [255, 255, 255]

const ink: Color = [22, 22, 22]

const field: Record<Mood, Color> = { live: [26, 140, 69], money: [156, 138, 99], new: [109, 142, 82] }

function hash(text: string, seed: number) {
  let value = 2166136261 ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return ((value >>> 0) % 100000) / 100000
}

function clamp(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function ease(value: number) {
  const t = clamp(value)
  return 1 - (1 - t) ** 3
}

function fraction(value: number) {
  return value - Math.floor(value)
}

export function svg(scene: Scene, typed: boolean) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">${scene.parts}${typed ? scene.typed : ''}</svg>`
}

function cover(canvas: Canvas, hive: Hive, t: number) {
  const color = Paint.hex(tones[hive.mood][2])
  const unit = hive.reach / 46
  const bloom = ease((t - 0.05) / 1.1)
  const count = 24 + Math.floor(hash(hive.seed, 3) * 16)
  const points = Array.from({ length: count }, (_, index) => {
    const spin = (0.05 + hash(hive.seed, 300 + index) * 0.09) * (index % 2 ? 1 : -1)
    const angle = hash(hive.seed, 10 + index) * Math.PI * 2 + spin * t
    const distance = Math.sqrt(hash(hive.seed, 50 + index)) * hive.reach * bloom
    const sag = hive.mood === 'money' ? Math.sin(t * 1.1 + index) * hive.reach * 0.025 + hive.reach * 0.05 * hash(hive.seed, 60 + index) : 0
    return { alpha: 0.35 + hash(hive.seed, 120 + index) * 0.55, r: (1.2 + hash(hive.seed, 90 + index) * 2.6) * unit, x: hive.x + Math.cos(angle) * distance * 1.5, y: hive.y + Math.sin(angle) * distance * 0.8 + sag }
  })
  points.forEach((point, index) => {
    if (index % 3 === 0) Paint.segment(canvas, hive.x, hive.y, point.x, point.y, 1.3 * unit, color, 0.22)
  })
  if (hive.mood === 'live')
    points.forEach((point, index) => {
      if (index % 3 !== 0) return
      const p = fraction(t * 0.55 + hash(hive.seed, 400 + index))
      Paint.disc(canvas, hive.x + (point.x - hive.x) * p, hive.y + (point.y - hive.y) * p, 1.9 * unit, white, 0.95 * (1 - p) * bloom)
    })
  for (const point of points) Paint.disc(canvas, point.x, point.y, point.r, color, point.alpha)
  if (hive.mood === 'live') {
    const phase = fraction(t / 1.6)
    Paint.ring(canvas, hive.x, hive.y, 6 * unit + 16 * unit * phase, 1.6 * unit, color, 0.45 * (1 - phase))
  }
  Paint.disc(canvas, hive.x, hive.y, 7 * unit, white)
  Paint.ring(canvas, hive.x, hive.y, 6 * unit, 2.2 * unit, color)
}

function burst(canvas: Canvas, hive: Hive, t: number) {
  const color = field[hive.mood]
  const unit = hive.reach / 74
  const grow = ease((t - hash(hive.seed, 5) * 0.5) / 0.9)
  const count = 70 + Math.floor(hash(hive.seed, 3) * 40)
  for (let index = 0; index < count; index++) {
    const angle = hash(hive.seed, 10 + index) * Math.PI * 2
    const p = fraction(hash(hive.seed, 500 + index) + t * (0.1 + hash(hive.seed, 600 + index) * 0.12))
    const distance = hive.reach * (0.08 + 0.92 * p ** 0.85) * (0.55 + 0.45 * hash(hive.seed, 700 + index))
    const x = hive.x + Math.cos(angle) * distance
    const y = hive.y + Math.sin(angle) * distance
    const alpha = 0.9 * (1 - p) ** 0.7 * grow
    if (index % 4 === 0) Paint.segment(canvas, hive.x, hive.y, x, y, 0.9 * unit, color, alpha * 0.28)
    Paint.disc(canvas, x, y, (0.9 + hash(hive.seed, 800 + index) * 1.4) * unit, color, alpha)
  }
  Paint.disc(canvas, hive.x, hive.y, 4.5 * unit, color, grow)
}

function smudge(canvas: Canvas, hive: Hive, t: number) {
  const color = field.money
  const unit = Math.max(0.6, hive.reach / 50)
  const grow = ease((t - hash(hive.seed, 5) * 0.6) / 0.9)
  const count = 40 + Math.floor(hash(hive.seed, 3) * 30)
  for (let index = 0; index < count; index++) {
    const angle = hash(hive.seed, 10 + index) * Math.PI * 2
    const distance = Math.sqrt(hash(hive.seed, 50 + index)) * hive.reach
    const drift = Math.sin(t * (0.5 + hash(hive.seed, 900 + index) * 0.6) + index) * hive.reach * 0.07
    const x = hive.x + Math.cos(angle) * distance * 1.3 + drift
    const y = hive.y + Math.sin(angle) * distance * 0.62 + hive.reach * 0.16 * (Math.cos(angle) * Math.cos(angle))
    Paint.disc(canvas, x, y, (0.8 + hash(hive.seed, 90 + index) * 1.2) * unit, color, (0.3 + hash(hive.seed, 120 + index) * 0.4) * grow)
  }
  Paint.diamond(canvas, hive.x, hive.y, 6.5 * unit, Paint.hex('#e0a43c'), grow)
}

function seed(canvas: Canvas, hive: Hive, t: number) {
  const color = field.new
  const grow = ease((t - hash(hive.seed, 5) * 0.8) / 0.8)
  const dots = 9
  for (let index = 0; index < dots; index++) {
    const angle = (index / dots) * Math.PI * 2 + t * 0.35
    Paint.disc(canvas, hive.x + Math.cos(angle) * hive.reach, hive.y + Math.sin(angle) * hive.reach, Math.max(1, hive.reach / 9), color, 0.7 * grow)
  }
  Paint.disc(canvas, hive.x, hive.y, Math.max(1.4, hive.reach / 6), color, 0.8 * grow)
}

function plan(lines: Line[], width: number) {
  const speed = Math.max(620 * (width / 1200), lines.reduce((sum, line) => sum + line.wide, 0) / (seconds - 2.4))
  let at = 0.6
  return lines.map((line) => {
    const start = at
    at += line.wide / speed + 0.06
    return { end: at - 0.06, line, start }
  })
}

function dashed(canvas: Canvas, link: Link, unit: number, alpha: number) {
  const length = Math.hypot(link.bx - link.ax, link.by - link.ay)
  const step = 8 * unit
  for (let at = 0; at + 2 * unit < length; at += step) {
    const from = at / length
    const to = (at + 2 * unit) / length
    Paint.segment(canvas, link.ax + (link.bx - link.ax) * from, link.ay + (link.by - link.ay) * from, link.ax + (link.bx - link.ax) * to, link.ay + (link.by - link.ay) * to, 1.2 * unit, ink, alpha)
  }
}

export function paint(scene: Scene, canvas: Canvas, t: number, still: boolean) {
  const unit = scene.width / 1200
  for (const link of scene.links) dashed(canvas, link, unit, 0.16 * ease((t - 0.6) / 1.2))
  for (const hive of scene.hives) {
    if (hive.kind === 'cover') cover(canvas, hive, t)
    if (hive.kind === 'burst') burst(canvas, hive, t)
    if (hive.kind === 'smudge') smudge(canvas, hive, t)
    if (hive.kind === 'seed') seed(canvas, hive, t)
  }
  if (scene.gauge) {
    const gauge = scene.gauge
    Paint.bar(canvas, gauge.left, gauge.top, Math.max(gauge.high, gauge.wide * gauge.fill * ease((t - 0.2) / 1.4)), gauge.high, Paint.hex(gauge.color), gauge.fill > 0 ? 1 : 0)
  }
  if (scene.pulse) {
    const pulse = scene.pulse
    const color = Paint.hex(pulse.color)
    const phase = fraction(t / 1.4)
    if (!still) Paint.ring(canvas, pulse.x, pulse.y, pulse.radius * (1 + phase * 1.6), pulse.radius * 0.5, color, 0.55 * (1 - phase))
    Paint.disc(canvas, pulse.x, pulse.y, pulse.radius * (still ? 1 : 0.85 + 0.15 * Math.cos(phase * Math.PI * 2)), color)
  }
}

export async function picture(kit: Kit, scene: Scene) {
  const canvas = { data: kit.raster(svg(scene, true), scene.width, scene.height), height: scene.height, width: scene.width }
  paint(scene, canvas, seconds, true)
  return Paint.png(canvas)
}

export async function film(kit: Kit, scene: Scene) {
  const bare = kit.raster(svg(scene, false), scene.width, scene.height)
  const dressed = scene.typed ? kit.raster(svg(scene, true), scene.width, scene.height) : bare
  const typing = plan(scene.lines, scene.width)
  const encoder = kit.encoder(scene.width, scene.height, fps * 2)
  const frames: Uint8Array[] = []
  const caret = Paint.hex('#3d5232')
  const total = fps * seconds
  for (let index = 0; index < total; index++) {
    const t = index / fps
    const data = encoder.pixels()
    data.set(bare)
    const canvas = { data, height: scene.height, width: scene.width }
    const from = { data: dressed, height: scene.height, width: scene.width }
    for (const step of typing) {
      if (t < step.start) continue
      const shown = step.line.wide * clamp((t - step.start) / Math.max(0.001, step.end - step.start))
      Paint.copy(from, canvas, step.line.left, step.line.top, shown, step.line.high)
      const last = step === typing.at(-1)
      if ((t < step.end || (last && t < step.end + 1.2 && fraction(t * 1.6) < 0.6)) && step.line.wide > 0) Paint.bar(canvas, step.line.left + shown + 2, step.line.top + step.line.high * 0.12, 2.6 * (scene.width / 1200), step.line.high * 0.78, caret)
    }
    paint(scene, canvas, t, false)
    frames.push(encoder.encode(25, index % (fps * 2) === 0))
    if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return Mp4.mux(frames, { fps, height: scene.height, width: scene.width })
}

export function encoder(module: WebAssembly.Module) {
  return (width: number, height: number, gop: number): Encoder => {
    const instance = new WebAssembly.Instance(module, {})
    const exports = instance.exports as { encode: (quality: number, key: number) => number; memory: WebAssembly.Memory; output: () => number; pixels: () => number; start: (width: number, height: number, gop: number) => number }
    const failed = exports.start(width, height, gop)
    if (failed !== 0) throw new Error(`The video encoder did not start (${failed})`)
    return {
      encode: (quality, key) => {
        const size = exports.encode(quality, key ? 1 : 0)
        if (size < 0) throw new Error(`The video encoder failed (${size})`)
        return new Uint8Array(exports.memory.buffer, exports.output(), size).slice()
      },
      pixels: () => new Uint8Array(exports.memory.buffer, exports.pixels(), width * height * 4),
    }
  }
}
