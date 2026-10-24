import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const vendor = resolve(root, 'vendor/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))

if (!/^v\d+\.\d+\.\d+$/.test(lock.tag) || !/^[0-9a-f]{40}$/.test(lock.commit)) {
  throw new Error('上游锁文件必须包含正式 Release tag 和完整 commit SHA')
}
if (!existsSync(vendor)) {
  mkdirSync(resolve(root, 'vendor'), { recursive: true })
  execFileSync('git', ['clone', '--depth', '1', '--single-branch', '--branch', lock.tag,
    lock.repository, vendor], { stdio: 'inherit' })
}
execFileSync(process.execPath, [resolve(root, 'scripts/verify-upstream.mjs')], { stdio: 'inherit' })
