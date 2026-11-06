import React from 'react'
import { buildScheduleString, parseScheduleString, type IntervalUnit, type ScheduleBuilderState, type ScheduleMode, type Weekday } from './scheduleBuilderModel'
import './scheduled-schedule-builder.css'

const weekdays: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

export default function ScheduledScheduleBuilder({ schedule, onChange, zh }: {
  schedule: string; onChange: (schedule: string) => void; zh: boolean
}) {
  const [state, setState] = React.useState(() => parseScheduleString(schedule))
  const emitted = React.useRef(schedule)
  React.useEffect(() => {
    if (schedule !== emitted.current) {
      emitted.current = schedule
      setState(parseScheduleString(schedule))
    }
  }, [schedule])
  const update = (patch: Partial<ScheduleBuilderState>) => {
    const next = { ...state, ...patch }
    const value = buildScheduleString(next)
    setState(next); emitted.current = value; onChange(value)
  }
  const toggleWeekday = (day: Weekday) => update({ weekdays: state.weekdays.includes(day)
    ? state.weekdays.filter(item => item !== day) : [...state.weekdays, day] })
  const modeLabels: Record<ScheduleMode, string> = zh
    ? { interval: '按间隔', daily: '每天', weekly: '每周', monthly: '每月', once: '单次', custom: '自定义' }
    : { interval: 'Interval', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', once: 'Once', custom: 'Custom' }
  const weekdayLabels = zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return <fieldset className="scheduled-schedule-builder">
    <legend>{zh ? '执行计划' : 'Schedule'}</legend>
    <label>{zh ? '计划类型' : 'Schedule type'}<select value={state.mode} onChange={event => update({ mode: event.target.value as ScheduleMode })}>
      {(Object.keys(modeLabels) as ScheduleMode[]).map(mode => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}
    </select></label>
    {state.mode === 'interval' && <div className="scheduled-builder-pair">
      <label>{zh ? '每隔' : 'Every'}<input type="number" min={1} max={9999} value={state.intervalValue} onChange={event => update({ intervalValue: Number(event.target.value) })} /></label>
      <label>{zh ? '单位' : 'Unit'}<select value={state.intervalUnit} onChange={event => update({ intervalUnit: event.target.value as IntervalUnit })}>
        <option value="minutes">{zh ? '分钟' : 'Minutes'}</option><option value="hours">{zh ? '小时' : 'Hours'}</option><option value="days">{zh ? '天' : 'Days'}</option>
      </select></label>
    </div>}
    {state.mode === 'weekly' && <div className="scheduled-weekdays" role="group" aria-label={zh ? '星期' : 'Weekdays'}>{weekdays.map(day =>
      <button key={day} type="button" aria-pressed={state.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{weekdayLabels[day]}</button>)}</div>}
    {['daily', 'weekly', 'monthly'].includes(state.mode) && <div className="scheduled-builder-pair">
      {state.mode === 'monthly' && <label>{zh ? '每月第几天' : 'Day of month'}<input type="number" min={1} max={31} value={state.dayOfMonth} onChange={event => update({ dayOfMonth: Number(event.target.value) })} /></label>}
      <label>{zh ? '执行时间' : 'Time'}<input required type="time" value={state.timeOfDay} onChange={event => update({ timeOfDay: event.target.value })} /></label>
    </div>}
    {state.mode === 'once' && <label>{zh ? '执行日期与时间' : 'Date and time'}<input required type="datetime-local" value={state.onceAt} onChange={event => update({ onceAt: event.target.value })} /></label>}
    {state.mode === 'custom' && <label>{zh ? 'Cron 或 Hermes 计划表达式' : 'Cron or Hermes schedule expression'}<input required maxLength={200} placeholder="0 9 * * *" value={state.custom} onChange={event => update({ custom: event.target.value })} /></label>}
    <p className="scheduled-schedule-preview"><span>{zh ? '提交值：' : 'Submitted value: '}</span><code>{buildScheduleString(state) || (zh ? '请补全计划' : 'Complete the schedule')}</code></p>
  </fieldset>
}
