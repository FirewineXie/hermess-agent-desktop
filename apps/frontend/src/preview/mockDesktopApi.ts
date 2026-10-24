import type { DesktopApi } from '@hermess/contracts'

const previewOnly = () => new Error('此操作需要桌面客户端；当前是前端预览。')

export const previewDesktopApi: DesktopApi = {
  async invoke(command) {
    if (command === 'probe_local_tools') return [] as never
    if (command === 'dev_backend_defaults') return { python_path: '', storage_path: '' } as never
    throw previewOnly()
  },
  async listen() { return () => {} },
  async open() { return null },
  async onDragDropEvent() { return () => {} },
}
