import type { Mood } from '../shared/Status.ts'

export type Home = 'join' | 'start'

export type Hive = { about: string; detail: string; facts: string; fresh: number; home: Home; id: string; mood: Mood; title: string; updated: number; weight: number }

export type Options = {
  avoid?: (() => readonly (Element | null | undefined)[]) | undefined
  canvas: HTMLCanvasElement
  homes: () => Partial<Record<Home, Element | null | undefined>>
  label?: HTMLElement | undefined
  onPick?: ((id: string | undefined) => void) | undefined
  still: boolean
  tags?: HTMLElement | null | undefined
}

export type Field = {
  focus: (id: string | undefined) => void
  group: (mood: Mood | undefined) => void
  hives: (hives: readonly Hive[]) => void
  layout: () => void
  pointer: (x: number | undefined, y: number | undefined) => void
  run: (running: boolean) => void
  stop: () => void
}

type Vector = [number, number, number]

type Box = { h: number; w: number; x: number; y: number }

type Tag = { dx: number; dy: number; element: HTMLElement; h: number; last: string; w: number }

type Slot = { at: Vector; center: Vector; focus: number; hive: Hive; phase: Vector; px: number; radius: number; seen: boolean; show: number; spark: number; tag: Tag | undefined; target: Vector }

const most = 64
const stride = 6
const tau = Math.PI * 2
const fov = 0.62
const lens = Math.tan(fov / 2)
const eye = 10
const depth = 2.6

const codes: Record<Mood, number> = { errors: 3, live: 0, money: 1, new: 4, resting: 2 }

const tints: Record<Mood, Vector> = { errors: [0.72, 0.2, 0.16], live: [0.1, 0.55, 0.27], money: [0.78, 0.52, 0.1], new: [0.12, 0.18, 0.1], resting: [0.3, 0.43, 0.55] }

const ink: Vector = [0.26, 0.34, 0.22]

const activity: Record<Mood, number> = { errors: 0.45, live: 1, money: 0.14, new: 0.03, resting: 0.08 }

const shared = `#version 300 es
precision highp float;
layout(location = 0) in float aHive;
layout(location = 1) in vec4 aSeed;
layout(location = 2) in float aEnd;
uniform mat4 uMatrix;
uniform float uTime;
uniform float uIntro;
uniform float uSize;
uniform float uPx;
uniform float uDim;
uniform float uLines;
uniform vec3 uInk;
uniform vec3 uLive;
uniform vec4 uHive[${most}];
uniform vec4 uTint[${most}];
uniform vec4 uState[${most}];
const float TAU = 6.28318530718;
vec3 turn(vec3 p, float inc, float node) {
  float ci = cos(inc), si = sin(inc), cn = cos(node), sn = sin(node);
  p = vec3(p.x, p.y * ci - p.z * si, p.y * si + p.z * ci);
  return vec3(p.x * cn + p.z * sn, p.y, -p.x * sn + p.z * cn);
}
float fog(float z) {
  return 1.0 - 0.55 * clamp(-z / ${depth.toFixed(2)} + 0.5, 0.0, 1.0);
}
`

