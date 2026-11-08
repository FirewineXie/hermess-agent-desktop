import assert from 'node:assert/strict'
import test from 'node:test'
import { programmingAttachmentName, programmingAttachmentText, readProgrammingImages, splitProgrammingPaths } from '../src/features/programming/programmingAttachments.ts'

test('mixed Windows/macOS paths retain spaces, Unicode and quoting; image paths are deduplicated', () => {
  const paths = ['C:\\项目 空格\\截图.PNG', '/Users/test/my file.ts', '\\\\server\\share\\文件.pdf', 'C:\\项目 空格\\截图.PNG']
  const result = splitProgrammingPaths(paths)
  assert.deepEqual(result.images, [paths[0]])
  assert.deepEqual(result.files, paths.slice(1, 3))
  const text = programmingAttachmentText('请检查这些文件', result.files)
  assert.equal(text, `请检查这些文件\n@${JSON.stringify(paths[1])}\n@${JSON.stringify(paths[2])}`)
  assert.equal(programmingAttachmentText('', [paths[1]]), `@${JSON.stringify(paths[1])}`)
  assert.equal(programmingAttachmentName('data:image/png;base64,AAAA', 0, true), '粘贴图片 1')
  assert.equal(programmingAttachmentName(paths[0], 0, true), '截图.PNG')
})

test('pasted images are read atomically; count, MIME, total size and failed reads are rejected', async () => {
  let reads = 0
  globalThis.FileReader = class {
    readAsDataURL(file) {
      reads++
      if (file.name === 'broken.png') { this.error = new Error('READ_FAILED'); this.onerror(); return }
      this.result = `data:${file.type};base64,AAAA`
      this.onload()
    }
  }
  try {
    const png = new File(['abc'], 'clipboard.png', { type: 'image/png' })
    assert.deepEqual(await readProgrammingImages([png], [], true), ['data:image/png;base64,AAAA'])
    const previousReads = reads
    await assert.rejects(readProgrammingImages([png], ['a', 'b', 'c', 'd'], true), /四张/)
    await assert.rejects(readProgrammingImages([new File(['x'], 'x.svg', { type: 'image/svg+xml' })], [], true), /PNG/)
    await assert.rejects(readProgrammingImages([{ size: 20 * 1024 * 1024, type: 'image/png' }], ['data:image/png;base64,AAAA'], true), /20 MiB/)
    assert.equal(reads, previousReads)
    await assert.rejects(readProgrammingImages([new File(['x'], 'broken.png', { type: 'image/png' })], [], true), /READ_FAILED/)
  } finally { delete globalThis.FileReader }
})
