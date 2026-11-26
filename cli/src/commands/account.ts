import * as Limits from '../../../src/shared/Limits.ts'
import { type Context, browse, Failure, sleep } from '../context.ts'

type Account = { address: string; handle: string; name: string | null }

type Started = { device_code: string; expires_in: number; interval: number; user_code: string; verification_uri: string; verification_uri_complete: string }

type Polled = { status: 'pending' } | { address: string; status: 'approved'; token: string }

export async function login(ctx: Context) {
  const Auth = await import('../auth.ts')
  let token = ctx.flag('token')
  if (ctx.flags['token'] === true) throw new Failure('--token needs a value.', { code: 'usage', exit: 2, next: 'Pass --token <token>, or leave it out to sign in in the browser.' })
  if (!token) {
    const started = await ctx.api<Started>('POST', '/v1/auth/device', {}, { token: '' })
    const opened = await browse(ctx, started.verification_uri_complete)
    ctx.say(`${opened ? 'Opened' : 'Open'} ${started.verification_uri_complete}\nCode: ${started.user_code}\nWaiting for you to sign in with Tempo ID…`)
    const until = Date.now() + started.expires_in * 1000
    const every = Math.max(Limits.Cli.pollFloorMs, Number(process.env['SWARMS_POLL_MS'] ?? started.interval * 1000))
    let polled: Polled | undefined
    while (polled?.status !== 'approved') {
      if (polled && Date.now() > until) throw new Failure('The sign-in code expired before it was approved.', { code: 'expired', next: 'Run swarms login again.' })
      await sleep(every)
      polled = await ctx.api<Polled>('POST', '/v1/auth/device/token', { device_code: started.device_code }, { token: '' }).catch((error: unknown) => {
        if (error instanceof Failure && error.status === 410) throw new Failure('The sign-in code expired.', { code: 'expired', next: 'Run swarms login again.', status: 410 })
        throw error
      })
    }
    token = polled.token
  }
  const me = await ctx.api<Account>('GET', '/v1/me', undefined, { token }).catch((error: unknown) => {
    if (error instanceof Failure && error.status === 401) throw new Failure('That token is not a live session.', { code: 'unauthorized', next: 'Run swarms login without --token to sign in in the browser.', status: 401 })
    throw error
  })
  const stored = await Auth.save(ctx.host, { address: me.address, token })
  ctx.out({ ...me, host: ctx.host, stored }, `Signed in to ${ctx.host} as ${me.handle}${stored === 'file' ? ` (token in ${Auth.file()})` : ''}.`)
}

export async function whoami(ctx: Context) {
  await ctx.signed()
  const me = await ctx.api<Account>('GET', '/v1/me')
  ctx.out({ ...me, host: ctx.host }, `${me.handle} (${me.address}) on ${ctx.host}`)
}

export async function logout(ctx: Context) {
  const Auth = await import('../auth.ts')
  const saved = await Auth.load(ctx.host)
  if (!saved) return ctx.out({ ended: false, host: ctx.host, removed: false }, `Not signed in to ${ctx.host}.`)
  const ended = await ctx.api<{ ended: boolean }>('POST', '/v1/auth/logout', {}, { token: saved.token }).then((done) => done.ended, () => false)
  const removed = saved.where === 'env' ? false : await Auth.remove(ctx.host)
  ctx.out({ ended, host: ctx.host, removed }, saved.where === 'env' ? `Ended the SWARMS_TOKEN session on ${ctx.host}; unset SWARMS_TOKEN too.` : `Signed out of ${ctx.host}.`)
}