const agents = `${shared}
out vec4 vColor;
out float vAlong;
out float vSeed;
out float vPulse;
out float vDash;
void main() {
  int i = int(aHive + 0.5);
  vec4 h = uHive[i];
  vec4 state = uState[i];
  if (uLines > 2.5) {
    int j = int(aSeed.x + 0.5);
    vec4 k = uHive[j];
    float near = max(state.x, uState[j].x);
    vec3 q = aEnd < 0.5 ? h.xyz : k.xyz;
    gl_Position = uMatrix * vec4(q, 1.0);
    gl_PointSize = 1.0;
    float lit = mix(1.0 - uDim * 0.8, 1.0, near) * min(state.z, uState[j].z);
    vColor = vec4(uInk, (0.12 + 0.5 * near) * lit * fog(q.z) * clamp(uIntro * 1.6 - 0.5, 0.0, 1.0));
    vAlong = aEnd;
    vSeed = aSeed.y;
    vPulse = min(uTint[i].a, uTint[j].a);
    vDash = aSeed.z;
    return;
  }
  vec4 tint = uTint[i];
  float focus = state.x;
  float mood = state.y;
  float spark = state.w;
  bool seed = mood > 3.5;
  float act = clamp(tint.a + spark + (seed ? focus * 0.9 : 0.0), 0.0, 1.0);
  float grow = clamp(uIntro * 1.8 - aSeed.y * 0.8, 0.0, 1.0);
  grow = grow * grow * (3.0 - 2.0 * grow);
  float t = uTime * (0.035 + 0.85 * act) * (0.55 + 0.9 * aSeed.y) + aSeed.z * TAU;
  float r = h.w * (0.2 + 0.8 * sqrt(aSeed.x));
  float tilt = mood < 0.5 ? 1.0 : mood < 1.5 ? 0.28 : mood < 2.5 ? 0.1 : mood < 3.5 ? 0.9 : focus;
  vec3 o = turn(vec3(cos(t) * r, 0.0, sin(t) * r), (aSeed.w - 0.5) * 2.8 * tilt, aSeed.y * TAU);
  o += 0.2 * h.w * act * vec3(sin(t * 2.3 + aSeed.x * 17.0), sin(t * 1.9 + aSeed.w * 11.0), cos(t * 2.7 + aSeed.y * 13.0));
  if (mood > 2.5 && mood < 3.5) o += 0.06 * h.w * vec3(sin(uTime * 31.0 + aSeed.x * 50.0), sin(uTime * 27.0 + aSeed.y * 40.0), sin(uTime * 23.0 + aSeed.z * 60.0));
  if (mood > 0.5 && mood < 1.5) o.y -= h.w * 0.22 * (1.0 - aSeed.x);
  if (seed) {
    float a = aSeed.z * TAU + uTime * 0.04;
    vec3 ring = vec3(cos(a), 0.0, sin(a)) * h.w * 0.7;
    o = mix(ring, o, focus);
  }
  vec3 p = h.xyz + o * mix(0.03, 1.0, grow);
  if (uLines > 0.5 && aEnd < 0.5) p = h.xyz;
  vec4 clip = uMatrix * vec4(p, 1.0);
  gl_Position = clip;
  float span = clamp(h.w * uPx / clip.w / 28.0, 0.55, 1.2);
  float lit = mix(1.0 - uDim * 0.72, 1.0, focus) * fog(h.z) * state.z;
  gl_PointSize = uSize * (0.9 + 1.7 * aSeed.x) * span * (1.0 + focus * 0.45 + spark * 0.8);
  vec3 tone = seed ? mix(tint.rgb, uLive, focus) : mood < 0.5 ? tint.rgb : mix(uInk, tint.rgb, 0.12 + 0.88 * focus);
  vColor = vec4(mix(tone, vec3(1.0), spark * 0.5), (mood < 0.5 ? 0.85 : 0.6) * lit * grow);
  vAlong = aEnd;
  vSeed = aSeed.z;
  vPulse = act;
  vDash = 0.0;
}
`

const dots = `#version 300 es
precision highp float;
in vec4 vColor;
in float vAlong;
in float vSeed;
in float vPulse;
in float vDash;
uniform float uLines;
uniform float uTime;
out vec4 color;
void main() {
  float a;
  if (uLines > 2.5) {
    float head = fract(uTime * 0.16 + vSeed);
    float packet = exp(-pow((vAlong - head) * 12.0, 2.0)) * vPulse;
    a = vColor.a * (step(0.55, fract(vAlong * vDash)) + 2.5 * packet);
  } else if (uLines > 0.5) {
    float head = fract(uTime * 0.42 + vSeed * 3.0);
    float packet = exp(-pow((vAlong - head) * 8.0, 2.0)) * vPulse;
    a = vColor.a * (0.1 + 0.18 * vPulse + 0.85 * packet) * smoothstep(0.0, 0.25, vAlong);
  } else {
    float d = length(gl_PointCoord - 0.5);
    a = vColor.a * smoothstep(0.5, 0.12, d);
  }
  a = clamp(a, 0.0, 1.0);
  color = vec4(vColor.rgb * a, a);
}
`

const cores = `${shared}
out vec4 vColor;
out float vMood;
out float vFocus;
out float vSpark;
void main() {
  int i = int(aHive + 0.5);
  vec4 h = uHive[i];
  vec4 state = uState[i];
  gl_Position = uMatrix * vec4(h.xyz, 1.0);
  float grow = clamp(uIntro * 1.4, 0.0, 1.0);
  gl_PointSize = uSize * (5.5 + 9.0 * state.x) * grow;
  float lit = mix(1.0 - uDim * 0.6, 1.0, state.x) * fog(h.z) * state.z;
  vColor = vec4(uTint[i].rgb, lit);
  vMood = state.y;
  vFocus = state.x;
  vSpark = state.w;
}
`

