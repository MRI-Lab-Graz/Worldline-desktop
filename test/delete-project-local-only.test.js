import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertOnLocalDisk, isNetworkLocation } from '../src/gui/delete-project.js'

const DF_HEADER = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
const df = (line) => async () => `${DF_HEADER}${line}\n`
const NO = /server or network folder|could not tell/i

test('df lines of local disks are not network locations', () => {
  for (const line of ['/dev/disk3s5 488245288 400 1000 1% /System/Volumes/Data', '/dev/nvme0n1p2 1000 1 999 1% /', 'tmpfs 1000 0 1000 0% /tmp', 'overlay 1000 0 1000 0% /']) {
    assert.equal(isNetworkLocation(line), false, line)
  }
})

test('df lines of network shares and mounted servers are network locations', () => {
  for (const line of [
    '//karl@server.uni.at/MRI Lab 1000 1 999 1% /Volumes/MRI Lab',
    '//server/share 1000 1 999 1% /mnt/share',
    'fileserver:/export/data 1000 1 999 1% /mnt/data',
    'karl@143.50.35.16:/datalad 1000 1 999 1% /Users/karl/mnt'
  ]) {
    assert.equal(isNetworkLocation(line), true, line)
  }
})

test('on macOS and Linux a project on a local disk may be deleted, one on a network or server folder may not', async () => {
  await assert.doesNotReject(assertOnLocalDisk('/x/p', { platform: 'darwin', run: df('/dev/disk3s5 1 1 1 1% /') }))
  await assert.rejects(assertOnLocalDisk('/Volumes/lab/p', { platform: 'darwin', run: df('//karl@server/lab 1 1 1 1% /Volumes/lab') }), NO)
  await assert.rejects(assertOnLocalDisk('/mnt/p', { platform: 'linux', run: df('server:/export 1 1 1 1% /mnt') }), NO)
})

test('fail closed: if the disk cannot be looked at, nothing is deleted', async () => {
  await assert.rejects(assertOnLocalDisk('/x/p', { platform: 'linux', run: async () => { throw new Error('df missing') } }), /could not tell/i)
  await assert.rejects(assertOnLocalDisk('/x/p', { platform: 'linux', run: async () => '' }), /could not tell/i)
})

test('on Windows a UNC path or a mapped network drive (which resolves to UNC) may not be deleted; a local drive may', async () => {
  const win = (resolved) => ({ platform: 'win32', realNative: () => resolved })
  await assert.doesNotReject(assertOnLocalDisk('C:\\Users\\Ana\\p', win('C:\\Users\\Ana\\p')))
  await assert.rejects(assertOnLocalDisk('\\\\server\\share\\p', win('\\\\server\\share\\p')), NO)
  await assert.rejects(assertOnLocalDisk('Z:\\p', win('\\\\server\\share\\p')), NO) // mapped drive letter
  await assert.rejects(assertOnLocalDisk('Z:\\p', win('\\\\?\\UNC\\server\\share\\p')), NO)
  await assert.rejects(assertOnLocalDisk('C:\\p', { platform: 'win32', realNative: () => { throw new Error('gone') } }), /could not tell/i)
})

test('a real temp folder on this computer passes the real check', { skip: process.platform === 'win32' }, async () => {
  await assert.doesNotReject(assertOnLocalDisk(await mkdtemp(join(tmpdir(), 'localdisk-'))))
})

test('both the preview and the delete handler check the disk before anything else is offered or removed', () => {
  const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
  for (const channel of ['adapter:getDeletionPreview', 'adapter:deleteProject']) {
    const start = main.indexOf(`handle('${channel}'`)
    const body = main.slice(start, main.indexOf('\n})\n', start))
    assert.match(body, /await assertOnLocalDisk\(target\)/, channel)
  }
})

test('the dialog explains a network or server folder, and keeps the generic note for any other refusal', async () => {
  const { deleteRefusedNote } = await import('../src/gui/renderer/delete-project-view.js')
  const wrapped = "Error invoking remote method 'adapter:getDeletionPreview': Error: This project is in a server or network folder, so it cannot be deleted from here. Nothing was changed."
  assert.equal(deleteRefusedNote(wrapped), 'This project is in a server or network folder, so it cannot be deleted from here. Nothing was changed.')
  assert.match(deleteRefusedNote("Error: Could not tell whether this project is on this computer or on a server, so it cannot be deleted from here. Nothing was changed."), /^Could not tell whether/)
  for (const other of ['EPERM: whatever', undefined, null, '']) assert.equal(deleteRefusedNote(other), 'This project cannot be deleted from here. Nothing was changed.')
})
