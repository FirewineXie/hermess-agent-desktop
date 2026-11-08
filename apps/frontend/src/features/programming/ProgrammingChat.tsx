import React from 'react'
import MarkdownMessage from '../chat/components/MarkdownMessage'
import type { Language } from '../../i18n'
import type { ProgrammingController } from './useProgrammingController'
import { ProgrammingUsage, ProgrammingWorkspace } from './ProgrammingContext'
import { ProgrammingPermissions, ProgrammingModel, ProgrammingEffort } from './ProgrammingComposerControls'
import './programming.css'
import './programmingComposer.css'
import ProgrammingTimeline from './ProgrammingTool'
import ProgrammingApproval from './ProgrammingApproval'
import ProgrammingInput from './ProgrammingInput'
import { ProgrammingGoal, ProgrammingQuestion, ProgrammingSessionIndicators } from './ProgrammingSessionCommands'
import { programmingAttachmentName } from './programmingAttachments'
import ProgrammingDirectories from './ProgrammingDirectories'

export default function ProgrammingChat({ language, controller, onOpenSettings }: {
  language: Language; controller: ProgrammingController; onOpenSettings?: (target?: 'permissions') => void
}) {
  const zh = language === 'zh-CN'
  const input = React.useRef<{ submit(): void }>(null)
  const { coding, session, setSession, cwd, draft, images, setImages, files, setFiles, busy, error, run } = controller
  if (!session && !controller.draftVisible) return <ProgrammingDirectories controller={controller} language={language} />
  return <section className="chat-panel programming-chat">
    <div className="chat-content">
      {session?.context?.mode === 'plan' && <p className="programming-mode" role="status">{zh ? '计划模式 · 先分析与澄清' : 'Plan mode · Analyze and clarify first'}</p>}
      {session && <ProgrammingTimeline messages={session.messages} language={language} running={session.status === 'running'} />}
      {session?.output && <article className="message assistant"><MarkdownMessage text={session.output} language={language} streaming={session.status === 'running'} /></article>}
      {session?.activity && <p role="status">{session.activity}</p>}
      {session?.context?.question && session.status === 'running' && <ProgrammingQuestion key={session.context.question.id} question={session.context.question} controller={controller} language={language} />}
      {session?.approval && session.status === 'running' && <ProgrammingApproval approval={session.approval} language={language} busy={busy} onChoose={optionId => {
        const id = session.id, requestId = session.approval!.id
        void run(async () => {
          await coding.approve(id, requestId, optionId)
          const value = await coding.read(id)
          setSession(current => current?.id === id ? value : current)
        })
      }} />}
      {(error || session?.error) && <p role="alert">{error || session?.error}</p>}
    </div>
    <div className="composer-wrap"><ProgrammingWorkspace language={language} controller={controller} /><ProgrammingGoal key={session?.id || 'draft'} controller={controller} language={language} /><div className="composer">
      {controller.draggingFiles && <p role="status">{zh ? '松开以添加图片或文件引用' : 'Drop to attach images or file references'}</p>}
      <ProgrammingInput ref={input} language={language} controller={controller} onOpenSettings={onOpenSettings} />
      <div className="composer-actions">
        <button className="secondary-button programming-attach" title={zh ? '添加图片或文件；也可粘贴图片、拖入文件（图片最多四张，共 20 MiB）' : 'Attach images or files; paste images or drop files (up to four images, 20 MiB total)'} disabled={busy || session?.status === 'running'} onClick={() => void controller.chooseAttachments()} aria-label={zh ? '添加图片或文件' : 'Attach images or files'}>＋</button>
        <ProgrammingPermissions controller={controller} language={language} onOpenSettings={onOpenSettings} />
        <ProgrammingSessionIndicators controller={controller} language={language} />
        <span className="composer-spacer" />
        <div className="programming-model-controls">
          <ProgrammingModel controller={controller} language={language} />
          <ProgrammingEffort controller={controller} language={language} />
        <ProgrammingUsage language={language} controller={controller} />
        {session?.status === 'running' ? <button className="composer-submit" disabled={busy} onClick={() => void run(async () => { await coding.stop(session.id) })}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg><span className="sr-only">{zh ? '停止' : 'Stop'}</span></button>
          : <button className="composer-submit" disabled={busy || !draft.trim() && !images.length && !files.length || !session && !cwd} onClick={() => input.current?.submit()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 11 6-6 6 6M12 5v14" /></svg><span className="sr-only">{zh ? '发送' : 'Send'}</span></button>}
        </div>
      </div>
      <div className="programming-attachments">{images.map((path, index) => <button type="button" key={`image-${index}`} disabled={busy} onClick={() => setImages(current => current.filter((_, i) => i !== index))}>
        {path.startsWith('data:') && <img src={path} alt="" width="28" height="28" />}{programmingAttachmentName(path, index, zh)} ×
      </button>)}{files.map((path, index) => <button type="button" key={`file-${index}`} title={path} disabled={busy} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}>{zh ? '文件引用：' : 'File reference: '}{programmingAttachmentName(path, index, zh)} ×</button>)}</div>
    </div></div>
  </section>
}
