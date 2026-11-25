import { DurableObject } from 'cloudflare:workers'
import * as Host from '../../src/worker/Host.ts'

const scope = 'swarm:workerd'

export class Boards extends DurableObject {
  async fetch(request: Request) {
    const step = new URL(request.url).pathname
    try {
      const board = await Host.open(this.ctx.storage, scope, scope)
      try {
        const opened = await board.opened()
        if (step === '/write') {
          const posted = await board.post({ id: 't1', spec: 'a task posted in workerd' })
          const claimed = await board.claim('t1', { leaseMs: 600_000 })
          const replied = await board.reply('t1', 'a reply from workerd')
          await board.refresh()
          return Response.json({ claimed, opened, posted, replied, task: await board.task('t1') })
        }
        return Response.json({ opened, task: await board.task('t1'), tasks: (await board.tasks()).map((task) => task.id) })
      } finally {
        await board.close()
      }
    } catch (error) {
      return Response.json({ error: String((error as Error)?.stack ?? error) }, { status: 500 })
    }
  }
}

export default {
  fetch(request: Request, env: { BOARDS: DurableObjectNamespace }) {
    return env.BOARDS.get(env.BOARDS.idFromName('one')).fetch(request)
  },
}
