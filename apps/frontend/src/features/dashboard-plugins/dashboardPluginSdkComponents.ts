import React from 'react'

export type DashboardToastState = { message: string; type: 'success' | 'error' }

export function DashboardPluginToast({ toast }: { toast: DashboardToastState | null }) {
  if (!toast) return null
  return React.createElement('div', {
    className: `dashboard-sdk-toast ${toast.type}`,
    role: 'status',
  }, toast.message)
}
