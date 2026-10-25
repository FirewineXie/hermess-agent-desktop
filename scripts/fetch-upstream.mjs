import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'upstream/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))

if (!/^v\d+\.\d+\.\d+$/.test(lock.tag) ||
    ![lock.baseCommit, lock.commit].every(value => /^[0-9a-f]{40}$/.test(value)) ||
    lock.branch !== 'hermess-desktop') {
  throw new Error('上游锁文件必须包含正式 Release tag、桌面分支及完整提交 SHA')
}
if (!existsSync(upstream)) {
  mkdirSync(resolve(root, 'upstream'), { recursive: true })
  execFileSync('git', ['clone', '--filter=blob:none', '--no-tags', '--single-branch', '--branch', lock.branch,
    lock.repository, upstream], { stdio: 'inherit' })
  execFileSync('git', ['-C', upstream, 'checkout', '--detach', lock.commit], { stdio: 'inherit' })
}
execFileSync(process.execPath, [resolve(root, 'scripts/verify-upstream.mjs')], { stdio: 'inherit' })
