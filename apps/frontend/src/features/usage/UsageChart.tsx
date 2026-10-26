import type { UsageStatistics } from '@hermess/contracts'
import { translateApp, type Language } from '../../i18n'
import { usageChartPoints, type ChartPoint } from './chartModel'

type Key = 'input' | 'output' | 'reasoning'
const lines: Array<{ key: Key; label: string; color: string }> = [
  { key: 'input', label: 'ui.usage.input', color: '#315c91' },
  { key: 'output', label: 'ui.usage.output', color: '#df7846' },
  { key: 'reasoning', label: 'ui.usage.reasoning', color: '#8751a8' },
]
const WIDTH = 760
const HEIGHT = 260
const LEFT = 64
const TOP = 18
const PLOT_WIDTH = WIDTH - LEFT - 16
const PLOT_HEIGHT = HEIGHT - TOP - 38

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function position(index: number, count: number): number {
  return LEFT + (count === 1 ? PLOT_WIDTH / 2 : index * PLOT_WIDTH / (count - 1))
}

function path(points: ChartPoint[], key: Key, maximum: number): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${position(index, points.length)} ${TOP + PLOT_HEIGHT * (1 - point[key] / maximum)}`).join(' ')
}

export default function UsageChart({ daily, days, language }: { daily: UsageStatistics['daily']; days: number; language: Language }) {
  const points = usageChartPoints(daily, days, todayLocal())
  if (points.length === 0) return null
  const maximum = Math.max(1, ...points.flatMap(point => [point.input, point.output, point.reasoning]))
  const t = (key: string) => translateApp(language, key)
  const compact = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 })
  const exact = new Intl.NumberFormat(language)
  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1]

  return <div className="usage-chart">
    <div className="usage-chart-legend">{lines.map(line => <span key={line.key}>
      <i style={{ backgroundColor: line.color }} />{t(line.label)}
    </span>)}</div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('ui.usage.chart.label')}>
      {[0, 1, 2, 3, 4].map(step => {
        const y = TOP + step * PLOT_HEIGHT / 4
        return <g key={step}>
          <line x1={LEFT} x2={WIDTH - 16} y1={y} y2={y} className="usage-chart-grid" />
          <text x={LEFT - 10} y={y + 4} textAnchor="end">{compact.format(maximum * (1 - step / 4))}</text>
        </g>
      })}
      {lines.map(line => <g key={line.key}>
        <path d={path(points, line.key, maximum)} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.length <= 10 && points.map((point, index) => <circle key={point.day} cx={position(index, points.length)}
          cy={TOP + PLOT_HEIGHT * (1 - point[line.key] / maximum)} r="3.5" fill={line.color}>
          <title>{`${point.day} · ${t(line.label)}: ${exact.format(point[line.key])}`}</title>
        </circle>)}
      </g>)}
      {[...new Set(labelIndexes)].map(index => <text key={index} x={position(index, points.length)} y={HEIGHT - 11}
        textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{points[index].day.slice(5)}</text>)}
    </svg>
  </div>
}
