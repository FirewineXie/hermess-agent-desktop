import React from 'react'
import type { Language } from '../../i18n'
import type { OnboardingStep } from './useOnboarding'
import './onboarding.css'

type Props = {
  language: Language
  step: OnboardingStep
  connected: boolean
  runtimeBusy: boolean
  runtimeStatus: string
  profile: string | null
  model: string | null
  messageBusy: boolean
  onStep: (step: OnboardingStep) => void
  onOpenRuntime: () => void
  onOpenModels: () => void
  onSend: (message: string) => Promise<boolean>
  onSkip: () => void
  onComplete: () => void
}

export default function OnboardingDialog({ language, step, connected, runtimeBusy, runtimeStatus, profile, model, messageBusy, onStep, onOpenRuntime, onOpenModels, onSend, onSkip, onComplete }: Props) {
  const zh = language === 'zh-CN'
  const [message, setMessage] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState('')
  const labels = zh ? ['运行时', '模型', '第一条消息'] : ['Runtime', 'Model', 'First message']
  const index = step === 'runtime' ? 0 : step === 'model' ? 1 : 2
  const submit = async () => {
    if (!message.trim() || sending || messageBusy) return
    setSending(true)
    setError('')
    try {
      if (await onSend(message.trim())) onComplete()
      else setError(zh ? '发送未成功。请检查聊天状态后重试。' : 'The message was not sent. Check chat status and try again.')
    } catch {
      setError(zh ? '发送失败。请检查聊天状态后重试。' : 'Sending failed. Check chat status and try again.')
    } finally { setSending(false) }
  }

  return <div className="onboarding-overlay">
    <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header><span className="onboarding-eyebrow">HERMESS DESKTOP · {index + 1}/3</span><h1 id="onboarding-title">{zh ? '开始使用 Hermess' : 'Get started with Hermess'}</h1>
        <p>{zh ? '按步骤检查本机运行时、当前 Profile 的模型，然后发送第一条消息。' : 'Check the local runtime and model for this Profile, then send your first message.'}</p></header>
      <ol className="onboarding-steps">{labels.map((label, position) => <li key={label} aria-current={position === index ? 'step' : undefined} className={position === index ? 'current' : position < index ? 'done' : ''}>{position + 1}. {label}</li>)}</ol>
      <div className="onboarding-content">
        {step === 'runtime' && <><h2>{zh ? '连接本机运行时' : 'Connect the local runtime'}</h2><p>{zh ? '应用会自动启动产品管理的运行时。Windows 新用户首次启动会先下载并安装默认工具和依赖，请保持网络连接并等待完成；之后启动会跳过安装。若失败，可打开运行时设置检查状态并重试。' : 'The app starts its managed runtime automatically. On Windows, a new installation first downloads and installs default tools and dependencies. Stay online and wait for completion; later starts skip installation. If startup fails, open Runtime settings to check the status and retry.'}</p><p className={`onboarding-status ${connected ? 'ready' : ''}`}>{connected ? (zh ? '已连接' : 'Connected') : runtimeBusy ? (zh ? '正在启动…' : 'Starting…') : runtimeStatus}</p><button type="button" onClick={onOpenRuntime}>{zh ? '打开运行时设置' : 'Open runtime settings'}</button></>}
        {step === 'model' && <><h2>{zh ? '配置主模型' : 'Configure a main model'}</h2><p>{zh ? '模型和提供商按 Profile 隔离。请为当前 Profile 配置提供商凭据并选择主模型。' : 'Models and providers belong to each Profile. Configure a provider and choose a main model for the current Profile.'}</p><p className={`onboarding-status ${model ? 'ready' : ''}`}>{zh ? '当前 Profile：' : 'Current Profile: '}{profile || (zh ? '未选择' : 'None')} · {model || (zh ? '未设置主模型' : 'No main model')}</p><button type="button" onClick={onOpenModels}>{zh ? '打开模型设置' : 'Open model settings'}</button></>}
        {step === 'message' && <><h2>{zh ? '发送第一条消息' : 'Send your first message'}</h2><p>{zh ? '消息会发送到当前 Profile 的新聊天。发送成功后引导完成。' : 'Your message will go to a new chat in the current Profile. The guide completes when it is sent.'}</p><label htmlFor="onboarding-message">{zh ? '消息内容' : 'Message'}</label><textarea id="onboarding-message" value={message} onChange={event => setMessage(event.target.value)} placeholder={zh ? '例如：介绍一下你能帮我做什么' : 'For example: What can you help me with?'} rows={3} maxLength={10000} disabled={sending} />{error && <p role="alert" className="onboarding-error">{error}</p>}</>}
      </div>
      <footer><button type="button" className="onboarding-skip" disabled={sending} onClick={onSkip}>{zh ? '跳过引导' : 'Skip guide'}</button><div>{index > 0 && <button type="button" disabled={sending} onClick={() => onStep(index === 2 ? 'model' : 'runtime')}>{zh ? '上一步' : 'Back'}</button>}{step === 'runtime' && <button type="button" className="primary" disabled={!connected} onClick={() => onStep('model')}>{zh ? '下一步' : 'Next'}</button>}{step === 'model' && <button type="button" className="primary" disabled={!connected || !profile || !model} onClick={() => onStep('message')}>{zh ? '下一步' : 'Next'}</button>}{step === 'message' && <button type="button" className="primary" disabled={!connected || !profile || !model || !message.trim() || sending || messageBusy} onClick={() => void submit()}>{sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送并完成' : 'Send and finish')}</button>}</div></footer>
    </section>
  </div>
}
