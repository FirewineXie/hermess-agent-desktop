import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endpointForProvider } from '../src/features/models/model.ts'

const endpoint = (id, name, base_url, source = 'providers') => ({
  id, name, base_url, source, model: 'model-a', models: ['model-a'], is_current: false,
})

test('matches a configured provider by its stable config id', () => {
  const rows = [endpoint('first', 'First', 'https://same.example/v1'), endpoint('second', 'Second', 'https://same.example/v1')]
  assert.equal(endpointForProvider({ slug: 'second' }, rows)?.id, 'second')
  assert.equal(endpointForProvider({ slug: 'missing' }, rows), undefined)
})

test('keeps a legacy custom endpoint separate when its route name differs from its id', () => {
  const rows = [endpoint('ollama-local-model', 'Ollama Local — model', 'http://localhost:11434/v1', 'custom_providers')]
  assert.equal(endpointForProvider({ slug: 'custom:ollama-local' }, rows), undefined)
  assert.equal(endpointForProvider({ slug: 'ollama-local-model' }, rows)?.id, 'ollama-local-model')
})

test('does not guess between legacy records with the same route name', () => {
  const rows = [
    endpoint('ollama-one', 'Ollama — one', 'http://localhost:11434/v1', 'custom_providers'),
    endpoint('ollama-two', 'Ollama — two', 'http://localhost:11434/v1', 'custom_providers'),
  ]
  assert.equal(endpointForProvider({ slug: 'custom:ollama' }, rows), undefined)
})
