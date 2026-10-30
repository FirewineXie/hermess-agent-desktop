import type React from 'react'
import type { BackendInfo } from '@hermess/contracts'
import type { ModelPick } from '../models/model'

export type ChatControllerOptions = {
  backend: BackendInfo | null
  profile: string | null
  chatVisible: boolean
  activeModel: ModelPick | null
  language: 'zh-CN' | 'en-US'
  storagePath: string
  workspacePath: string
  t: (key: string, ...values: unknown[]) => string
  openChat: () => void
  openModelSettings: () => void
  openCommandPage: (name: string) => boolean
  onBackgroundStarted: () => void
  onCommandFinished: (profile: string, sessionId: string) => void
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveModel: React.Dispatch<React.SetStateAction<ModelPick | null>>
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBackend: (next: BackendInfo | null) => void
  setBackendStatus: React.Dispatch<React.SetStateAction<string>>
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
}
