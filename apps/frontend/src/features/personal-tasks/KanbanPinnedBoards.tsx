import React from 'react'
import { useLanguage } from '../../i18n'
import type { BoardMeta } from './kanbanApi'

function loadPins(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string'))] : []
  } catch {
    return []
  }
}

export default function KanbanPinnedBoards({ storagePath, boards, current, onSelect, onError }: {
  storagePath: string; boards: BoardMeta[]; current: string
  onSelect: (board: string) => void; onError: (message: string) => void
}) {
  const zh = useLanguage() === 'zh-CN'
  const key = `hermess:kanban:pinned-boards:${storagePath}`
  const [pins, setPins] = React.useState(() => loadPins(key))
  const pinned = pins.includes(current)
  const visible = pins.flatMap(slug => boards.filter(board => board.slug === slug))

  function toggle() {
    const operation = crypto.randomUUID()
    console.info('[kanban-pins] change started', { operation, pin: !pinned })
    try {
      const next = pinned ? pins.filter(slug => slug !== current) : [...pins, current]
      localStorage.setItem(key, JSON.stringify(next))
      setPins(next)
      console.info('[kanban-pins] change completed', { operation })
    } catch {
      console.warn('[kanban-pins] preference write failed', { operation })
      onError(zh ? '无法保存看板固定设置。' : 'Could not save pinned boards.')
    }
  }

  return <>
    <button type="button" aria-pressed={pinned} disabled={!storagePath || !boards.some(board => board.slug === current)} onClick={toggle}>
      {pinned ? (zh ? '取消固定' : 'Unpin board') : (zh ? '固定看板' : 'Pin board')}
    </button>
    {visible.length > 0 && <div className="kanban-native-pinned" role="group" aria-label={zh ? '固定看板' : 'Pinned boards'}>
      {visible.map(board => <button key={board.slug} type="button" aria-pressed={current === board.slug} onClick={() => onSelect(board.slug)}>{board.name || board.slug}</button>)}
    </div>}
  </>
}
