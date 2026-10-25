import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyAdapter } from './hermess_upstream_adapter.mjs'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'upstream/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))
const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim()

if (!/^v\d+\.\d+\.\d+$/.test(lock.tag) || !/^[0-9a-f]{40}$/.test(lock.commit)) {
  throw new Error('上游锁文件必须包含正式 Release tag 和完整 commit SHA')
}
const tracked = execFileSync('git', ['-C', root, 'ls-files', '--stage', '--', 'upstream/hermes-agent'], { encoding: 'utf8' }).trim()
if (tracked) throw new Error('上游目录仍被产品仓库跟踪；请移除 Git submodule/gitlink')
const actual = git('rev-parse', 'HEAD')
if (actual !== lock.commit) throw new Error(`上游提交不匹配：${actual}，预期 ${lock.commit}`)
const tagged = git('rev-parse', `${lock.tag}^{commit}`)
if (tagged !== lock.commit) throw new Error(`上游 tag ${lock.tag} 未指向锁定提交`)
const origin = git('remote', 'get-url', 'origin')
if (origin !== lock.repository) throw new Error(`上游来源不匹配：${origin}`)
verifyAdapter()
console.log(`上游 Release ${lock.tag} 与提交 ${actual} 一致，产品适配补丁匹配`)
