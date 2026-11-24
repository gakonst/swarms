import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type Shot = { console: string[]; errors: string[]; file: string; overflow: number; url: string; viewport: string }

export const viewports = {
  desktop: { height: 900, mobile: false, scale: 1, width: 1440 },
  phone: { height: 844, mobile: true, scale: 3, width: 390 },
} as const

export function binary() {
  if (process.env['CHROME']) return process.env['CHROME']
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright')
  const found = fs.existsSync(cache)
    ? fs
        .readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(cache, name, 'chrome-linux64', 'chrome'))
        .find((file) => fs.existsSync(file))
    : undefined
  return found ?? ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((file) => fs.existsSync(file))
}

type Pending = { reject: (error: Error) => void; resolve: (value: Record<string, unknown>) => void }

export async function open() {
  const file = binary()
  if (!file) throw new Error('no Chrome found; set CHROME')
  const profile = fs.mkdtempSync(path.join(process.env['E2E_STATE'] ?? os.tmpdir(), 'swarms-chrome-'))
  const chrome = child.spawn(file, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const pids = process.env['E2E_PIDS']
  if (pids && chrome.pid) fs.writeFileSync(path.join(pids, String(chrome.pid)), 'chrome\n')
  const endpoint = await new Promise<string>((resolve, reject) => {
    let text = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not start: ' + text)), 20_000)
    chrome.stderr.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(text)
      if (found?.[1]) {
        clearTimeout(timer)
        resolve(found[1])
      }
    })
  })
  const port = new URL(endpoint).port
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome has no page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('could not reach Chrome')))
  })
  const pending = new Map<number, Pending>()
  const listeners: ((method: string, params: Record<string, unknown>) => void)[] = []
  let next = 1
  socket.addEventListener('message', (message: MessageEvent) => {
    const data = JSON.parse(String(message.data)) as { error?: { message: string }; id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> }
    if (data.id !== undefined) {
      const waiting = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) waiting?.reject(new Error(data.error.message))
      else waiting?.resolve(data.result ?? {})
    } else if (data.method) for (const listener of listeners) listener(data.method, data.params ?? {})
  })
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = next++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Chrome did not answer ${method} within 60 s`))
      }, 60_000)
      pending.set(id, { reject: (error) => (clearTimeout(timer), reject(error)), resolve: (value) => (clearTimeout(timer), resolve(value)) })
      socket.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  const shoot = async (url: string, viewport: keyof typeof viewports, file: string): Promise<Shot> => {
    const size = viewports[viewport]
    const errors: string[] = []
    const logged: string[] = []
    const listener = (method: string, params: Record<string, unknown>) => {
      if (method === 'Runtime.exceptionThrown') errors.push(JSON.stringify((params['exceptionDetails'] as { exception?: { description?: string }; text?: string })?.exception?.description ?? params['exceptionDetails']))
      if (method === 'Runtime.consoleAPICalled' && params['type'] === 'error') logged.push(JSON.stringify(params['args']).slice(0, 500))
      if (method === 'Log.entryAdded') {
        const entry = params['entry'] as { level?: string; text?: string; url?: string }
        if (entry.level === 'error') logged.push(`${entry.text ?? ''} ${entry.url ?? ''}`)
      }
    }
    listeners.push(listener)
    await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: size.scale, height: size.height, mobile: size.mobile, width: size.width })
    await send('Emulation.setTouchEmulationEnabled', size.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
    await send('Page.navigate', { url })
    const until = Date.now() + 20_000
    for (;;) {
      const ready = (await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })) as { result?: { value?: string } }
      if (ready.result?.value === 'complete' || Date.now() > until) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const measured = (await send('Runtime.evaluate', { expression: 'Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth', returnByValue: true })) as { result?: { value?: number } }
    const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    listeners.splice(listeners.indexOf(listener), 1)
    return { console: logged, errors, file, overflow: measured.result?.value ?? 0, url, viewport }
  }

  const close = async () => {
    socket.close()
    chrome.kill('SIGKILL')
    if (pids && chrome.pid) fs.rmSync(path.join(pids, String(chrome.pid)), { force: true })
    await new Promise((resolve) => setTimeout(resolve, 200))
    fs.rmSync(profile, { force: true, recursive: true })
  }

  const on = (method: string, listener: (params: never) => void) => {
    listeners.push((heard, params) => heard === method && listener(params as never))
  }

  return { close, on, send, shoot }
}
