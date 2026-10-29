import assert from 'node:assert/strict'
import test from 'node:test'
import {fieldOwner,pageFields,editableField,parseField,allowlistFromText} from '../src/features/configuration/model.ts'

test('every runtime field has one owner and unknown fields remain discoverable',()=>{
  const mapping={'command_allowlist':'security-approvals','security.approval.transport':'security-approvals','approvals.mode':'security-approvals','security.redact_secrets':'security-privacy','telemetry.shared_metrics.enabled':'security-privacy','checkpoints.enabled':'security-checkpoints','terminal.timeout':'advanced-terminal','tool_output.limit':'advanced-output','agent.max_turns':'advanced-runtime','toolsets':'advanced-tools','agent.tool_use_enforcement':'advanced-tools','future.new_field':'advanced-config','delegation.backend':'delegation','auxiliary.compression.model':'memory-context','memory.provider':'memory-persistent','agent.reasoning_effort':'main','fallback_providers':'fallbacks'}
  for(const [key,owner] of Object.entries(mapping)) assert.equal(fieldOwner(key),owner,key)
})

test('specialized consent, sensitive and unsupported fields cannot use the generic editor',()=>{
  const fields={'security.redact_secrets':{type:'boolean'},'telemetry.shared_metrics.enabled':{type:'boolean'},'telemetry.shared_metrics.send':{type:'boolean'},'telemetry.shared_metrics.offer_version':{type:'number'},'security.token':{type:'string'},'security.future':{type:'unknown'}}
  assert.deepEqual(pageFields({fields,category_order:[]},'security-privacy').map(([key])=>key),['security.redact_secrets'])
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
