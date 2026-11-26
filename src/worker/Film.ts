import * as Limits from '../shared/Limits.ts'
import type { Mark, Scene } from './Cards.ts'
import * as Mp4 from './Mp4.ts'
import type { Canvas } from './Paint.ts'
import * as Paint from './Paint.ts'

export type Raster = (svg: string, width: number, height: number) => Uint8Array

export type Encoder = { encode: (quality: number, key: boolean) => Uint8Array; pixels: () => Uint8Array }

export type Kit = { encoder: (width: number, height: number, gop: number) => Encoder; raster: Raster }

export const fps = 24

export const seconds = Limits.WorkerFilm.seconds

export function svg(scene: Scene) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">${scene.parts}</svg>`
}

export function where(scene: Scene, mark: Mark, t: number) {
  if (!t || !mark.sway) return { x: Math.floor(mark.x) + Limits.WorkerPaint.halfPixel, y: Math.floor(mark.y) + Limits.WorkerPaint.halfPixel }
  const dx = mark.x - scene.hub.x
  const dy = mark.y - scene.hub.y
  const r = Math.hypot(dx, dy)
  const near = 1 - Math.min(1, r / Math.max(1, scene.hub.r))
  const turn = mark.sway * Math.sin((Math.PI * 2 * t) / seconds) * (Limits.WorkerFilm.swayBase + Limits.WorkerFilm.swayNear * near)
  const angle = Math.atan2(dy, dx) + turn
  const breathe = 1 + mark.sway * Limits.WorkerFilm.breathe * Math.sin((Math.PI * Limits.WorkerFilm.breatheTurns * t) / seconds + r / Limits.WorkerFilm.breatheSpread)
  return { x: scene.hub.x + Math.cos(angle) * r * breathe, y: scene.hub.y + Math.sin(angle) * r * breathe }
}

export function paint(scene: Scene, canvas: Canvas, t: number) {
  const unit = Math.min(scene.width / Limits.Share.card.width, scene.height / Limits.Share.card.height)
  for (const mark of scene.marks) {
    const at = where(scene, mark, t)
    const color = Paint.hex(mark.color)
    Paint.plus(canvas, at.x, at.y, mark.size, unit, color)
    if (mark.ring) Paint.ring(canvas, at.x, at.y, Limits.WorkerFilm.ringRadius * unit, unit, Paint.hex('#000000'))
  }
}

export async function picture(kit: Kit, scene: Scene) {
  const canvas = { data: kit.raster(svg(scene), scene.width, scene.height), height: scene.height, width: scene.width }
  paint(scene, canvas, 0)
  return Paint.png(canvas)
}

export async function film(kit: Kit, scene: Scene) {
  const bare = kit.raster(svg(scene), scene.width, scene.height)
  const encoder = kit.encoder(scene.width, scene.height, fps * 2)
  const frames: Uint8Array[] = []
  const total = fps * seconds
  for (let index = 0; index < total; index++) {
    const data = encoder.pixels()
    data.set(bare)
    paint(scene, { data, height: scene.height, width: scene.width }, index / fps)
    frames.push(encoder.encode(Limits.WorkerFilm.quality, index % (fps * 2) === 0))
    if (index % Limits.WorkerFilm.yieldEvery === Limits.WorkerFilm.yieldEvery - 1) await new Promise((resolve) => setTimeout(resolve, 0))
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
      pixels: () => new Uint8Array(exports.memory.buffer, exports.pixels(), width * height * Limits.WorkerPaint.rgbaBytes),
    }
  }
}
