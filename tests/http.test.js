import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
const port='4191',base='http://127.0.0.1:'+port,token='test-admin-token';
const dir=mkdtempSync(path.join(tmpdir(),'bugrewind-http-'));
let child;
const headers={Authorization:'Bearer '+token};
const post=(url,body,h={})=>fetch(base+url,{method:'POST',headers:{...headers,'Content-Type':'application/json',...h},body:JSON.stringify(body)});

before(async()=>{
 child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:port,DATA_DIR:dir,ADMIN_TOKEN:token},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timed out')),8000);child.stdout.on('data',d=>{if(String(d).includes('BugRewind listening')){clearTimeout(t);resolve();}});child.on('exit',code=>{clearTimeout(t);reject(Error('server exited '+code));});});
});
after(()=>{child?.kill();rmSync(dir,{recursive:true,force:true});});

test('local health and dashboard require admin bearer',async()=>{
 assert.equal((await fetch(base+'/api/v1/health')).status,200);
 assert.equal((await fetch(base+'/api/v1/bootstrap')).status,401);
 const dashboard=await (await fetch(base+'/api/v1/bootstrap',{headers})).json();
 assert.equal(dashboard.project.key,'demo-public-key');
});
test('rejects mismatched origin and host',async()=>{
 assert.equal((await fetch(base+'/api/v1/health',{headers:{Origin:'https://evil.example'}})).status,403);
 const status=await new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:Number(port),path:'/api/v1/health',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
 assert.equal(status,403);
});
test('ingest, session replay, issue grouping, rules diagnosis, reproduction and deletion',async()=>{
 const sessionId='22222222-2222-4222-8222-222222222222';
 const now=Date.now();
 const payload={projectKey:'demo-public-key',sessionId,route:'/demo',release:'test',events:[
 {seq:0,at:now-500,kind:'snapshot',label:'start',detail:{},snapshot:'<body><h1>•••</h1></body>'},
 {seq:1,at:now-300,kind:'click',label:'Clicked [data-testid="save-error"]',detail:{selector:'[data-testid="save-error"]'}},
 {seq:2,at:now-150,kind:'network',label:'POST /api/demo/save → 500',detail:{status:500,path:'/api/demo/save'}},
 {seq:3,at:now,kind:'error',label:'TypeError Cannot read properties of null',detail:{category:'uncaught'}}]};
 const submitted=await post('/api/v1/ingest',payload,{'Authorization':''});
 assert.equal(submitted.status,202);
 assert.equal((await submitted.json()).accepted,4);
 const again=await post('/api/v1/ingest',payload,{'Authorization':''});
 assert.equal((await again.json()).accepted,0);
 const session=await (await fetch(base+'/api/v1/sessions/'+sessionId,{headers})).json();
 assert.equal(session.events.length,4);
 const snap=await (await fetch(base+'/api/v1/sessions/'+sessionId+'/snapshots/0',{headers})).json();
 assert.match(snap.html,/h1/);
 const issues=await (await fetch(base+'/api/v1/issues',{headers})).json();
 assert.equal(issues.items.length,2);
 const issue=issues.items.find(x=>x.kind==='network');
 const diagnosis=await (await post('/api/v1/issues/'+issue.id+'/diagnose',{mode:'rules'})).json();
 assert.equal(diagnosis.mode,'rules');assert.equal(diagnosis.report.status,'hypothesis');
 const repro=await (await post('/api/v1/issues/'+issue.id+'/reproduce',{})).json();
 assert.match(repro.script,/getByTestId/);
 const verification=await (await post('/api/v1/reproductions/'+repro.id+'/verify',{})).json();
 assert.equal(verification.status,'passed');
 assert.equal(verification.result.method,'HTTP contract check');
 const removed=await fetch(base+'/api/v1/sessions/'+sessionId,{method:'DELETE',headers});
 assert.equal(removed.status,200);
 assert.equal((await (await fetch(base+'/api/v1/issues',{headers})).json()).items.length,0);
});
test('rejects invalid event payloads and excessive bodies',async()=>{
 const basePayload={projectKey:'demo-public-key',sessionId:'33333333-3333-4333-8333-333333333333',events:[{seq:0,at:Date.now(),kind:'other',label:'bad'}]};
 assert.equal((await post('/api/v1/ingest',basePayload)).status,400);
 assert.equal((await post('/api/v1/ingest',{...basePayload,events:[{seq:0,at:Date.now(),kind:'snapshot',label:'unsafe',snapshot:'<script>evil()</script>'}]})).status,400);
 assert.equal((await post('/api/v1/ingest',{...basePayload,data:'x'.repeat(210000)})).status,413);
 assert.equal((await post('/api/v1/issues/iss_aaaaaaaaaaaaaaaaaaaaaaaaaaaa/diagnose',{mode:'llm'})).status,404);
});
