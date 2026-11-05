import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { shouldOpenOnboarding, type OnboardingStatus } from './onboardingState'

const STORAGE_KEY = 'hermess.desktop.onboarding.v1'
export type OnboardingStep = 'runtime' | 'model' | 'message'

export function useOnboarding(freshInstallation: boolean | null, storagePath: string) {
  const { diagnostics } = useDesktop()
  const [step, setStep] = React.useState<OnboardingStep>('runtime')
  const [open, setOpen] = React.useState(false)
  const [paused, setPaused] = React.useState(false)
  const initialized = React.useRef(false)

  const log = React.useCallback((event: string) => {
    if (storagePath) void diagnostics.recordEvent(storagePath, `onboarding_${event}`).catch(() => {})
  }, [diagnostics, storagePath])

  React.useEffect(() => {
    if (initialized.current || freshInstallation === null) return
    initialized.current = true
    let status: OnboardingStatus = null
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'in-progress' || saved === 'completed' || saved === 'skipped') status = saved
    } catch { /* Session-only mode. */ }
    if (shouldOpenOnboarding(freshInstallation, status)) {
      try { localStorage.setItem(STORAGE_KEY, 'in-progress') } catch { /* Session-only mode. */ }
      setOpen(true)
      log('started')
    }
  }, [freshInstallation, log])

  const finish = (result: 'completed' | 'skipped') => {
    try { localStorage.setItem(STORAGE_KEY, result) } catch { /* Current session still closes. */ }
    setOpen(false)
    setPaused(false)
    log(result)
  }
  const reopen = () => {
    setStep('runtime')
    setPaused(false)
    setOpen(true)
    log('reopened')
  }
  const advance = (next: OnboardingStep) => { setStep(next); log(`step_${next}`) }
  return { step, setStep: advance, visible: open && !paused, open, pause: () => setPaused(true), resume: () => setPaused(false), finish, reopen, record: log }
}
