import './scheduled-job-details.css'

type JobDetails = {
  id: string; name?: string | null; prompt?: string | null; script?: string | null
  deliver?: string | null; model?: string | null; provider?: string | null
  workdir?: string | null; skills?: string[] | null; enabled_toolsets?: string[] | null
  last_status?: string | null; last_error?: string | null; last_delivery_error?: string | null
}
type Run = { id: string; started_at?: number | null; title?: string | null; preview?: string | null; ended_at?: number | null; is_active?: boolean }

export type JobHistory = { job: JobDetails; runs: Run[] }

export default function ScheduledJobDetails({ details, loading, error, language }: {
  details: JobHistory | null; loading: boolean; error: string; language: string
}) {
  const zh = language === 'zh-CN'
  if (loading) return <div className="scheduled-detail" role="status">{zh ? '读取任务详情与运行记录…' : 'Loading job details and runs…'}</div>
  if (error) return <div className="scheduled-detail" role="alert">{error}</div>
  if (!details) return null
  const job = details.job
  return <div className="scheduled-detail">
    <div className="scheduled-detail-grid">
      <div><span>{zh ? '提示词' : 'Prompt'}</span><pre>{job.prompt || '—'}</pre></div>
      <div><span>{zh ? '脚本' : 'Script'}</span><pre>{job.script || '—'}</pre></div>
      <div><span>{zh ? '投递目标' : 'Delivery'}</span><strong>{job.deliver || 'local'}</strong></div>
      <div><span>{zh ? '模型' : 'Model'}</span><strong>{[job.provider, job.model].filter(Boolean).join(' / ') || '—'}</strong></div>
      <div><span>{zh ? '工作目录' : 'Workdir'}</span><strong>{job.workdir || '—'}</strong></div>
      <div><span>{zh ? '技能 / 工具集' : 'Skills / toolsets'}</span><strong>{[...(job.skills || []), ...(job.enabled_toolsets || [])].join(', ') || '—'}</strong></div>
    </div>
    {(job.last_error || job.last_delivery_error) && <p className="scheduled-detail-error" role="alert">{job.last_error || job.last_delivery_error}</p>}
    <h4>{zh ? '最近运行' : 'Recent runs'} <small>{details.runs.length}</small></h4>
    {details.runs.length === 0 ? <p>{zh ? '暂无运行记录。' : 'No runs yet.'}</p> : <ol className="scheduled-runs">{details.runs.map(run =>
      <li key={run.id}><time>{run.started_at ? new Date(run.started_at * 1000).toLocaleString(language) : '—'}</time>
        <strong>{run.title || (run.is_active ? (zh ? '运行中' : 'Running') : (zh ? '已结束' : 'Finished'))}</strong>
        {run.preview && <p>{run.preview}</p>}</li>)}</ol>}
  </div>
}
