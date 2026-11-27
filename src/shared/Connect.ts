export const release = 'https://github.com/nanocodexyz/nanocode-ts/releases/download/build-9bf3261/nanocode-ts-9bf3261.tgz'

export const install = `npm install ${release}`

export function cli(input: { token: string; url: string }) {
  return `nc hand '${input.url}' --token ${input.token}`
}

export function library(input: { name: string; token: string; url: string }) {
  return [
    "import { readFileSync } from 'node:fs'",
    "import { createRequire } from 'node:module'",
    "import { Hand } from 'nanocode-ts'",
    "import { Bash, MemoryFileSystem } from 'nanocode-ts/bash'",
    '',
    "const wasm = await WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve('nanocode-ts/nanocode_wasm.wasm')))",
    "const shell = await Bash.create({ fs: MemoryFileSystem.create(), cwd: '/workspace' })",
    'const hand = await Hand.connect(wasm, {',
    `  url: '${input.url}',`,
    `  token: '${input.token}',`,
    `  name: '${input.name}',`,
    '  workspace: shell.workspace(),',
    '  cwd: shell.cwd,',
    '})',
    'console.log(await hand.closed)',
  ].join('\n')
}
