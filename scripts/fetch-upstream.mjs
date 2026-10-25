import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyAdapter } from './hermess_upstream_adapter.mjs'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'upstream/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))

if (!/^v\d+\.\d+\.\d+$/.test(lock.tag) || !/^[0-9a-f]{40}$/.test(lock.commit)) {
  throw new Error('上游锁文件必须包含正式 Release tag 和完整 commit SHA')
}
if (!existsSync(upstream)) {
  mkdirSync(resolve(root, 'upstream'), { recursive: true })
  execFileSync('git', ['clone', '--depth', '1', '--single-branch', '--branch', lock.tag,
    lock.repository, upstream], { stdio: 'inherit' })
}
applyAdapter()
execFileSync(process.execPath, [resolve(root, 'scripts/verify-upstream.mjs')], { stdio: 'inherit' })
