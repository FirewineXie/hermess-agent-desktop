export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'once' | 'custom'
export type IntervalUnit = 'minutes' | 'hours' | 'days'
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type ScheduleBuilderState = {
  mode: ScheduleMode
  intervalValue: number
  intervalUnit: IntervalUnit
  timeOfDay: string
  weekdays: Weekday[]
  dayOfMonth: number
  onceAt: string
  custom: string
}

export const defaultScheduleBuilderState: ScheduleBuilderState = {
  mode: 'interval',
  intervalValue: 30,
  intervalUnit: 'minutes',
  timeOfDay: '09:00',
  weekdays: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  onceAt: '',
  custom: '',
}

const suffixes: Record<IntervalUnit, string> = { minutes: 'm', hours: 'h', days: 'd' }

function validTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1]); const minute = Number(match[2])
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null
}

export function buildScheduleString(state: ScheduleBuilderState): string {
  if (state.mode === 'interval') {
    const amount = Math.floor(state.intervalValue)
    return Number.isFinite(amount) && amount > 0 ? `every ${amount}${suffixes[state.intervalUnit]}` : ''
  }
  if (state.mode === 'once') {
    const value = state.onceAt.trim()
    return value.length === 16 ? `${value}:00` : value
  }
  if (state.mode === 'custom') return state.custom.trim()
  const time = validTime(state.timeOfDay)
  if (!time) return ''
  if (state.mode === 'daily') return `${time.minute} ${time.hour} * * *`
  if (state.mode === 'weekly') {
    const days = state.weekdays.length ? [...new Set(state.weekdays)].sort((a, b) => a - b).join(',') : '*'
    return `${time.minute} ${time.hour} * * ${days}`
  }
  const day = Math.floor(state.dayOfMonth)
  return Number.isFinite(day) && day >= 1 && day <= 31 ? `${time.minute} ${time.hour} ${day} * *` : ''
}

function parseSimpleCron(value: string): Partial<ScheduleBuilderState> | null {
  const parts = value.split(/\s+/)
  if (parts.length !== 5) return null
  const [minuteText, hourText, dayText, monthText, weekdayText] = parts
  if (!/^\d+$/.test(minuteText) || !/^\d+$/.test(hourText) || monthText !== '*') return null
  const minute = Number(minuteText); const hour = Number(hourText)
  if (minute > 59 || hour > 23) return null
  const timeOfDay = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (dayText === '*' && weekdayText === '*') return { mode: 'daily', timeOfDay }
  if (dayText === '*' && /^\d+(,\d+)*$/.test(weekdayText)) {
    const parsed = weekdayText.split(',').map(Number)
    if (parsed.some(day => day < 0 || day > 7)) return null
    const weekdays = [...new Set(parsed.map(day => day === 7 ? 0 : day))] as Weekday[]
    return { mode: 'weekly', timeOfDay, weekdays }
  }
  if (/^\d+$/.test(dayText) && weekdayText === '*') {
    const dayOfMonth = Number(dayText)
    if (dayOfMonth >= 1 && dayOfMonth <= 31) return { mode: 'monthly', timeOfDay, dayOfMonth }
  }
  return null
}

export function parseScheduleString(schedule: string): ScheduleBuilderState {
  const value = schedule.trim()
  if (!value) return { ...defaultScheduleBuilderState, weekdays: [...defaultScheduleBuilderState.weekdays] }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return { ...defaultScheduleBuilderState, mode: 'once', onceAt: value.slice(0, 16) }
  }
  const interval = /^every\s+(\d+)\s*([mhd])$/i.exec(value)
  if (interval) {
    const intervalUnit: IntervalUnit = interval[2].toLowerCase() === 'd' ? 'days'
      : interval[2].toLowerCase() === 'h' ? 'hours' : 'minutes'
    return { ...defaultScheduleBuilderState, mode: 'interval', intervalValue: Number(interval[1]), intervalUnit }
  }
  const cron = parseSimpleCron(value)
  if (cron) return { ...defaultScheduleBuilderState, ...cron }
  return { ...defaultScheduleBuilderState, mode: 'custom', custom: value }
}
