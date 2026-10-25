import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import test from 'node:test'
import { adapter, patch, upstream, verifyAdapter } from './hermess_upstream_adapter.mjs'

test('产品补丁可应用于锁定的干净上游源码', () => {
  verifyAdapter()
  const staged = mkdtempSync(join(tmpdir(), 'hermess-adapter-check-'))
  try {
    const paths = execFileSync('git', ['-C', upstream, 'diff', '--name-only'], { encoding: 'utf8' })
      .trim().split(/\r?\n/)
    for (const path of paths) {
      const destination = join(staged, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, execFileSync('git', ['-C', upstream, 'show', `HEAD:${path}`]))
    }
    execFileSync('git', ['apply', '--unidiff-zero', patch], { cwd: staged })
    copyFileSync(adapter, join(staged, 'hermes_cli/hermess_private_api.py'))
    for (const path of paths) {
      assert.deepEqual(readFileSync(join(staged, path)), readFileSync(join(upstream, path)))
    }
    assert.deepEqual(readFileSync(join(staged, 'hermes_cli/hermess_private_api.py')), readFileSync(adapter))
  } finally {
    const expectedRoot = resolve(tmpdir()) + sep
    if (!resolve(staged).startsWith(expectedRoot)) throw new Error('临时测试目录超出系统临时目录')
    rmSync(staged, { recursive: true, force: true })
  }
})
