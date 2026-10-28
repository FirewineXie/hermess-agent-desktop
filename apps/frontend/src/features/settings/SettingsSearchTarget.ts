import { createContext } from 'react'
import type { SettingsLocation } from './model'

export type SettingsFieldTarget = { field: string; location: SettingsLocation }

export const SettingsSearchTarget = createContext<SettingsFieldTarget | null>(null)
