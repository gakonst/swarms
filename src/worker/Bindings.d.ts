declare namespace Cloudflare {
  interface Env {
    OBJECTS: Fetcher
    SITE: Fetcher
    VAULT?: { secrets(): Promise<import('./Filled.ts').Secrets> }
  }
}
