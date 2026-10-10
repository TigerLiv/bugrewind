import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=mkdtempSync(path.join(tmpdir(),'bugrewind-smoke-'));
const port=4188;
const child=spawn(process.execPath,['src/server.js'],{cwd:path.resolve('.'),env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_TOKEN:'smoke-token'},stdio:'ignore'});
try {
 let ready=false;
 for(let i=0;i<60;i++){
   try{const res=await fetch('http://127.0.0.1:'+port+'/api/v1/health');if(res.ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
 }
 if(!ready)throw Error('HTTP health check failed');
 const r=await fetch('http://127.0.0.1:'+port+'/api/demo/save',{method:'POST'});
 if(r.status!==500)throw Error('Demo fault injection failed');
 console.log('SMOKE PASS: HTTP server, health, controlled fault endpoint');
}finally{child.kill();rmSync(dir,{recursive:true,force:true});}
