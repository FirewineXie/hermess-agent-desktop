import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, 'upstream/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))
const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim()

if (!/^v\d+\.\d+\.\d+$/.test(lock.tag) ||
    ![lock.baseCommit, lock.commit].every(value => /^[0-9a-f]{40}$/.test(value)) ||
    lock.branch !== 'hermess-desktop') {
  throw new Error('上游锁文件必须包含正式 Release tag、桌面分支及完整提交 SHA')
}
const tracked = execFileSync('git', ['-C', root, 'ls-files', '--stage', '--', 'upstream/hermes-agent'], { encoding: 'utf8' }).trim()
if (tracked) throw new Error('上游目录仍被产品仓库跟踪；请移除 Git submodule/gitlink')
const actual = git('rev-parse', 'HEAD')
if (actual !== lock.commit) throw new Error(`上游提交不匹配：${actual}，预期 ${lock.commit}`)
const origin = git('remote', 'get-url', 'origin')
if (origin !== lock.repository) throw new Error(`上游来源不匹配：${origin}`)
if (git('status', '--porcelain', '--untracked-files=all')) {
  throw new Error('上游工作树有未提交改动')
}
const branch = `origin/${lock.branch}`
const ancestor = (older, newer) => spawnSync('git', ['-C', upstream, 'merge-base', '--is-ancestor', older, newer]).status === 0
if (!ancestor(lock.baseCommit, lock.commit) || !ancestor(lock.commit, branch)) {
  throw new Error('锁定提交不在官方基线之后的桌面维护分支历史中')
}
const tagRef = `refs/tags/${lock.tag}`
const refs = execFileSync('git', ['ls-remote', '--tags', lock.officialRepository,
  tagRef, `${tagRef}^{}`], { encoding: 'utf8' }).trim().split(/\r?\n/)
const tags = new Map(refs.filter(Boolean).map(line => {
  const [sha, ref] = line.split(/\s+/)
  return [ref, sha]
}))
const tagged = tags.get(`${tagRef}^{}`) ?? tags.get(tagRef)
if (tagged !== lock.baseCommit) throw new Error(`官方 tag ${lock.tag} 与锁定基线提交不一致`)
if (git('ls-files', '--error-unmatch', 'hermes_cli/hermess_private_api.py') !==
    'hermes_cli/hermess_private_api.py') throw new Error('桌面私有 API 未纳入 fork 提交')
console.log(`官方 ${lock.tag} 基线 ${lock.baseCommit}，fork 桌面提交 ${actual} 校验通过`)
