import assert from 'node:assert/strict'
import test from 'node:test'
import { delegationError, parseOverrides, routesMatch } from '../src/features/models/delegationModel.ts'

const routing=()=>({configured:'model_map',blocked_reason:null,backends:[{name:'model_map',available:true}],profiles:['default','writer'],model_map:{default:'one',options:[{name:'one',description:'task',provider:'test',model:'model',has_api_key:true}]},profile_routes:{profiles:[],default:null}})
test('validates availability, duplicates, defaults, URLs and partial fallbacks',()=>{
  assert.equal(delegationError(routing()),null)
  const unavailable=routing(); unavailable.backends[0].available=false; assert.ok(delegationError(unavailable))
  const duplicate=routing(); duplicate.model_map.options.push({...duplicate.model_map.options[0]}); assert.ok(delegationError(duplicate))
  const missing=routing();missing.model_map.default='missing';assert.ok(delegationError(missing))
  const bad=routing();bad.model_map.options[0].base_url='https://user:password@example.test';assert.ok(delegationError(bad))
  bad.model_map.options[0].base_url='';bad.model_map.options[0].fallback_providers=[{provider:'test',model:''}];assert.ok(delegationError(bad))
})
test('only accepts bounded JSON objects',()=>{
  assert.deepEqual(parseOverrides('{"temperature":0}'),{temperature:0})
  for(const value of ['[]','null','bad','"text"',`{"a":"${'x'.repeat(16384)}"}`]) assert.throws(()=>parseOverrides(value))
})
test('verifies persisted route content and explicit credential states',()=>{
  const draft=routing(); draft.model_map.options[0].credential={action:'clear'}
  const actual=routing(); assert.equal(routesMatch(draft,actual),false)
  actual.model_map.options[0].has_api_key=false;assert.equal(routesMatch(draft,actual),true)
  actual.model_map.options[0].model='wrong';assert.equal(routesMatch(draft,actual),false)
})

test('readback preserves nested null, empty and client-like JSON keys',()=>{
  const expected=routing()
  expected.model_map.options[0].request_overrides={extra_body:{optional:null,empty:[],has_api_key:false,credential:'custom',nested:{}}}
  const actual=structuredClone(expected)
  assert.equal(routesMatch(expected,actual),true)
  for(const key of ['optional','empty','has_api_key','credential','nested']) {
    const missing=structuredClone(actual)
    delete missing.model_map.options[0].request_overrides.extra_body[key]
    assert.equal(routesMatch(expected,missing),false,key)
  }
})
