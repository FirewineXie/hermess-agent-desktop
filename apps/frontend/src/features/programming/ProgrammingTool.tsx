import React from 'react'
import type { CodingMessage, CodingTool } from '@hermess/contracts'
import type { Language } from '../../i18n'
import MarkdownMessage from '../chat/components/MarkdownMessage'
import ProgrammingTiming from './ProgrammingTiming'

function ToolIcon({ file = false }: { file?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{file
    ? <><path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14Z" /></>
    : <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>}</svg>
}

function Tool({ tool, language, running }: { tool: CodingTool; language: Language; running: boolean }) {
  const zh = language === 'zh-CN'
  const failed = tool.status === 'failed' || tool.status === 'declined' || (tool.exit_code != null && tool.exit_code !== 0)
  const pending = tool.status === 'inProgress' && running
  const completed = tool.status === 'completed' && !failed
  const state = pending ? (zh ? '执行中' : 'Running') : failed ? (zh ? '失败或已拒绝' : 'Failed or denied')
    : completed ? (zh ? '已完成' : 'Completed') : (zh ? '已中断' : 'Interrupted')
  const file = tool.type === 'fileChange'
  const verb = tool.type === 'commandExecution' ? (pending ? (zh ? '正在运行' : 'Running') : completed ? (zh ? '已运行' : 'Ran') : state)
    : file ? (pending ? (zh ? '正在编辑' : 'Editing') : completed ? (zh ? '已编辑' : 'Edited') : state)
    : tool.type === 'skill' ? (zh ? '已提交 Skill' : 'Submitted skill')
    : tool.type === 'imageGeneration' ? (zh ? '生成图片' : 'Generate image')
    : tool.type === 'imageView' ? (zh ? '查看图片' : 'View image')
    : tool.type === 'webSearch' ? (zh ? '搜索网页' : 'Search web') : (zh ? '调用工具' : 'Call tool')
  return <details className="programming-tool" data-status={failed ? 'failed' : pending ? 'running' : tool.status}>
    <summary title={tool.summary || state}><ToolIcon file={file} /><span className="programming-tool-summary">{file && tool.changes?.length
      ? tool.changes.map((change, index) => <span className="programming-file-line" key={index}>{pending ? (zh ? '正在编辑' : 'Editing') : completed ? (zh ? ({ add: '已创建', delete: '已删除', update: '已编辑' }[change.kind] || '已编辑') : 'Changed') : state} <span className="programming-file-name">{change.path.split(/[\\/]/).at(-1)}</span> <small>+{change.added} −{change.removed}</small></span>)
      : <>{verb} {tool.summary}{tool.skill_paths?.length ? <small> · {zh ? '读取 Skill 文档' : 'Read skill instructions'}</small> : null}</>}</span><span className="sr-only">{state}</span>{pending && <span className="programming-session-spinner" aria-hidden="true" />}</summary>
    {tool.summary && <pre>{tool.summary}</pre>}
    {tool.cwd && <p>{zh ? '工作目录：' : 'Working directory: '}{tool.cwd}</p>}
    {tool.skill_paths?.map(path => <p key={path}>Skill: {path}</p>)}
    {tool.detail && <pre>{tool.detail}</pre>}
    {tool.output && <pre aria-label={zh ? '工具输出' : 'Tool output'}>{tool.output}</pre>}
    {tool.exit_code != null && <p>{zh ? '退出码：' : 'Exit code: '}{tool.exit_code}</p>}
    {!tool.output && pending && <p>{zh ? '等待工具返回结果…' : 'Waiting for tool output…'}</p>}
  </details>
}

function ToolGroup({ tools, language, running }: { tools: CodingTool[]; language: Language; running: boolean }) {
  const zh = language === 'zh-CN'
  const files = tools.some(tool => tool.type === 'fileChange')
  const commands = tools.some(tool => tool.type === 'commandExecution')
  const label = zh ? (files && commands ? '编辑了文件，运行了命令' : files ? '编辑了文件' : commands ? '运行了命令' : '使用了工具')
    : files && commands ? 'Changed files and ran commands' : files ? 'Changed files' : commands ? 'Ran commands' : 'Used tools'
  return <details className="programming-tool-group" open><summary><ToolIcon file={files} /><span>{label}</span><svg className="programming-tool-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div className="programming-tool-list">{tools.map(tool => <Tool key={tool.id} tool={tool} language={language} running={running} />)}</div></details>
}

export default function ProgrammingTimeline({ messages, language, running }: { messages: CodingMessage[]; language: Language; running: boolean }) {
  const content: React.ReactNode[] = []
  let lastUser = -1
  messages.forEach((message, index) => { if (message.role === 'user') lastUser = index })
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.tool) {
      const start = index, tools = [message.tool]
      while (messages[index + 1]?.tool) tools.push(messages[++index].tool!)
      content.push(<ToolGroup key={start} tools={tools} language={language} running={running} />)
    } else {
      content.push(<React.Fragment key={index}><article className={`message ${message.role}`}>{message.images?.map((name, i) => <small key={i}> · {name}</small>)}<MarkdownMessage text={message.text} language={language} /></article>
        {message.timing && <ProgrammingTiming timing={message.timing} language={language} running={running && index === lastUser} />}
      </React.Fragment>)
    }
  }
  return <>{content}</>
}
