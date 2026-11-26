import { WorkerEntrypoint } from 'cloudflare:workers'
import { names, type Secrets } from './Filled.ts'

// The secrets the site Worker needs, kept only on this Worker. A named
// entrypoint is reachable only through a service binding that names it, so
// nothing outside this account's bound Workers can call it.
export class Vault extends WorkerEntrypoint<Cloudflare.Env> {
  secrets(): Secrets {
    const env = this.env as unknown as Record<string, unknown>
    const out: Secrets = {}
    for (const name of names) if (typeof env[name] === 'string') out[name] = env[name] as string
    return out
  }
}
