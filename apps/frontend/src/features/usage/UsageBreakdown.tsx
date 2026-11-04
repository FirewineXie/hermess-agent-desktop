import React from 'react'

type Column<T> = {
  key: keyof T & string
  label: string
  render: (row: T) => React.ReactNode
}

export default function UsageBreakdown<T>({ rows, columns, initialSort, rowKey }: {
  rows: T[]
  columns: Array<Column<T>>
  initialSort: keyof T & string
  rowKey: (row: T) => string
}) {
  const [sortKey, setSortKey] = React.useState<keyof T & string>(initialSort)
  const [descending, setDescending] = React.useState(true)
  const sorted = React.useMemo(() => [...rows].sort((left, right) => {
    const a = left[sortKey]
    const b = right[sortKey]
    if (a == null) return b == null ? 0 : 1
    if (b == null) return -1
    const order = typeof a === 'number' && typeof b === 'number'
      ? a - b : String(a).localeCompare(String(b))
    return descending ? -order : order
  }), [rows, sortKey, descending])
  const toggle = (key: keyof T & string) => {
    if (key === sortKey) setDescending(value => !value)
    else { setSortKey(key); setDescending(true) }
  }

  return <div className="usage-table-scroll"><table><thead><tr>{columns.map(column =>
    <th key={column.key} aria-sort={sortKey === column.key ? descending ? 'descending' : 'ascending' : 'none'}>
      <button type="button" onClick={() => toggle(column.key)}>{column.label}<span aria-hidden="true">{sortKey === column.key ? descending ? ' ↓' : ' ↑' : ' ↕'}</span></button>
    </th>)}</tr></thead><tbody>{sorted.map(row => <tr key={rowKey(row)}>{columns.map(column =>
      <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>
}
