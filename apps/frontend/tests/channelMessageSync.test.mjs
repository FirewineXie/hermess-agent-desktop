import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const controllerUrl = new URL('../src/features/chat/useChatController.ts', import.meta.url)
const externalTurnsUrl = new URL('../src/features/chat/useExternalChannelTurns.ts', import.meta.url)

test('external channel turns show a placeholder then restore authoritative history', async () => {
  const [controller, externalTurns] = await Promise.all([
    readFile(controllerUrl, 'utf8'),
    readFile(externalTurnsUrl, 'utf8'),
  ])

  assert.match(controller, /data\.kind === 'message\.start' && turnStartedAtRef\.current == null/)
  assert.match(controller, /appendMessage\(rows, 'user', t\('ui\.channel\.message\.processing'\), startedAt\)/)
  assert.match(controller, /externalChannelTurns\.sync\(id, data\.profile, externalVersion\)/)
  assert.match(externalTurns, /chat\.resumeSession\(\{ kind: 'session', profile, sessionId \}\)/)
  assert.match(externalTurns, /setConversation\(historyTimeline\(snapshot\.messages, Boolean\(snapshot\.running\)\)\)/)
  assert.match(externalTurns, /versionRef\.current !== version/)
})
