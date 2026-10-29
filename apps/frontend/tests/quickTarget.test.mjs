import assert from 'node:assert/strict'
import test from 'node:test'
import { sameQuickTarget } from '../src/features/desktop/quickTarget.ts'
test('quick input binds Profile, stored session, runtime epoch and idle state',()=>{
  const target={profile:'writer',sessionId:'session',epoch:'epoch',busy:false}
  assert.equal(sameQuickTarget({...target},target),true)
  assert.equal(sameQuickTarget(null,target),false)
  for(const patch of [{profile:'other'},{sessionId:'other'},{epoch:'other'},{busy:true}]) assert.equal(sameQuickTarget({...target,...patch},target),false)
  assert.equal(sameQuickTarget(target,{...target,busy:true}),false)
})
