// The history is read from a repository that may ask git to verify signatures with a program of its own choosing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

test('looking for removed folders never lets git check signatures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-removed-args-'))
  await mkdir(join(dir, '.git'))
  const seen = []
  const runner = { run: async (command, args) => (seen.push(args), { failed: false, exitCode: 0, stdout: '', stderr: '', args, command }) }

  await new DataLadAdapter({ runner }).runCommand('run', { projectPath: dir, message: 'm', command: 'git --version' })

  assert.ok(seen.find((args) => args.includes('log'))?.includes('--no-show-signature'))
})
