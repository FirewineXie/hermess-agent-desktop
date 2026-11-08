import React from 'react'
import type { CodingApproval, CodingApprovalOption } from '@hermess/contracts'
import type { Language } from '../../i18n'

export default function ProgrammingApproval({ approval, language, busy, onChoose }: {
  approval: CodingApproval; language: Language; busy: boolean; onChoose: (optionId: string) => void
}) {
  const zh = language === 'zh-CN'
  const labels: Record<CodingApprovalOption['kind'], string> = zh ? {
    once: '允许一次', session: '本轮允许同类操作', command_rule: '始终允许此前缀',
    network_rule: '保存此网络规则', deny: '拒绝并继续', cancel: '拒绝并停止本轮',
  } : {
    once: 'Allow once', session: 'Allow similar actions this run', command_rule: 'Always allow this prefix',
    network_rule: 'Save this network rule', deny: 'Deny and continue', cancel: 'Deny and stop this turn',
  }
  return <div className="programming-approval" role="region" aria-label={zh ? 'Codex 审批请求' : 'Codex approval request'}>
    <strong>{zh ? '等待你的审批' : 'Waiting for your approval'}</strong>
    {approval.description && <p>{approval.description}</p>}
    {approval.cwd && <p>{zh ? '工作目录：' : 'Working directory: '}{approval.cwd}</p>}
    {approval.command && <pre>{approval.command}</pre>}
    <p>{approval.source === 'computer'
      ? (zh ? '电脑操作需要单独审批，仅允许本次调用。两分钟内未回答会自动拒绝。' : 'Computer actions require separate approval for this call only. Unanswered requests are denied after two minutes.')
      : approval.source === 'mcp' ? (zh ? '此确认请求来自 MCP Server，仅允许本次调用。两分钟内未回答会自动拒绝。' : 'This confirmation comes from an MCP server and applies to this call only. Unanswered requests are denied after two minutes.')
        : (zh ? '以下选项来自当前 Codex 请求。两分钟内未回答会自动拒绝。' : 'These choices come from the current Codex request. Unanswered requests are denied after two minutes.')}</p>
    {!approval.options.length && <p role="alert">{zh ? '此请求没有客户端支持的审批选项，可停止本轮后重试。' : 'This request has no supported choices. Stop the turn and retry.'}</p>}
    {approval.options.some(option => option.kind === 'session') && <p>{zh ? '本轮授权只在当前运行期间记住同类操作，下一轮可能再次询问。' : 'Temporary grants remember similar actions for this run only. A later turn may ask again.'}</p>}
    {approval.options.filter(option => option.kind === 'command_rule' || option.kind === 'network_rule').map(option => <div className="programming-approval-rule" key={option.id}>
      <strong>{labels[option.kind]}</strong><pre>{option.detail}</pre>
      <p>{zh ? '仅保存到当前编程会话的独立运行目录，后续匹配的操作按此规则处理。' : 'Save in this programming chat’s isolated runtime directory for future matching actions.'}</p>
    </div>)}
    <div className="programming-approval-actions">{approval.options.map(option => <button type="button" className={option.kind === 'once' ? 'programming-approval-once' : undefined} key={option.id} disabled={busy} onClick={() => onChoose(option.id)}>{labels[option.kind]}</button>)}</div>
  </div>
}
