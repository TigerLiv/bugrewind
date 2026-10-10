import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {redact,safeDetail} from '../src/security.js';
import {ruleDiagnosis} from '../src/diagnosis.js';
import {makeDraft} from '../src/reproduction.js';

function fixture(){const dir=mkdtempSync(path.join(tmpdir(),'bugrewind-test-'));const store=new Store(dir);return {store,close(){store.close();rmSync(dir,{recursive:true,force:true});}};}
function payload(sessionId,events){return {projectKey:'demo-public-key',sessionId,release:'test',route:'/demo',events};}
const uuid='11111111-1111-4111-8111-111111111111';

test('redaction removes basic emails/tokens and keys',()=>{
  assert.doesNotMatch(redact('user@test.dev Authorization: Bearer abc123 sk-supersecret'),/user@test|abc123|sk-supersecret/);
  assert.deepEqual(safeDetail({status:500,Authorization:'Bearer xxx',body:{secret:'x'},nested:{ok:true}}),{status:500,nested:{ok:true}});
});
test('SQLite persists and deduplicates same event sequence',()=>{
  const f=fixture();try{
    const p=payload(uuid,[{seq:0,at:Date.now(),kind:'network',label:'POST /api/demo/save → 500',detail:{status:500,path:'/api/demo/save'}},
      {seq:1,at:Date.now(),kind:'error',label:'TypeError null',detail:{category:'uncaught'}}]);
    assert.equal(f.store.ingest(p).accepted,2);
    assert.equal(f.store.ingest(p).accepted,0);
    assert.equal(f.store.summary().sessions,1);
    assert.equal(f.store.summary().networkFailures,1);
    assert.equal(f.store.issues().length,2);
    assert.equal(f.store.issues().reduce((a,x)=>a+x.occurrences,0),2);
  }finally{f.close();}
});
test('snapshot compressed roundtrip + rejects unsafe markup',()=>{
 const f=fixture();try{
  f.store.ingest(payload(uuid,[{seq:0,at:Date.now(),kind:'snapshot',label:'start',snapshot:'<body><p>•••</p></body>',detail:{}}]));
  assert.equal(f.store.snapshot(uuid,0).html,'<body><p>•••</p></body>');
  assert.throws(()=>f.store.ingest(payload(uuid,[{seq:1,at:Date.now(),kind:'snapshot',label:'bad',snapshot:'<script>alert(1)</script>',detail:{}}])),/Unsafe replay/);
  assert.throws(()=>f.store.ingest(payload(uuid,[{seq:1,at:Date.now(),kind:'snapshot',label:'bad',snapshot:'<div onclick="x()"></div>',detail:{}}])),/Unsafe replay/);
 }finally{f.close();}
});
test('rules diagnosis cites existing event IDs and remains hypothetical',()=>{
 const f=fixture();try{
  f.store.ingest(payload(uuid,[{seq:0,at:Date.now()-1000,kind:'network',label:'POST /api/demo/save → 500',detail:{status:500}},{seq:1,at:Date.now(),kind:'error',label:'TypeError null',detail:{}}]));
  const issue=f.store.issues().find(x=>x.kind==='error');
  const result=ruleDiagnosis(f.store.context(issue.id));
  assert.equal(result.status,'hypothesis');
  assert.ok(result.evidenceIds.some(x=>/^event:\d+$/.test(x)));
  const draft=makeDraft(issue);
  assert.match(draft.script,/getByTestId/);
 }finally{f.close();}
});
test('deleting session removes errors and dependent issue groups',()=>{
 const f=fixture();try{
  f.store.ingest(payload(uuid,[{seq:0,at:Date.now(),kind:'error',label:'a test error',detail:{}}]));
  f.store.deleteSession(uuid);
  assert.equal(f.store.summary().sessions,0);
  assert.equal(f.store.issues().length,0);
 }finally{f.close();}
});
