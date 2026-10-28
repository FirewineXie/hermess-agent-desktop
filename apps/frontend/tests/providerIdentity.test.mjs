import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endpointForProvider, savedModelFromOptions } from '../src/features/models/model.ts'

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

test('labels the saved provider even when model options still mark the previous provider current', () => {
  const options = { providers: [
    { slug: 'openai', name: 'OpenAI', api_url: 'https://api.openai.com/v1', is_current: true, models: ['gpt-5.2'] },
    { slug: 'anthropic', name: 'Anthropic', api_url: 'https://api.anthropic.com', models: ['claude-sonnet-4-5'] },
  ] }
  assert.deepEqual(savedModelFromOptions(options, {
    provider: 'anthropic', model: 'claude-sonnet-4-5', base_url: '',
  }), {
    provider: 'anthropic', model: 'claude-sonnet-4-5', name: 'Anthropic', baseUrl: 'https://api.anthropic.com',
  })
})
