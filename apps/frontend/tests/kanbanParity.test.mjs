import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const apiUrl = new URL('../src/features/personal-tasks/kanbanApi.ts', import.meta.url)
const boardUrl = new URL('../src/features/personal-tasks/KanbanBoardView.tsx', import.meta.url)
const boardStylesUrl = new URL('../src/features/personal-tasks/kanban-board.css', import.meta.url)
const drawerUrl = new URL('../src/features/personal-tasks/KanbanTaskDrawer.tsx', import.meta.url)

test('ordinary task mutations never trigger the dispatcher implicitly', async () => {
  const [api, board] = await Promise.all([readFile(apiUrl, 'utf8'), readFile(boardUrl, 'utf8')])
  assert.doesNotMatch(api, /setTimeout|nudgeTimer|\/dispatch/)
  assert.match(board, /withBoard\('\/dispatch', board\)/)
  assert.match(board, />\{busy \? '调度中…' : '立即调度'\}<\/button>/)
})

test('selected board is a validated local UI preference', async () => {
  const board = await readFile(boardUrl, 'utf8')
  assert.match(board, /hermess:kanban:selected-board/)
  assert.match(board, /list\.boards\.some\(item => item\.slug === stored\)/)
  assert.match(board, /localStorage\.setItem\(SELECTED_BOARD_KEY, slug\)/)
  assert.doesNotMatch(board, /\/boards\/\$\{[^}]+\}\/switch/)
})

test('task relationships support both parent and child directions', async () => {
  const drawer = await readFile(drawerUrl, 'utf8')
  assert.match(drawer, /linkKind === 'parent'/)
  assert.match(drawer, /\{ parent_id: relatedId, child_id: taskId \}/)
  assert.match(drawer, /\{ parent_id: taskId, child_id: relatedId \}/)
  assert.match(drawer, /relatedId === taskId/)
})

test('the board is a vertical status tree and every status can contain a task tree', async () => {
  const [board, styles] = await Promise.all([
    readFile(boardUrl, 'utf8'),
    readFile(boardStylesUrl, 'utf8'),
  ])
  assert.match(board, /collapsedStatuses/)
  assert.match(board, /collapsedTasks/)
  assert.doesNotMatch(board, /collapsedColumns/)
  assert.match(board, /className="kanban-native-tree-board"/)
  assert.match(board, /className=\{`kanban-native-status-branch/)
  assert.match(board, /aria-controls=\{`kanban-status-\$\{column\.name\}`\}/)
  assert.match(board, /renderTaskTree\(cards\)/)
  assert.match(board, /column\.name === 'review'[\s\S]*renderTaskTree\(cards, true\)/)
  assert.match(board, /buildKanbanTaskTree/)
  assert.doesNotMatch(board, /kanban-native-lanes|renderReviewTree/)
  assert.match(styles, /\.kanban-native-tree-board\s*\{[^}]*display:\s*grid/s)
  assert.match(styles, /\.kanban-native-page\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s)
  assert.match(styles, /\.kanban-native-tree-board\s*\{[^}]*gap:\s*0/s)
  assert.match(styles, /\.kanban-native-status-branch\s*\{[^}]*border:\s*0/s)
  assert.match(styles, /\.kanban-native-status-heading\s*\{[^}]*min-height:\s*36px/s)
  assert.match(styles, /\.kanban-native-status-title\s*\{[^}]*font-size:\s*12px/s)
  assert.doesNotMatch(board, /!cards\.length && <p className="kanban-native-empty">暂无任务<\/p>/)
  assert.match(styles, /\.kanban-native-status-toggle\[aria-expanded='false'\] \.kanban-native-status-chevron/)
  assert.match(styles, /\.kanban-native-tree-toggle\[aria-expanded='false'\]/)
})
