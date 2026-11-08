import React from 'react'
import { isDesktopFailure, type CodingTextFile } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import type { Language } from '../../i18n'
import './programmingSettings.css'
import './programming.css'

export default function ProgrammingConfigFile({ language, onDirtyChange, onBusyChange, onSaved }: {
  language: Language; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void; onSaved: () => void
}) {
  const { coding } = useDesktop()
  const zh = language === 'zh-CN'
  const [file, setFile] = React.useState<CodingTextFile | null>(null)
  const [content, setContent] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [saved, setSaved] = React.useState(false)
  const alive = React.useRef(true), operation = React.useRef(false)
  const dirty = Boolean(file && content !== file.content)
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  React.useEffect(() => {
    alive.current = true
    return () => { alive.current = false; onDirtyChange(false); onBusyChange(false) }
  }, [onDirtyChange, onBusyChange])
  const run = React.useCallback(async (action: () => Promise<CodingTextFile>, saving = false) => {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(null); setSaved(false)
    try {
      const value = await action()
      if (alive.current) {
        setFile(value); setContent(value.content); setSaved(saving)
        if (saving) onSaved()
      }
    } catch (cause) { if (alive.current) setError(cause) }
    finally { operation.current = false; if (alive.current) setBusy(false) }
  }, [onSaved])
  const load = React.useCallback(() => run(() => coding.configFile()), [coding, run])
  React.useEffect(() => { void load() }, [load])
  return <section className="programming-settings" aria-label="config.toml">
    <div className="programming-section-title"><div><h2>config.toml</h2><p>{zh ? '查看和编辑 Hermess 独立的编程配置。所有 Profile 共用，保存后下一轮任务使用新配置。' : 'View and edit the separate Hermess programming configuration. Shared across Profiles; changes apply from the next turn.'}</p></div></div>
    {file && <form onSubmit={event => {
      event.preventDefault()
      if (dirty) void run(() => coding.saveConfigFile(file.revision, content), true)
    }}>
      <div className="programming-settings-fields"><label>config.toml<textarea className="programming-settings-code" spellCheck={false} rows={24} disabled={busy} value={content} maxLength={1048576} onChange={event => { setContent(event.target.value); setSaved(false) }} /></label></div>
      <p>{zh ? '按 TOML 格式编辑；保存保留原文和注释。保存会检查语法，具体配置项是否可用以运行时结果为准。' : 'Edit as TOML. Saving preserves text and comments and checks syntax. Runtime results determine whether individual settings are supported.'}</p>
      <div className="programming-settings-actions"><button type="submit" className="programming-primary" disabled={busy || !dirty}>{zh ? '保存配置文件' : 'Save configuration file'}</button></div>
    </form>}
    {busy && <p role="status">{zh ? '正在处理配置文件…' : 'Working on the configuration file…'}</p>}
    {error != null && <p className="programming-error" role="alert">{isDesktopFailure(error) && error.code === 'conflict'
      ? (zh ? '配置文件已被其他操作修改。当前编辑内容已保留，请复制需要保留的内容后重新读取。' : 'The file changed elsewhere. Your edits are retained. Copy any changes you need before reloading.')
      : isDesktopFailure(error) && error.code === 'invalid_input'
        ? (zh ? '保存失败：请检查 TOML 语法，文件不能包含空字符或超过 1 MiB。当前编辑内容已保留。' : 'Save failed. Check TOML syntax; the file must not contain null characters or exceed 1 MiB. Your edits are retained.')
        : describeError(error, language)}</p>}
    {saved && <p className="programming-saved" role="status">{zh ? '配置文件已保存，下一轮任务使用新配置。' : 'Configuration file saved. The next turn uses the new settings.'}</p>}
    <button type="button" disabled={busy} onClick={() => {
      if (!dirty || window.confirm(zh ? '丢弃未保存修改并重新读取？' : 'Discard unsaved changes and reload?')) void load()
    }}>{zh ? '重新读取' : 'Reload'}</button>
  </section>
}
