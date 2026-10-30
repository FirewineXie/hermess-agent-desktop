import React from 'react'
import { sameQuickTarget } from './quickTarget'
import type { QuickTarget } from '@hermess/contracts'
import { useDesktop } from '../../app/DesktopContext'

export function useQuickInputBridge({ target, send }: { target: QuickTarget | null; send: (text: string) => Promise<boolean> }) {
  const { device } = useDesktop()
  const latest = React.useRef({ target, send })
  latest.current = { target, send }
  const targetKey = JSON.stringify(target)
  React.useEffect(() => {
    void device.setQuickTarget(target).catch(() => {})
  }, [device, targetKey])
  React.useEffect(() => {
    let active = true
    const subscription = device.onQuickSubmit(async event => {
      if (!active) return
      let taken = false
      let error: string | null = null
      try {
        const submission = await device.takeQuickSubmission(event.requestId)
        taken = true
        if (!sameQuickTarget(latest.current.target, submission.target)) throw new Error('目标已变化或会话忙碌，请刷新目标。')
        if (!await latest.current.send(submission.text)) throw new Error('提交未确认，请检查主窗口中的消息记录和错误提示。')
      } catch (cause) { error = cause instanceof Error ? cause.message : '主窗口无法处理此请求。' }
      if (taken) await device.finishQuickSubmission(event.requestId, error).catch(() => {})
    })
    return () => { active = false; void subscription.then(unsubscribe => unsubscribe()); void device.setQuickTarget(null).catch(() => {}) }
  }, [device])
}
