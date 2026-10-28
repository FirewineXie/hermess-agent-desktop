import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { blobDataUrl } from './audioData'

export function VoiceRecorderButton({ profile, scopeKey, disabled, onTranscript, onStatus }: { profile: string | null; scopeKey?: string; disabled?: boolean; onTranscript: (text: string) => void; onStatus?: (text: string) => void }) {
  const { voice, agentSettings } = useDesktop()
  const language = useLanguage()
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const generationRef = React.useRef(0)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recording, setRecording] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const releaseCapture = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    chunksRef.current = []
  }, [])
  React.useEffect(() => {
    setRecording(false)
    setBusy(false)
    return () => {
      generationRef.current++
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null
        recorder.ondataavailable = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      releaseCapture()
    }
  }, [releaseCapture, profile, scopeKey])
  const stop = () => recorderRef.current?.state === 'recording' && recorderRef.current.stop()
  const start = async () => {
    if (!profile || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onStatus?.(language === 'zh-CN' ? '当前 WebView 不支持麦克风录音' : 'Microphone recording is not supported by this WebView')
      return
    }
    setBusy(true)
    const generation = generationRef.current
    try {
      let maxSeconds = 120
      try {
        const config = await agentSettings.config({ kind: 'profile', profile })
        const value = (config.voice as Record<string, unknown> | undefined)?.max_recording_seconds
        if (typeof value === 'number' && Number.isFinite(value)) maxSeconds = value
      } catch { /* Keep the upstream default when config is temporarily unavailable. */ }
      if (generation !== generationRef.current) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => {
        if (generation !== generationRef.current) return
        generationRef.current++
        releaseCapture()
        setRecording(false)
        setBusy(false)
        onStatus?.(language === 'zh-CN' ? '录音失败' : 'Recording failed')
      }
      recorder.onstop = () => {
        if (generation !== generationRef.current) return
        const mimeType = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        releaseCapture()
        setRecording(false)
        if (!blob.size) { onStatus?.(language === 'zh-CN' ? '没有录到音频' : 'No audio was recorded'); setBusy(false); return }
        void blobDataUrl(blob).then(dataUrl => voice.transcribe({ kind: 'profile', profile }, { dataUrl, mimeType }))
          .then(result => { if (generation === generationRef.current) { onTranscript(result.transcript); onStatus?.(language === 'zh-CN' ? `转写完成${result.provider ? ` · ${result.provider}` : ''}` : `Transcription complete${result.provider ? ` · ${result.provider}` : ''}`) } })
          .catch(error => { if (generation === generationRef.current) onStatus?.(describeError(error, language)) })
          .finally(() => { if (generation === generationRef.current) setBusy(false) })
      }
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (generation === generationRef.current && recorder.state === 'recording') recorder.stop() } })
      recorder.start(500)
      if (maxSeconds > 0) timerRef.current = setTimeout(() => { if (generation === generationRef.current && recorder.state === 'recording') recorder.stop() }, Math.min(maxSeconds * 1000, 2_147_483_647))
      setRecording(true)
      onStatus?.(language === 'zh-CN' ? '正在录音，再次点击停止并转写' : 'Recording; click again to stop and transcribe')
    } catch (error) { if (generation === generationRef.current) { releaseCapture(); setRecording(false); setBusy(false); onStatus?.(describeError(error, language)) } }
  }
  return <button type="button" className={`voice-record-button ${recording ? 'recording' : ''}`} disabled={(disabled && !recording) || (busy && !recording) || !profile} aria-pressed={recording} onClick={() => recording ? stop() : void start()}>{recording ? (language === 'zh-CN' ? '■ 停止录音' : '■ Stop') : busy ? (language === 'zh-CN' ? '转写中…' : 'Transcribing…') : (language === 'zh-CN' ? '● 语音' : '● Voice')}</button>
}

export default function VoiceDiagnostics({ profile, mode }: { profile: string | null; mode: 'conversation' | 'transcription' | 'speech' }) {
  const { voice } = useDesktop()
  const language = useLanguage()
  const [text, setText] = React.useState(language === 'zh-CN' ? '这是 Hermess 语音播报测试。' : 'This is a Hermess speech test.')
  const [status, setStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const generationRef = React.useRef(0)
  React.useEffect(() => {
    setBusy(false)
    setPlaying(false)
    return () => { generationRef.current++; audioRef.current?.pause(); audioRef.current = null }
  }, [profile, mode])
  const speak = async () => {
    if (!profile || !text.trim()) return
    const generation = generationRef.current
    setBusy(true)
    try {
      const result = await voice.speak({ kind: 'profile', profile }, text.trim())
      if (generation !== generationRef.current) return
      if (!result.data_url) { setStatus(language === 'zh-CN' ? '调试预览不生成真实音频' : 'The debug preview does not generate real audio'); return }
      audioRef.current?.pause()
      const audio = new Audio(result.data_url)
      audioRef.current = audio
      audio.onended = () => { if (generation === generationRef.current) { setPlaying(false); audioRef.current = null } }
      await audio.play()
      if (generation !== generationRef.current) { audio.pause(); return }
      setPlaying(true)
      setStatus(language === 'zh-CN' ? `正在播报${result.provider ? ` · ${result.provider}` : ''}` : `Playing${result.provider ? ` · ${result.provider}` : ''}`)
    } catch (error) { if (generation === generationRef.current) setStatus(describeError(error, language)) }
    finally { if (generation === generationRef.current) setBusy(false) }
  }
  return <section className="voice-diagnostics">
    <h2>{mode === 'speech' ? (language === 'zh-CN' ? '播报试听' : 'Speech test') : (language === 'zh-CN' ? '麦克风与转写测试' : 'Microphone and transcription test')}</h2>
    {mode !== 'speech' && <div className="voice-test-row"><VoiceRecorderButton profile={profile} onTranscript={value => setText(value)} onStatus={setStatus} /><textarea value={text} onChange={event => setText(event.target.value)} rows={3} placeholder={language === 'zh-CN' ? '转写文本会显示在这里，可编辑后确认。' : 'Transcript appears here and remains editable.'} /></div>}
    {mode === 'speech' && <div className="voice-test-row"><textarea value={text} onChange={event => setText(event.target.value)} rows={3} /><div className="actions"><button disabled={busy || !profile || !text.trim()} onClick={() => void speak()}>{language === 'zh-CN' ? '试听播报' : 'Play speech'}</button><button disabled={!playing} onClick={() => { generationRef.current++; audioRef.current?.pause(); audioRef.current = null; setPlaying(false); setBusy(false); setStatus(language === 'zh-CN' ? '已停止播报' : 'Playback stopped') }}>{language === 'zh-CN' ? '停止' : 'Stop'}</button></div></div>}
    <p role="status">{status}</p>
  </section>
}
