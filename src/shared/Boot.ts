import type { Account, Config } from './Api.ts'

export type Face = { account?: Account | undefined; address: `0x${string}`; balance?: string | undefined }

export type Boot = { config: Config | undefined; data: Record<string, unknown>; face: Face | undefined; mobile: boolean; now: number; site: string; url: string; zone: string | undefined }

declare global {
  var __SWARMS_BOOT__: Boot | undefined
  var __swarmsServer: { boot(): Boot | undefined } | undefined
}
