import React from 'react'
import type { CodingRuntimeStatus } from '@hermess/contracts'
import type { Language } from '../../i18n'

export default function ProgrammingRuntimeProgress({ runtime, language }: {
  runtime: CodingRuntimeStatus; language: Language
}) {
  const zh = language === 'zh-CN'
  if (runtime.state !== 'downloading' && runtime.state !== 'installing') return null
  const installing = runtime.state === 'installing'
  const downloaded = Math.max(0, runtime.downloaded)
  const knownTotal = runtime.total > 0
  const percent = knownTotal ? Math.min(100, Math.floor(downloaded / runtime.total * 100)) : null
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  const label = installing
    ? (zh ? '下载完成，正在校验并安装…' : 'Download complete. Verifying and installing…')
    : (zh ? '正在下载运行时' : 'Downloading runtime')

  return <div className="programming-runtime-progress">
    <div className="programming-runtime-progress-heading" role="status">
      <span>{label}</span>
      {!installing && percent !== null && <strong>{percent}%</strong>}
    </div>
    <progress max={installing || !knownTotal ? 100 : runtime.total}
      value={installing || !knownTotal ? undefined : Math.min(downloaded, runtime.total)}
      aria-label={installing ? (zh ? '校验并安装进度' : 'Verification and installation progress') : (zh ? '下载进度' : 'Download progress')} />
    <p>{installing
      ? (zh ? '安装完成后即可使用，请稍候。' : 'Ready to use once installation finishes. Please wait.')
      : knownTotal ? `${size(downloaded)} / ${size(runtime.total)}`
        : downloaded > 0 ? `${zh ? '已下载' : 'Downloaded'} ${size(downloaded)}`
          : (zh ? '正在连接下载源…' : 'Connecting to download source…')}</p>
  </div>
}
