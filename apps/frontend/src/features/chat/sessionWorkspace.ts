import type { ResumeResult } from '@hermess/contracts'

export function selectedWorkspacePath(info?: ResumeResult['info']): string {
  return info?.launch_request?.cwd_explicit === true ? info.cwd || info.launch_request.cwd || '' : ''
}
