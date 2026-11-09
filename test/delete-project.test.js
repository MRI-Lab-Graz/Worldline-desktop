import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, realpath, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { assertDeletableProject, deleteProjectFolder, folderSize, projectNameMatches } from '../src/gui/delete-project.js'

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'delproj-')))
  const home = join(base, 'home')
  const project = join(home, 'Documents', 'sleep')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(project, 'data.txt'), 'x')
  return { base, home, project }
}

async function exists(path) {
  return stat(path).then(() => true, () => false)
}

test('projectNameMatches needs the exact name: same case, no extra spaces, never empty', () => {
  assert.equal(projectNameMatches('Sleep study', 'Sleep study'), true)
  assert.equal(projectNameMatches('sleep study', 'Sleep study'), false)
  assert.equal(projectNameMatches('Sleep study ', 'Sleep study'), false)
  assert.equal(projectNameMatches('', ''), false)
  assert.equal(projectNameMatches(undefined, 'Sleep study'), false)
  assert.equal(projectNameMatches('Sleep study', undefined), false)
})

test('an opened project folder can be deleted', async () => {
  const { home, project } = await fixture()
  assert.doesNotThrow(() => assertDeletableProject(project, { roots: [project], home }))
})

test('a folder that is not exactly an opened project is refused (subfolder, parent, unknown)', async () => {
  const { home, project } = await fixture()
  await mkdir(join(project, 'sub', '.git'), { recursive: true })
  assert.throws(() => assertDeletableProject(join(project, 'sub'), { roots: [project], home }), /not an opened project/)
  assert.throws(() => assertDeletableProject(dirname(project), { roots: [project], home }), /not an opened project/)
  assert.throws(() => assertDeletableProject(project, { roots: [], home }), /not an opened project/)
})

test('the filesystem root, the home folder and a folder above home are refused even when opened', async () => {
  const { base, home } = await fixture()
  await mkdir(join(home, '.git'))
  await mkdir(join(base, '.git'))
  for (const path of [home, base, dirname(base)]) {
    assert.throws(() => assertDeletableProject(path, { roots: [path], home }), /too much|not an opened project|cannot be deleted/, path)
  }
  assert.throws(() => assertDeletableProject('/', { roots: ['/'], home }), /cannot be deleted/)
})

test('a folder without a .git is not a project and is refused', async () => {
  const { home } = await fixture()
  const plain = join(home, 'Documents', 'photos')
  await mkdir(plain, { recursive: true })
  assert.throws(() => assertDeletableProject(plain, { roots: [plain], home }), /not a project/)
})

test('a symlink to a project is refused, so the link cannot stand in for the real folder', async () => {
  const { home, project } = await fixture()
  const link = join(home, 'link')
  await symlink(project, link, 'dir')
  assert.throws(() => assertDeletableProject(link, { roots: [link], home }), /link/)
})

test('deleteProjectFolder removes the whole folder, read-only git-annex objects included', async () => {
  const { home, project } = await fixture()
  const objects = join(project, '.git', 'annex', 'objects', 'aa', 'bb', 'SHA256E-s1--abc')
  await mkdir(objects, { recursive: true })
  await writeFile(join(objects, 'SHA256E-s1--abc'), 'x')
  await chmod(join(objects, 'SHA256E-s1--abc'), 0o444)
  for (const dir of [objects, dirname(objects), dirname(dirname(objects))]) {
    await chmod(dir, 0o555)
  }
  await deleteProjectFolder(project, { roots: [project], home })
  assert.equal(await exists(project), false)
})

test('deleteProjectFolder never follows a symlink out of the project', async () => {
  const { base, home, project } = await fixture()
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'precious.txt'), 'keep me')
  await symlink(outside, join(project, 'escape'), 'dir')
  await deleteProjectFolder(project, { roots: [project], home })
  assert.equal(await exists(project), false)
  assert.equal(await exists(join(outside, 'precious.txt')), true)
})

test('deleteProjectFolder checks first: a refused folder is left untouched', async () => {
  const { home, project } = await fixture()
  await assert.rejects(deleteProjectFolder(project, { roots: [], home }), /not an opened project/)
  assert.equal(await exists(join(project, 'data.txt')), true)
})

test('folderSize counts files and bytes under the folder and does not follow links out of it', async () => {
  const { base, home, project } = await fixture()
  await mkdir(join(project, 'sub'))
  await writeFile(join(project, 'sub', 'b.txt'), 'hello') // data.txt is 1 byte, b.txt 5
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'huge.bin'), 'x'.repeat(1000))
  await symlink(outside, join(project, 'escape'), 'dir')
  assert.deepEqual(await folderSize(project), { files: 2, bytes: 6 })
})
