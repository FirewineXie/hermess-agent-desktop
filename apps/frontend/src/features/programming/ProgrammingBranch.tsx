import React from 'react'
import type { CodingGitState } from '@hermess/contracts'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import ProgrammingPicker from './ProgrammingPicker'

export default function ProgrammingBranch({ controller, directory, language }: {
  controller: ProgrammingController; directory: string; language: Language
}) {
  const zh = language === 'zh-CN'
  const [git, setGit] = React.useState<CodingGitState | null>(null)
  const [error, setError] = React.useState('')
  const [switching, setSwitching] = React.useState(false)
  const pending = React.useRef(false)
  const generation = React.useRef(0)
  const refresh = React.useCallback(() => {
    if (pending.current) return
    const request = ++generation.current
    void controller.coding.branch(directory).then(value => {
      if (request === generation.current) { setGit(value); setError('') }
    }).catch(() => {
      if (request === generation.current) setError(zh ? '分支读取失败，点击重试' : 'Could not read branches. Click to retry')
    })
  }, [controller.coding, directory, zh])
  React.useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => { ++generation.current; window.removeEventListener('focus', refresh) }
  }, [refresh, controller.session?.id, controller.session?.status])
  const icon = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M18 7c0 6-12 2-12 8" /></svg>
  const text = switching ? (zh ? '切换分支…' : 'Switching branch…') : !git ? (zh ? '读取分支…' : 'Reading branches…')
    : git.state === 'not_repository' ? (zh ? '未初始化 Git' : 'Not a Git repository')
      : git.state === 'unavailable' ? (zh ? '未找到 Git' : 'Git not found')
        : git.detached ? `HEAD · ${git.branch}` : git.branch || (zh ? '无分支' : 'No branch')
  const options = git?.branches.map(branch => ({ value: branch, label: branch })) || []
  const message = controller.session?.status === 'running' ? (zh ? '任务运行期间不能切换分支。' : 'Branches cannot be switched while a task is running.')
    : git?.state === 'repository' && !options.length ? (zh ? '仓库尚无提交，没有可切换的本地分支。' : 'This repository has no commits or local branches to switch to.') : undefined
  return <div className="programming-branch">
    {error && !git ? <button type="button" className="programming-branch-retry" onClick={refresh}>{icon}{error}</button>
      : <ProgrammingPicker label={zh ? '切换 Git 分支' : 'Switch Git branch'} icon={icon} value={git?.detached ? '' : git?.branch || ''} text={text}
        disabled={!git || git.state !== 'repository' || switching || controller.busy} options={options.map(option => ({ ...option, disabled: controller.session?.status === 'running' }))} message={message}
        onChange={branch => {
          if (pending.current || controller.busy || controller.session?.status === 'running' || !git?.detached && branch === git?.branch) return
          pending.current = true; setSwitching(true); setError('')
          const request = ++generation.current
          void controller.run(async () => {
            const next = await controller.coding.switchBranch(directory, branch)
            if (request !== generation.current) return
            setGit(next)
            if (next.switch_error) setError(zh ? 'Git 拒绝切换。请检查未提交改动、分支占用或仓库锁定后重试。' : 'Git rejected the switch. Check local changes, another worktree or repository locks before retrying.')
          }).finally(() => {
            pending.current = false
            if (request === generation.current) setSwitching(false)
          })
        }} />}
    {error && git && <span className="programming-branch-error" role="alert">{error}</span>}
  </div>
}
