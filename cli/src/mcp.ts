import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export type Options = { token?: string | undefined; url: string }

export const fallback = 'https://swarms.new'

const longest = 330_000

function refused(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const signIn = code === 401 || code === 403 || /needs the swarms:\w+ scope|invalid_token/.test(detail)
  return { content: [{ text: signIn ? `${detail}\nSign in with the swarms CLI first, or set SWARMS_TOKEN, so this tool runs as you.` : detail, type: 'text' as const }], isError: true }
}

export async function serve(options: Options, local: Transport = new StdioServerTransport()) {
  const remote = new Client({ name: 'swarms-cli', version: '1.0.0' })
  const headers: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {}
  await remote.connect(new StreamableHTTPClientTransport(new URL(`${options.url.replace(/\/+$/, '')}/mcp`), { requestInit: { headers } }))
  const instructions = remote.getInstructions()
  const server = new Server({ name: 'swarms', version: remote.getServerVersion()?.version ?? '1.0.0' }, { capabilities: { resources: {}, tools: {} }, ...(instructions ? { instructions } : {}) })
  server.setRequestHandler(ListToolsRequestSchema, (request, extra) => remote.listTools(request.params, { signal: extra.signal }))
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => remote.callTool(request.params, undefined, { signal: extra.signal, timeout: longest }).catch(refused))
  server.setRequestHandler(ListResourcesRequestSchema, (request, extra) => remote.listResources(request.params, { signal: extra.signal }))
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) => remote.listResourceTemplates(request.params, { signal: extra.signal }))
  server.setRequestHandler(ReadResourceRequestSchema, (request, extra) => remote.readResource(request.params, { signal: extra.signal }))
  await server.connect(local)
  return {
    close: async () => {
      await server.close()
      await remote.close()
    },
  }
}

export async function main(options: Options = { token: process.env['SWARMS_TOKEN'], url: process.env['SWARMS_URL'] ?? fallback }) {
  const served = await serve(options)
  const stop = () => void served.close().finally(() => process.exit(0))
  process.stdin.once('end', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

if (import.meta.main) await main()
