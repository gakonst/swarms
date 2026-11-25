#!/usr/bin/env node
import { version } from './version.ts'

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0)
  throw error
})

const argv = process.argv.slice(2)
if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version')) process.stdout.write(version + '\n')
else process.exitCode = await (await import('./run.ts')).main(argv)
