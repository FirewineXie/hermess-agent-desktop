import assert from 'node:assert/strict'
import test from 'node:test'
import {fieldOwner,pageFields,editableField,visibleSchemaFields,parseField,allowlistFromText} from '../src/features/configuration/model.ts'

test('visible runtime fields have one owner and unknown fields remain discoverable',()=>{
  const mapping={'command_allowlist':'security-approvals','security.approval.transport':'security-approvals','approvals.mode':'security-approvals','security.redact_secrets':'security-privacy','checkpoints.enabled':'security-checkpoints','terminal.timeout':'advanced-terminal','tool_output.limit':'advanced-output','agent.max_turns':'advanced-runtime','toolsets':'advanced-tools','agent.tool_use_enforcement':'advanced-tools','future.new_field':'advanced-config','delegation.backend':'delegation','delegation.model':'auxiliary','delegation.provider':'auxiliary','auxiliary.compression.model':'auxiliary','auxiliary.compression.no_progress_timeout':'memory-context','memory.provider':'memory-persistent','agent.reasoning_effort':'main','fallback_providers':'fallbacks'}
  for(const [key,owner] of Object.entries(mapping)) assert.equal(fieldOwner(key),owner,key)
})

test('Hermes shared metrics are hidden while other settings retain their existing visibility',()=>{
  const fields={
    'security.redact_secrets':{type:'boolean'},
    'security.token':{type:'string'},
    'security.future':{type:'unknown'},
    'telemetry.shared_metrics':{type:'object'},
    'telemetry.shared_metrics.enabled':{type:'boolean'},
    'telemetry.shared_metrics.send':{type:'boolean'},
    'telemetry.shared_metrics.endpoint':{type:'string'},
    'telemetry.shared_metrics.offer_version':{type:'number'},
    'telemetry.other_metrics.enabled':{type:'boolean'},
  }
  const schema={fields,category_order:[]}
  assert.deepEqual(visibleSchemaFields(schema).map(([key])=>key),[
    'security.redact_secrets','security.token','security.future','telemetry.other_metrics.enabled',
  ])
  assert.deepEqual(pageFields(schema,'security-privacy').map(([key])=>key),['security.redact_secrets'])
  assert.deepEqual(pageFields(schema,'advanced-config').map(([key])=>key),['telemetry.other_metrics.enabled'])
  assert.equal(editableField('new.secret',{type:'string'}),false)
})

test('field parsing validates boolean, select, list and object semantics',()=>{
  assert.throws(()=>parseField('oops',{type:'boolean'}))
  assert.throws(()=>parseField('missing',{type:'select',options:['safe','manual']}))
  assert.throws(()=>parseField('[]',{type:'object'}))
  assert.throws(()=>parseField('{}',{type:'list'}))
  assert.deepEqual(parseField('{"kept":null}',{type:'object'}),{kept:null})
  assert.deepEqual(allowlistFromText('["first","second"]'),['first','second'])
  assert.throws(()=>allowlistFromText('[{"bad":1}]'))
})

test('auto archive owns only its switch and idle threshold, leaving deletion settings in advanced',()=>{
  const fields={
    'sessions.auto_archive':{type:'boolean'},
    'sessions.auto_archive_days':{type:'number'},
    'sessions.auto_prune':{type:'boolean'},
    'sessions.retention_days':{type:'number'},
  }
  assert.deepEqual(pageFields({fields,category_order:[]},'session-auto-archive').map(([key])=>key),[
    'sessions.auto_archive','sessions.auto_archive_days',
  ])
  assert.equal(fieldOwner('sessions.auto_prune'),'advanced-config')
  assert.equal(fieldOwner('sessions.retention_days'),'advanced-config')
})