const glyphs = `#version 300 es
precision highp float;
in vec4 vColor;
in float vMood;
in float vFocus;
in float vSpark;
uniform float uTime;
out vec4 color;
const float TAU = 6.28318530718;
float band(float d, float r, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.03, abs(d - r)); }
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);
  vec2 g = q * (1.0 + 1.6 * vFocus);
  float d = length(g);
  float shape;
  if (vMood < 0.5) {
    float beat = fract(uTime * 0.6);
    shape = 1.0 - smoothstep(0.3, 0.36, d);
    shape = max(shape, band(d, 0.36 + 0.5 * beat, 0.06) * (1.0 - beat));
  } else if (vMood < 1.5) {
    shape = 1.0 - smoothstep(0.32, 0.38, abs(g.x) + abs(g.y));
  } else if (vMood < 2.5) {
    shape = band(d, 0.28, 0.14);
  } else if (vMood < 3.5) {
    vec2 t = g + vec2(0.0, 0.08);
    float e = max(abs(t.x) * 0.866 + t.y * 0.5, -t.y) - 0.2;
    shape = 1.0 - smoothstep(0.0, 0.05, e);
  } else {
    float dash = step(0.5, fract(atan(g.y, g.x) / TAU * 8.0 + uTime * 0.05));
    shape = band(d, 0.28, 0.1) * dash;
  }
  float arms = 0.0;
  if (vFocus > 0.01) {
    float edge = max(abs(q.x), abs(q.y));
    float reach = smoothstep(0.6, 0.66, edge) * (1.0 - smoothstep(0.94, 1.0, edge));
    arms = max(step(abs(q.y), 0.014), step(abs(q.x), 0.014)) * reach * vFocus;
  }
  float a = max(shape, arms) * vColor.a;
  vec3 tone = mix(vColor.rgb, vec3(1.0), vSpark * 0.6);
  color = vec4(tone * a, a);
}
`

function hash(text: string, salt: number) {
  let value = 2166136261 ^ salt
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  value ^= value >>> 15
  value = Math.imul(value, 2246822507)
  value ^= value >>> 13
  return (value >>> 0) / 4294967296
}

function random(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function size(hive: Hive) {
  if (hive.mood === 'new') return 12
  return Math.min(46, 15 + 11 * Math.log10(1 + Math.max(0, hive.weight))) * (hive.mood === 'live' ? 1.15 : 1)
}

function extent(hive: Hive) {
  return hive.mood === 'live' ? 1.3 : hive.mood === 'money' ? 1.12 : 1.05
}

function crowd(hive: Hive) {
  if (hive.mood === 'new') return 40
  const base = 40 + 100 * Math.log10(1 + Math.max(0, hive.weight))
  return Math.round(Math.min(420, base * (hive.mood === 'live' ? 1.6 : 1)))
}

function grown(box: Box, pad: number): Box {
  return { h: box.h + pad * 2, w: box.w + pad * 2, x: box.x - pad, y: box.y - pad }
}

function apart(a: Box, b: Box) {
  return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
}

function inside(box: Box, x: number, y: number) {
  return x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h
}

function touches(box: Box, x: number, y: number, radius: number) {
  const nx = Math.max(box.x, Math.min(x, box.x + box.w))
  const ny = Math.max(box.y, Math.min(y, box.y + box.h))
  return Math.hypot(x - nx, y - ny) < radius
}

function crosses(box: Box, a: readonly number[], b: readonly number[]) {
  for (let step = 1; step < 16; step++) {
    const t = step / 16
    if (inside(box, a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t)) return true
  }
  return false
}

function perspective(aspect: number, near: number, far: number) {
  const f = 1 / lens
  const span = 1 / (near - far)
  const out = new Float32Array(16)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * span
  out[11] = -1
  out[14] = 2 * far * near * span
  return out
}

function look(from: readonly number[]) {
  const length = Math.hypot(from[0]!, from[1]!, from[2]!) || 1
  const z = [from[0]! / length, from[1]! / length, from[2]! / length]
  const side = Math.hypot(z[2]!, z[0]!) || 1
  const x = [z[2]! / side, 0, -z[0]! / side]
  const y = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!]
  const out = new Float32Array(16)
  out[0] = x[0]!
  out[1] = y[0]!
  out[2] = z[0]!
  out[4] = x[1]!
  out[5] = y[1]!
  out[6] = z[1]!
  out[8] = x[2]!
  out[9] = y[2]!
  out[10] = z[2]!
  out[12] = -(x[0]! * from[0]! + x[1]! * from[1]! + x[2]! * from[2]!)
  out[13] = -(y[0]! * from[0]! + y[1]! * from[1]! + y[2]! * from[2]!)
  out[14] = -(z[0]! * from[0]! + z[1]! * from[1]! + z[2]! * from[2]!)
  out[15] = 1
  return out
}

function multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[row + k * 4]! * b[k + column * 4]!
      out[row + column * 4] = sum
    }
  }
  return out
}

const names = ['uMatrix', 'uTime', 'uIntro', 'uSize', 'uPx', 'uDim', 'uLines', 'uInk', 'uLive', 'uHive', 'uTint', 'uState'] as const

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind)
    if (!shader) throw new Error('No shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed')
  const at = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<(typeof names)[number], WebGLUniformLocation | null>
  return { at, program }
}

type Program = ReturnType<typeof compile>

function mesh(gl: WebGL2RenderingContext, data: number[]) {
  const vao = gl.createVertexArray()
  const buffer = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, stride * 4, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride * 4, 4)
  gl.enableVertexAttribArray(2)
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride * 4, 20)
  gl.bindVertexArray(null)
  return { buffer, count: data.length / stride, vao }
}

type Mesh = ReturnType<typeof mesh>

export function start(options: Options): Field | undefined {
  const context = options.canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true })
  if (!context) return undefined
  const gl = context
  const swarm = compile(gl, agents, dots)
  const marks = compile(gl, cores, glyphs)
  const ratio = Math.min(2, devicePixelRatio || 1)
  const hives = new Float32Array(most * 4)
  const states = new Float32Array(most * 4)
  const colors = new Float32Array(most * 4)
  let slots: Slot[] = []
  let meshes: { centers: Mesh; points: Mesh; spokes: Mesh } | undefined
  let links: Mesh | undefined
  let focused: string | undefined
  let grouped: Mood | undefined
  let hovered: string | undefined
  let pointer: [number, number] | undefined
  let lean: [number, number] = [0, 0]
  let dim = 0
  let time = options.still ? 14 : 0
  let intro = options.still ? 1 : 0
  let last = performance.now()
  let frame = 0
  let running = true
  let matrix = new Float32Array(16)
  let width = 1
  let height = 1
  let laid: [number, number] = [0, 0]

  const drop = (item: Mesh | undefined) => {
    if (!item) return
    gl.deleteBuffer(item.buffer)
    gl.deleteVertexArray(item.vao)
  }

  const release = () => {
    if (meshes) for (const item of [meshes.centers, meshes.points, meshes.spokes]) drop(item)
    meshes = undefined
  }

  const rebuild = () => {
    release()
    const points: number[] = []
    const spokes: number[] = []
    const centers: number[] = []
    slots.forEach((slot, index) => {
      const draw = random(Math.floor(hash(slot.hive.id, 7) * 4294967295))
      const count = crowd(slot.hive)
      for (let agent = 0; agent < count; agent++) {
        const a = draw()
        const b = draw()
        const c = draw()
        const d = draw()
        points.push(index, a, b, c, d, 1)
        if (agent % 3 === 0) spokes.push(index, a, b, c, d, 0, index, a, b, c, d, 1)
      }
      centers.push(index, 0, 0, 0, 0, 1)
    })
    meshes = { centers: mesh(gl, centers), points: mesh(gl, points), spokes: mesh(gl, spokes) }
  }

  const layout = () => {
    const rect = options.canvas.getBoundingClientRect()
    width = Math.max(1, rect.width)
    height = Math.max(1, rect.height)
    laid = [rect.width, rect.height]
    const homes = options.homes()
    const blocks: Box[] = []
    for (const element of options.avoid?.() ?? []) {
      const box = element?.getBoundingClientRect()
      if (box && box.width && box.height) blocks.push(grown({ h: box.height, w: box.width, x: box.left - rect.left, y: box.top - rect.top }, 12))
    }
    const anchors: Partial<Record<Home, [number, number]>> = {}
    for (const key of ['start', 'join'] as const) {
      const element = homes[key]
      if (!element) continue
      const box = element.getBoundingClientRect()
      if (!box.width || !box.height) continue
      const local = { h: box.height, w: box.width, x: box.left - rect.left, y: box.top - rect.top }
      blocks.push(grown(local, 18))
      anchors[key] = [local.x + local.w / 2, local.y + local.h / 2]
    }
    const margin = Math.max(14, Math.min(40, Math.min(width, height) * 0.04))
    const free = Math.max(width * height * 0.2, width * height - blocks.reduce((sum, box) => sum + box.w * box.h, 0))
    const room = Math.max(6, Math.floor(free / 9000))
    slots.forEach((slot, index) => {
      slot.seen = index < room
    })
    const all = slots
    const live = slots.filter((slot) => slot.seen)
    const raw = live.map((slot) => size(slot.hive))
    const scale = Math.max(0.45, Math.min(1.3, Math.sqrt((free * 0.2) / Math.max(1, raw.reduce((sum, r) => sum + Math.PI * r * r, 0)))))
    const radii = raw.map((r) => r * scale)
    const outer = radii.map((r, index) => r * extent(live[index]!.hive))
    const gap = 10 + 18 * scale
    const points: number[][] = live.map((slot) => [margin + hash(slot.hive.id, 1) * (width - margin * 2), margin + hash(slot.hive.id, 2) * (height - margin * 2)])
    for (let round = 0; round < 180; round++) {
      for (let a = 0; a < points.length; a++) {
        const pa = points[a]!
        for (let b = a + 1; b < points.length; b++) {
          const pb = points[b]!
          const dx = pb[0]! - pa[0]!
          const dy = pb[1]! - pa[1]!
          const distance = Math.hypot(dx, dy) || 0.01
          const room = outer[a]! + outer[b]! + gap
          if (distance >= room) continue
          const push = (room - distance) / distance / 2
          pa[0] = pa[0]! - dx * push
          pa[1] = pa[1]! - dy * push
          pb[0] = pb[0]! + dx * push
          pb[1] = pb[1]! + dy * push
        }
      }
      points.forEach((point, index) => {
        const r = outer[index]!
        const anchor = anchors[live[index]!.hive.home]
        if (anchor) {
          point[0] = point[0]! + (anchor[0] - point[0]!) * 0.0012
          point[1] = point[1]! + (anchor[1] - point[1]!) * 0.0012
        }
        const low: [number, number] = [margin + r, margin + r]
        const high: [number, number] = [width - margin - r, height - margin - r]
        point[0] = Math.max(low[0], Math.min(high[0], point[0]!))
        point[1] = Math.max(low[1], Math.min(high[1], point[1]!))
        for (const box of blocks) {
          const nx: number = Math.max(box.x, Math.min(point[0]!, box.x + box.w))
          const ny: number = Math.max(box.y, Math.min(point[1]!, box.y + box.h))
          const dx: number = point[0]! - nx
          const dy: number = point[1]! - ny
          const distance = Math.hypot(dx, dy)
          if (distance >= r) continue
          if (distance > 0.01) {
            const x: number = nx + (dx / distance) * r
            const y: number = ny + (dy / distance) * r
            if (x >= low[0] && x <= high[0] && y >= low[1] && y <= high[1]) {
              point[0] = x
              point[1] = y
              continue
            }
          }
          const exits: number[][] = [
            [box.x - r, point[1]!],
            [box.x + box.w + r, point[1]!],
            [point[0]!, box.y - r],
            [point[0]!, box.y + box.h + r],
          ].filter((spot) => spot[0]! >= low[0] && spot[0]! <= high[0] && spot[1]! >= low[1] && spot[1]! <= high[1])
          const best: number[] | undefined = exits.sort((a, b) => Math.hypot(a[0]! - point[0]!, a[1]! - point[1]!) - Math.hypot(b[0]! - point[0]!, b[1]! - point[1]!))[0]
          if (!best) continue
          point[0] = best[0]!
          point[1] = best[1]!
        }
      })
    }

    const pairs: number[] = []
    const known = new Set<string>()
    const far = Math.max(width, height) * 0.26
    points.forEach((point, a) => {
      const near = points
        .map((other, b) => ({ b, distance: Math.hypot(other[0]! - point[0]!, other[1]! - point[1]!) }))
        .filter((item) => item.b !== a && item.distance < far)
        .sort((x, y) => x.distance - y.distance)
        .slice(0, 2)
      for (const item of near) {
        const key = a < item.b ? `${a}:${item.b}` : `${item.b}:${a}`
        if (known.has(key)) continue
        const other = points[item.b]!
        if (blocks.some((box) => crosses(box, point, other))) continue
        known.add(key)
        const phase = hash(key, 8)
        const from = all.indexOf(live[a]!)
        const to = all.indexOf(live[item.b]!)
        pairs.push(from, to, phase, item.distance / 7, 0, 0, from, to, phase, item.distance / 7, 0, 1)
      }
    })
    drop(links)
    links = mesh(gl, pairs)

    const elements = new Map<string, HTMLElement>()
    options.tags?.querySelectorAll<HTMLElement>('[data-tag]').forEach((element) => elements.set(element.dataset['tag'] ?? '', element))
    const placed: Box[] = []
    const shown = Math.max(4, Math.round((width * height) / 70000))
    const clear = 6 + width / 120
    let order = 0
    for (const slot of all) slot.tag = undefined
    live.forEach((slot, index) => {
      const element = elements.get(slot.hive.id)
      if (!element) return
      elements.delete(slot.hive.id)
      if (placed.length >= shown) {
        element.dataset['placed'] = 'false'
        return
      }
      const x = points[index]![0]!
      const y = points[index]![1]!
      const w = element.offsetWidth
      const h = element.offsetHeight
      const offset = outer[index]! * 0.8 + 12
      const lift = outer[index]! * 0.6 + 6
      const sides = x < width * 0.6 ? (['right', 'left', 'above', 'below'] as const) : (['left', 'right', 'above', 'below'] as const)
      for (const side of sides) {
        const box =
          side === 'right' ? { h, w, x: x + offset, y: y - h / 2 }
          : side === 'left' ? { h, w, x: x - offset - w, y: y - h / 2 }
          : side === 'above' ? { h, w, x: x - w / 2, y: y - lift - h }
          : { h, w, x: x - w / 2, y: y + lift }
        if (box.x < 8 || box.x + box.w > width - 8 || box.y < 8 || box.y + box.h > height - 8) continue
        if (blocks.some((block) => !apart(block, box))) continue
        if (placed.some((other) => !apart(grown(other, 6), box))) continue
        if (points.some((point, other) => other !== index && touches(box, point[0]!, point[1]!, (live[other]!.hive.mood === 'live' ? outer[other]! * 0.9 : Math.min(radii[other]! * 0.8, clear)) + 4))) continue
        placed.push(box)
        slot.tag = { dx: box.x - x, dy: box.y - y, element, h, last: '', w }
        element.dataset['side'] = side
        element.dataset['placed'] = 'true'
        element.style.setProperty('--i', String(order++))
        return
      }
      element.dataset['placed'] = 'false'
    })
    elements.forEach((element) => {
      element.dataset['placed'] = 'false'
    })

    const aspect = width / height
    live.forEach((slot, index) => {
      const z = Math.max(-depth / 2, Math.min(depth / 2, ((slot.hive.fresh - 0.5) * 0.75 + (hash(slot.hive.id, 5) - 0.5) * 0.3) * depth))
      const reach = (eye - z) * lens
      const x = points[index]![0]!
      const y = points[index]![1]!
      slot.target = [((x / width) * 2 - 1) * aspect * reach, (1 - (y / height) * 2) * reach, z]
      slot.radius = (radii[index]! / (height / 2)) * reach
      slot.px = radii[index]!
    })
  }

  const project = (point: readonly number[]) => {
    const x = point[0]!
    const y = point[1]!
    const z = point[2]!
    const cx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!
    const cy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!
    const cw = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
    return { w: cw, x: ((cx / cw) * 0.5 + 0.5) * width, y: (1 - ((cy / cw) * 0.5 + 0.5)) * height }
  }

  const pick = () => {
    if (!pointer) return undefined
    let best: string | undefined
    let closest = Infinity
    for (const slot of slots) {
      if (!slot.seen) continue
      const spot = project(slot.at)
      if (spot.w <= 0) continue
      const gap = Math.hypot(spot.x - pointer[0], spot.y - pointer[1])
      if (gap < Math.max(14, slot.px * extent(slot.hive) * 0.85) && gap < closest) {
        closest = gap
        best = slot.hive.id
      }
    }
    return best
  }

  const write = (slot: Slot | undefined) => {
    const label = options.label
    if (!label) return
    if (!slot || slot.focus < 0.05) {
      label.dataset['shown'] = 'false'
      return
    }
    const fill = `${slot.hive.id}\u0001${slot.hive.detail}\u0001${slot.hive.about}\u0001${slot.hive.facts}`
    if (label.dataset['fill'] !== fill) {
      label.dataset['fill'] = fill
      for (const part of ['title', 'detail', 'about', 'facts'] as const) {
        const element = label.querySelector<HTMLElement>(`[data-part='${part}']`)
        if (element) element.textContent = slot.hive[part]
      }
    }
    label.dataset['tagged'] = slot.tag ? 'true' : 'false'
    label.dataset['shown'] = 'true'
    const spot = project(slot.at)
    const wide = label.offsetWidth
    const tall = label.offsetHeight
    if (slot.tag) {
      const tx = spot.x + slot.tag.dx
      const ty = spot.y + slot.tag.dy
      const x = Math.max(12, Math.min(tx, width - 12 - wide))
      const y = ty + slot.tag.h + 6 + tall < height - 12 ? ty + slot.tag.h + 6 : ty - 6 - tall
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(12, y))}px)`
      return
    }
    const offset = slot.px * extent(slot.hive) * 0.8 + 12
    const right = spot.x + offset + wide < width - 12 || spot.x - offset - wide < 12
    const x = right ? Math.min(spot.x + offset, width - 12 - wide) : spot.x - offset - wide
    const y = Math.max(12 + tall / 2, Math.min(height - 12 - tall / 2, spot.y))
    label.style.transform = `translate(${Math.round(Math.max(12, x))}px, ${Math.round(y)}px) translate(0, -50%)`
  }

  const bind = (program: Program, lines: number, size: number) => {
    gl.useProgram(program.program)
    gl.uniformMatrix4fv(program.at.uMatrix, false, matrix)
    gl.uniform1f(program.at.uTime, time)
    gl.uniform1f(program.at.uIntro, intro)
    gl.uniform1f(program.at.uSize, size)
    gl.uniform1f(program.at.uPx, height / 2 / lens)
    gl.uniform1f(program.at.uDim, dim)
    gl.uniform1f(program.at.uLines, lines)
    gl.uniform3fv(program.at.uInk, ink)
    gl.uniform3fv(program.at.uLive, tints.live)
    gl.uniform4fv(program.at.uHive, hives)
    gl.uniform4fv(program.at.uTint, colors)
    gl.uniform4fv(program.at.uState, states)
  }

  const draw = (now: number) => {
    frame = 0
    const step = Math.min(0.05, Math.max(0, (now - last) / 1000))
    last = now
    if (!options.still) {
      time += step
      intro = Math.min(1, intro + step / 2.4)
    }
    const ease = (rate: number) => (options.still ? 1 : Math.min(1, step * rate))
    const rect = options.canvas.getBoundingClientRect()
    if (Math.abs(rect.width - laid[0]) > 1 || Math.abs(rect.height - laid[1]) > 1) layout()
    const pixelsW = Math.round(width * ratio)
    const pixelsH = Math.round(height * ratio)
    if (options.canvas.width !== pixelsW || options.canvas.height !== pixelsH) {
      options.canvas.width = pixelsW
      options.canvas.height = pixelsH
    }
    const active = hovered ?? focused
    for (const slot of slots) {
      slot.focus += ((slot.hive.id === active ? 1 : grouped && slot.hive.mood === grouped ? 0.62 : 0) - slot.focus) * ease(7)
      slot.spark *= options.still ? 0 : Math.exp(-step * 1.1)
      slot.show += ((slot.seen ? 1 : 0) - slot.show) * ease(3)
      for (let axis = 0; axis < 3; axis++) slot.center[axis] = slot.center[axis]! + (slot.target[axis]! - slot.center[axis]!) * ease(2.5)
    }
    dim += ((active || grouped ? 1 : 0) - dim) * ease(6)
    const want: [number, number] = pointer ? [pointer[0] / width - 0.5, pointer[1] / height - 0.5] : [0, 0]
    lean = [lean[0] + (want[0] - lean[0]) * ease(2), lean[1] + (want[1] - lean[1]) * ease(2)]
    const yaw = Math.sin(time * 0.06) * 0.04 + lean[0] * 0.08
    const pitch = Math.sin(time * 0.045) * 0.025 - lean[1] * 0.05
    matrix = multiply(perspective(width / height, 0.1, 100), look([Math.sin(yaw) * Math.cos(pitch) * eye, Math.sin(pitch) * eye, Math.cos(yaw) * Math.cos(pitch) * eye]))

    slots.forEach((slot, index) => {
      const bob = slot.radius * 0.22
      slot.at = [slot.center[0] + Math.sin(time * 0.21 + slot.phase[0]) * bob, slot.center[1] + Math.sin(time * 0.17 + slot.phase[1]) * bob, slot.center[2] + Math.sin(time * 0.13 + slot.phase[2]) * bob]
      const tint = tints[slot.hive.mood]
      hives.set([slot.at[0], slot.at[1], slot.at[2], slot.radius], index * 4)
      colors.set([tint[0], tint[1], tint[2], activity[slot.hive.mood]], index * 4)
      states.set([slot.focus, codes[slot.hive.mood], slot.show, slot.spark], index * 4)
    })

    gl.viewport(0, 0, options.canvas.width, options.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (links) {
      bind(swarm, 3, ratio)
      gl.bindVertexArray(links.vao)
      gl.drawArrays(gl.LINES, 0, links.count)
    }
    if (meshes) {
      bind(swarm, 1, ratio)
      gl.bindVertexArray(meshes.spokes.vao)
      gl.drawArrays(gl.LINES, 0, meshes.spokes.count)
      bind(swarm, 0, ratio)
      gl.bindVertexArray(meshes.points.vao)
      gl.drawArrays(gl.POINTS, 0, meshes.points.count)
      bind(marks, 0, 4 * ratio)
      gl.bindVertexArray(meshes.centers.vao)
      gl.drawArrays(gl.POINTS, 0, meshes.centers.count)
    }
    gl.bindVertexArray(null)
    for (const slot of slots) {
      const tag = slot.tag
      if (!tag) continue
      const spot = project(slot.at)
      const value = `translate3d(${Math.round(spot.x + tag.dx)}px, ${Math.round(spot.y + tag.dy)}px, 0)`
      if (value === tag.last) continue
      tag.element.style.transform = value
      tag.last = value
    }
    write(slots.find((slot) => slot.hive.id === active))
    if (running && !options.still) frame = requestAnimationFrame(draw)
  }

  const kick = () => {
    if (frame) return
    if (!running && !options.still) return
    last = performance.now()
    frame = requestAnimationFrame(draw)
  }

  return {
    focus: (id) => {
      focused = id
      kick()
    },
    group: (mood) => {
      grouped = mood
      kick()
    },
    hives: (list) => {
      const next = list.slice(0, most)
      const known = new Map(slots.map((slot) => [slot.hive.id, slot]))
      const changed = !meshes || next.length !== slots.length || next.some((hive, index) => slots[index]?.hive.id !== hive.id || crowd(slots[index]!.hive) !== crowd(hive))
      slots = next.map((hive) => {
        const before = known.get(hive.id)
        return {
          at: before ? before.at : [0, 0, 0],
          center: before ? before.center : [0, 0, 0],
          focus: before?.focus ?? 0,
          hive,
          phase: [hash(hive.id, 11) * tau, hash(hive.id, 12) * tau, hash(hive.id, 13) * tau],
          px: before?.px ?? 0,
          radius: before?.radius ?? 0,
          seen: before?.seen ?? true,
          show: before?.show ?? 1,
          spark: !before ? 0 : hive.weight > before.hive.weight + 1e-6 ? 1 : hive.updated > before.hive.updated ? Math.max(before.spark, 0.55) : before.spark,
          tag: undefined,
          target: before ? before.target : [0, 0, 0],
        }
      })
      layout()
      for (const slot of slots) {
        if (known.has(slot.hive.id)) continue
        slot.show = slot.seen ? 1 : 0
        slot.center = [slot.target[0], slot.target[1], slot.target[2]]
        slot.at = [slot.target[0], slot.target[1], slot.target[2]]
      }
      if (changed) rebuild()
      kick()
    },
    layout: () => {
      layout()
      kick()
    },
    pointer: (x, y) => {
      if (x === undefined || y === undefined) pointer = undefined
      else {
        const rect = options.canvas.getBoundingClientRect()
        pointer = [x - rect.left, y - rect.top]
      }
      const next = pick()
      if (next !== hovered) {
        hovered = next
        options.onPick?.(next)
      }
      kick()
    },
    run: (value) => {
      running = value
      if (value) kick()
      else if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    },
    stop: () => {
      running = false
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      release()
      drop(links)
      gl.deleteProgram(swarm.program)
      gl.deleteProgram(marks.program)
    },
  }
}
