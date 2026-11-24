import type { Account, Config } from './Api.ts'
import type { Hello } from './Hello.ts'
import type { Rail } from './Rail.ts'

export type Face = { account?: Account | undefined; address: `0x${string}`; balance?: string | undefined; email?: string | undefined }

export type Boot = { base: string; config: Config | undefined; data: Record<string, unknown>; face: Face | undefined; hello?: Hello | undefined; mobile: boolean; now: number; rail?: Rail | undefined; site: string; socket: string; url: string; zone: string | undefined }

declare global {
  var __SWARMS_BOOT__: Boot | undefined
  var __swarmsServer: { boot(): Boot | undefined } | undefined
}
