/** Generated entirely in the browser; no external media or user files. */
export function createPreviewWav(): Blob {
  const rate = 16000
  const samples = rate
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let index = 0; index < samples; index++) {
    const envelope = Math.min(1, index / 400, (samples - index) / 400)
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / rate * 2 * Math.PI * 440) * 3200 * envelope), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function createPreviewVideo(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const context = canvas.getContext('2d')
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type))
  if (!context || !canvas.captureStream || !mimeType) throw new Error('PREVIEW_ONLY: browser cannot create WebM fixture')
  const stream = canvas.captureStream(10)
  const recorder = new MediaRecorder(stream, { mimeType })
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = []
    let frame = 0
    const timer = window.setInterval(() => {
      context.fillStyle = '#edf5ff'; context.fillRect(0, 0, 320, 180)
      context.fillStyle = '#1b6ffd'; context.fillRect(20 + frame * 9, 50, 48, 48)
      context.fillStyle = '#173b6f'; context.font = '16px system-ui'; context.fillText('PREVIEW_ONLY · WebM', 20, 145)
      frame += 1
      if (frame >= 15) recorder.stop()
    }, 100)
    const cleanup = () => { window.clearInterval(timer); stream.getTracks().forEach(track => track.stop()) }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => { cleanup(); reject(new Error('PREVIEW_ONLY video generation failed')) }
    recorder.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: 'video/webm' })) }
    try { recorder.start() } catch (error) { cleanup(); reject(error) }
  })
}
