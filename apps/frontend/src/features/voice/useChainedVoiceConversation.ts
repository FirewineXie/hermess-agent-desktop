import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { describeError } from '../../app/desktopErrors'
import { useLanguage } from '../../i18n'
import { blobDataUrl } from './audioData'
import { captureDecision } from './voiceConversationPolicy'

type Stage = 'idle' | 'starting' | 'listening' | 'transcribing' | 'thinking' | 'speaking'
type Options = {
  connected: boolean
  visible: boolean
  connectionKey: string
  profile: string | null
  sessionId: string
  turnBusy: boolean
  draft: string
  attachmentCount: number
  assistantMessages: Array<{ text: string }>
  onSubmit: (text: string, options: { voiceTurn: true }) => Promise<boolean | void>
  onStatus: (message: string) => void
}

export function useChainedVoiceConversation(options: Options) {
  const { agentSettings, voice } = useDesktop()
  const language = useLanguage()
  const [stage, setStage] = React.useState<Stage>('idle')
  const stageRef = React.useRef<Stage>('idle')
  const activeRef = React.useRef(false)
  const generationRef = React.useRef(0)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const contextRef = React.useRef<AudioContext | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const responseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const expectedAssistantCountRef = React.useRef(0)
  const settingsRef = React.useRef({ maxMs: 120_000, silenceMs: 1_250 })
  const latestRef = React.useRef(options)
  latestRef.current = options

  const changeStage = (next: Stage) => { stageRef.current = next; setStage(next) }
  const releaseCapture = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (contextRef.current) void contextRef.current.close().catch(() => {})
    contextRef.current = null
  }
  const stop = (report = true) => {
    activeRef.current = false
    generationRef.current += 1
    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current)
    responseTimeoutRef.current = null
    releaseCapture()
    audioRef.current?.pause()
    audioRef.current = null
    stageRef.current = 'idle'
    if (report) {
      setStage('idle')
      latestRef.current.onStatus(language === 'zh-CN' ? '已结束连续语音对话' : 'Voice conversation ended')
    }
  }

  const beginListening = async (generation: number) => {
    if (!activeRef.current || generation !== generationRef.current) return
    const profile = latestRef.current.profile
    if (!profile || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
      latestRef.current.onStatus(language === 'zh-CN' ? '当前 WebView 不支持连续语音采集' : 'Continuous voice capture is unavailable in this WebView')
      stop(false)
      setStage('idle')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!activeRef.current || generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const context = new AudioContext()
      contextRef.current = context
      await context.resume()
      if (!activeRef.current || generation !== generationRef.current) { releaseCapture(); return }
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      let heardSpeech = false
      let lastSpeechAt = 0
      const startedAt = performance.now()
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => {
        if (generation !== generationRef.current) return
        latestRef.current.onStatus(language === 'zh-CN' ? '连续语音录音失败' : 'Voice recording failed')
        stop(false)
        setStage('idle')
      }
      recorder.onstop = () => {
        if (generation !== generationRef.current || !activeRef.current) return
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' })
        releaseCapture()
        if (!heardSpeech || !blob.size) { void beginListening(generation); return }
        void transcribeAndSubmit(blob, generation, profile)
      }
      stream.getAudioTracks().forEach(track => { track.onended = () => {
        if (generation !== generationRef.current || !activeRef.current) return
        latestRef.current.onStatus(language === 'zh-CN' ? '麦克风已断开，语音对话结束' : 'Microphone disconnected; voice conversation ended')
        stop(false)
        setStage('idle')
      } })
      recorder.start(500)
      changeStage('listening')
      latestRef.current.onStatus(language === 'zh-CN' ? '正在聆听；安静后自动发送，点击按钮可结束' : 'Listening; pauses submit speech automatically. Click to end.')
      const sample = () => {
        if (generation !== generationRef.current || !activeRef.current || recorder.state !== 'recording') return
        analyser.getFloatTimeDomainData(samples)
        let power = 0
        for (const value of samples) power += value * value
        const now = performance.now()
        if (Math.sqrt(power / samples.length) >= 0.075) { heardSpeech = true; lastSpeechAt = now }
        const decision = captureDecision(now - startedAt, now - lastSpeechAt, heardSpeech, settingsRef.current.maxMs, settingsRef.current.silenceMs)
        if (decision === 'continue') frameRef.current = requestAnimationFrame(sample)
        else { frameRef.current = null; recorder.stop() }
      }
      frameRef.current = requestAnimationFrame(sample)
    } catch (error) {
      if (generation !== generationRef.current) return
      releaseCapture()
      latestRef.current.onStatus(describeError(error, language))
      stop(false)
      setStage('idle')
    }
  }

  const transcribeAndSubmit = async (blob: Blob, generation: number, profile: string) => {
    if (generation !== generationRef.current || !activeRef.current) return
    changeStage('transcribing')
    try {
      if (blob.size > 20 * 1024 * 1024) throw new Error(language === 'zh-CN' ? '语音片段超过 20 MiB' : 'Voice segment exceeds 20 MiB')
      const dataUrl = await blobDataUrl(blob)
      if (generation !== generationRef.current || !activeRef.current) return
      const result = await voice.transcribe({ kind: 'profile', profile }, { dataUrl, mimeType: blob.type })
      if (generation !== generationRef.current || !activeRef.current) return
      const transcript = result.transcript.trim()
      if (!transcript) { void beginListening(generation); return }
      if (/^(stop|停止|结束对话|退出语音)$/i.test(transcript)) { stop(); return }
      if (latestRef.current.turnBusy || latestRef.current.draft.trim() || latestRef.current.attachmentCount) {
        latestRef.current.onStatus(language === 'zh-CN' ? '聊天输入已变化，语音对话已停止以避免覆盖草稿' : 'Chat input changed; voice conversation stopped to preserve the draft')
        stop(false)
        setStage('idle')
        return
      }
      expectedAssistantCountRef.current = latestRef.current.assistantMessages.length
      changeStage('thinking')
      latestRef.current.onStatus(language === 'zh-CN' ? '正在发送语音转写并等待回复' : 'Sending transcript and waiting for a reply')
      responseTimeoutRef.current = setTimeout(() => {
        if (generation !== generationRef.current || stageRef.current !== 'thinking') return
        latestRef.current.onStatus(language === 'zh-CN' ? '等待语音回复超时，连续对话已结束' : 'Voice reply timed out; conversation ended')
        stop(false)
        setStage('idle')
      }, 180_000)
      const submitted = await latestRef.current.onSubmit(transcript, { voiceTurn: true })
      if (generation !== generationRef.current || !activeRef.current) return
      if (submitted !== true) { stop(false); setStage('idle'); return }
    } catch (error) {
      if (generation !== generationRef.current) return
      latestRef.current.onStatus(describeError(error, language))
      stop(false)
      setStage('idle')
    }
  }

  const speakReply = async (text: string, generation: number) => {
    if (!activeRef.current || generation !== generationRef.current) return
    const profile = latestRef.current.profile
    if (!profile) return
    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current)
    responseTimeoutRef.current = null
    changeStage('speaking')
    try {
      const result = await voice.speak({ kind: 'profile', profile }, text)
      if (generation !== generationRef.current || !activeRef.current) return
      if (!result.data_url) {
        latestRef.current.onStatus(language === 'zh-CN' ? '语音播报没有返回音频，连续对话已结束' : 'Speech returned no audio; conversation ended')
        stop(false); setStage('idle'); return
      }
      const audio = new Audio(result.data_url)
      audioRef.current = audio
      audio.onended = () => { if (generation === generationRef.current && activeRef.current) { audioRef.current = null; void beginListening(generation) } }
      audio.onerror = () => { if (generation === generationRef.current && activeRef.current) { latestRef.current.onStatus(language === 'zh-CN' ? '语音播放失败，连续对话已结束' : 'Speech playback failed; conversation ended'); stop(false); setStage('idle') } }
      await audio.play()
      if (generation !== generationRef.current || !activeRef.current) audio.pause()
    } catch (error) {
      if (generation !== generationRef.current) return
      latestRef.current.onStatus(describeError(error, language))
      stop(false)
      setStage('idle')
    }
  }

  const start = async () => {
    const { connected, profile, turnBusy, draft, attachmentCount } = latestRef.current
    if (!connected || !profile || turnBusy || draft.trim() || attachmentCount || activeRef.current) return
    activeRef.current = true
    changeStage('starting')
    const generation = ++generationRef.current
    try {
      const config = await agentSettings.config({ kind: 'profile', profile })
      if (generation !== generationRef.current || !activeRef.current) return
      const voiceConfig = config.voice as Record<string, unknown> | undefined
      const sttConfig = config.stt as Record<string, unknown> | undefined
      if (voiceConfig?.voice_chat_mode === 'gpt-live') {
        latestRef.current.onStatus(language === 'zh-CN' ? 'GPT Live 对话路径尚未接入，不能改走 chained 模式' : 'GPT Live is not connected; chained mode will not be substituted')
        stop(false); setStage('idle'); return
      }
      if (sttConfig?.enabled === false) {
        latestRef.current.onStatus(language === 'zh-CN' ? '请先在语音设置中启用转写' : 'Enable speech transcription in Voice settings first')
        stop(false); setStage('idle'); return
      }
      const max = voiceConfig?.max_recording_seconds
      const silence = voiceConfig?.silence_duration
      settingsRef.current = {
        maxMs: typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.min(max * 1000, 600_000) : 120_000,
        silenceMs: typeof silence === 'number' && Number.isFinite(silence) && silence > 0 ? Math.min(Math.max(silence * 1000, 400), 10_000) : 1_250,
      }
      await beginListening(generation)
    } catch (error) {
      if (generation !== generationRef.current) return
      latestRef.current.onStatus(describeError(error, language))
      stop(false)
      setStage('idle')
    }
  }

  React.useEffect(() => {
    if (!activeRef.current || stageRef.current !== 'thinking' || options.turnBusy) return
    const latest = options.assistantMessages.at(-1)
    if (options.assistantMessages.length > expectedAssistantCountRef.current && latest?.text.trim()) void speakReply(latest.text, generationRef.current)
  }, [options.assistantMessages.length, options.turnBusy, stage])

  const previousSessionRef = React.useRef(options.sessionId)
  React.useEffect(() => {
    const previous = previousSessionRef.current
    previousSessionRef.current = options.sessionId
    if (activeRef.current && previous && previous !== options.sessionId) stop()
  }, [options.sessionId])
  React.useEffect(() => {
    if (activeRef.current) stop()
    return () => { if (activeRef.current) stop(false) }
  }, [options.connectionKey, options.profile])
  React.useEffect(() => {
    if (activeRef.current && (!options.connected || !options.visible || options.draft.trim() || options.attachmentCount
      || (stageRef.current === 'listening' && options.turnBusy))) stop()
  }, [options.connected, options.visible, options.turnBusy, options.draft, options.attachmentCount])

  return { active: stage !== 'idle', stage, toggle: () => activeRef.current ? stop() : void start() }
}
