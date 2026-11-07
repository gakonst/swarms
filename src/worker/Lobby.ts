import { DurableObject } from 'cloudflare:workers'
import * as Answer from '../shared/Answer.ts'
import type { Lobby as Message, Summary } from '../shared/Api.ts'
import * as Problem from './Problem.ts'

const socketsMost = 10_000

const quietMs = 30_000

function listed(summary: Summary): Summary {
  return summary.answer ? { ...summary, answer: { ...summary.answer, text: Answer.lead(summary.answer.text) } } : summary
}

function gist(summary: Summary) {
  return JSON.stringify([summary.status, summary.why, summary.title, summary.goal, summary.problem, summary.steering, summary.answer?.at ?? null, summary.answer?.done ?? null])
}

export class Lobby extends DurableObject<Cloudflare.Env> {
  sent = new Map<string, { at: number; gist: string; json: string }>()

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  override async fetch(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Open the lobby as a WebSocket.', { status: 426 })
    if (this.ctx.getWebSockets().length >= socketsMost) return new Response('The lobby is full right now; read the list over HTTP.', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.send(JSON.stringify({ type: 'welcome' } satisfies Message))
    return new Response(null, { status: 101, webSocket: client })
  }

  async changed(summary: Summary) {
    if (Number(summary.raised) <= 0 || !this.ctx.getWebSockets().length) return
    const swarm = listed(summary)
    const json = JSON.stringify(swarm)
    const last = this.sent.get(swarm.id)
    if (last?.json === json) return
    const now = Date.now()
    if (last && last.gist === gist(swarm) && now - last.at < quietMs) {
      this.ctx.storage.kv.put(`held:${swarm.id}`, swarm)
      const alarm = await this.ctx.storage.getAlarm()
      if (alarm === null || alarm > last.at + quietMs) await this.ctx.storage.setAlarm(last.at + quietMs)
      return
    }
    this.send(swarm, json, now)
  }

  send(swarm: Summary, json: string, now: number) {
    this.ctx.storage.kv.delete(`held:${swarm.id}`)
    this.sent.set(swarm.id, { at: now, gist: gist(swarm), json })
    const data = JSON.stringify({ swarm, type: 'swarm' } satisfies Message)
    for (const socket of this.ctx.getWebSockets())
      try {
        socket.send(data)
      } catch {}
  }

  override async alarm() {
    const now = Date.now()
    const listening = this.ctx.getWebSockets().length > 0
    let next: number | undefined
    for (const [key, swarm] of [...this.ctx.storage.kv.list<Summary>({ prefix: 'held:' })]) {
      const due = (this.sent.get(swarm.id)?.at ?? 0) + quietMs
      if (!listening) this.ctx.storage.kv.delete(key)
      else if (due <= now) this.send(swarm, JSON.stringify(swarm), now)
      else next = Math.min(next ?? due, due)
    }
    if (next !== undefined) await this.ctx.storage.setAlarm(next)
  }

  override async webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Closed')
    } catch {}
  }
}

export function enter(env: Cloudflare.Env, request: Request) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Problem.json({ code: 'invalid_request', detail: 'Open this route as a WebSocket.', status: 400 })
  return env.LOBBY.getByName('lobby').fetch(request)
}

export function tell(env: Cloudflare.Env, summary: Summary) {
  return env.LOBBY.getByName('lobby').changed(summary).catch(() => undefined)
}
