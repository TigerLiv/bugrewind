import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.js';
import {assert, validId} from './security.js';
import {ruleDiagnosis,modelDiagnosis} from './diagnosis.js';
import {makeDraft,verifyDemo} from './reproduction.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.resolve(process.env.DATA_DIR || path.join(root,'data'));
fs.mkdirSync(dir,{recursive:true});
const port=Number(process.env.PORT||4177), host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost'].includes(host)) throw Error('This single-user workstation only binds to localhost.');
const tokenFile=path.join(dir,'admin-token.txt');
const adminToken=process.env.ADMIN_TOKEN||(fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():crypto.randomBytes(24).toString('hex'));
if(!process.env.ADMIN_TOKEN&&!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,adminToken,{mode:0o600});
const store=new Store(dir);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const publicRoot=path.join(root,'public');
const respond=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
const fail=(e,res)=>respond(res,e.status||500,{error:e.status?e.message:'Internal server error'});
async function readBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;assert(size<=200000,'Payload is too large',413);chunks.push(chunk);}
  const data=Buffer.concat(chunks).toString();
  try{return JSON.parse(data||'{}');}catch{throw Object.assign(new Error('Expected JSON'),{status:400});}
}
function authorized(req){const sent=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const a=Buffer.from(sent),b=Buffer.from(adminToken);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function ensureAdmin(req){assert(authorized(req),'请输入控制台访问令牌',401);}
function checkOrigin(req){
  const origin=req.headers.origin;
  if(origin){const parsed=new URL(origin);assert(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.port===String(port),'Origin not allowed',403);}
}
async function app(req,res){
  try{
    const incomingHost=String(req.headers.host||'');
    assert([`127.0.0.1:${port}`,`localhost:${port}`].includes(incomingHost),'Host not allowed',403);
    checkOrigin(req);
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    const pathname=url.pathname;
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(pathname.startsWith('/api/')){
      if(pathname==='/api/v1/health'&&req.method==='GET')return respond(res,200,{ok:true,version:'1.0.0',mode:'local-only'});
      if(pathname==='/api/demo/config'&&req.method==='GET')return respond(res,200,{projectKey:'demo-public-key'});
      if(pathname==='/api/demo/save'&&req.method==='POST')return respond(res,500,{code:'DEMO_FAILURE',message:'Synthetic failure for testing only'});
      if(pathname==='/api/demo/success'&&req.method==='POST')return respond(res,200,{ok:true});
      if(pathname==='/api/v1/ingest'&&req.method==='POST')return respond(res,202,store.ingest(await readBody(req)));
      ensureAdmin(req);
      if(pathname==='/api/v1/bootstrap'&&req.method==='GET')return respond(res,200,{summary:store.summary(),sessions:store.sessions(),issues:store.issues(),modelAvailable:Boolean(process.env.LLM_API_KEY&&process.env.LLM_MODEL),project:{id:'demo',key:'demo-public-key'}});
      if(pathname==='/api/v1/sessions'&&req.method==='GET')return respond(res,200,{items:store.sessions()});
      if(pathname==='/api/v1/issues'&&req.method==='GET')return respond(res,200,{items:store.issues()});
      const session=pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);
      if(session&&validId(session[1])&&req.method==='GET'){
        const record=store.session(session[1]);assert(record,'Session not found',404);
        return respond(res,200,{session:record,events:store.events(record.id)});
      }
      if(session&&validId(session[1])&&req.method==='DELETE'){
        assert(store.session(session[1]),'Session not found',404);
        store.deleteSession(session[1]);return respond(res,200,{deleted:true});
      }
      const snapshot=pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/snapshots\/(\d+)$/);
      if(snapshot&&validId(snapshot[1])&&req.method==='GET'){
        const result=store.snapshot(snapshot[1],Number(snapshot[2]));assert(result,'Snapshot not found',404);
        return respond(res,200,result);
      }
      const issue=pathname.match(/^\/api\/v1\/issues\/(iss_[a-f0-9]{28})$/);
      if(issue&&req.method==='GET'){
        const data=store.issue(issue[1]);assert(data,'Issue not found',404);
        return respond(res,200,{...data,diagnoses:store.diagnoses(issue[1])});
      }
      const diagnose=pathname.match(/^\/api\/v1\/issues\/(iss_[a-f0-9]{28})\/diagnose$/);
      if(diagnose&&req.method==='POST'){
        const body=await readBody(req);
        assert(['rules','llm'].includes(body.mode),'Invalid diagnosis mode');
        const context=store.context(diagnose[1]);assert(context,'Issue not found',404);
        const report=body.mode==='llm'?await modelDiagnosis(context):ruleDiagnosis(context);
        return respond(res,200,store.saveDiagnosis(diagnose[1],body.mode,'hypothesis',report));
      }
      const reproduce=pathname.match(/^\/api\/v1\/issues\/(iss_[a-f0-9]{28})\/reproduce$/);
      if(reproduce&&req.method==='POST'){
        const issue=store.issue(reproduce[1]);assert(issue,'Issue not found',404);
        const draft=makeDraft(issue,`http://127.0.0.1:${port}`);
        return respond(res,200,{...store.saveRepro(issue.id,draft.script),scenario:draft.scenario,caveat:draft.caveat});
      }
      const verify=pathname.match(/^\/api\/v1\/reproductions\/([a-f0-9-]{36})\/verify$/i);
      if(verify&&req.method==='POST'){
        const record=store.reproduction(verify[1]);assert(record,'Reproduction not found',404);
        const issue=store.issue(record.issue_id);assert(issue,'Issue not found',404);
        const draft=makeDraft(issue,`http://127.0.0.1:${port}`);
        const result=await verifyDemo(`http://127.0.0.1:${port}`,draft.scenario);
        return respond(res,200,store.updateRepro(record.id,result.status,result));
      }
      return respond(res,404,{error:'Unknown API endpoint'});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return respond(res,405,{error:'Method not allowed'});
    let requested=pathname==='/'?'index.html':pathname==='/demo'?'demo.html':pathname.slice(1);
    assert(!requested.includes('..')&&!requested.includes('\\'),'Bad path',400);
    const full=path.resolve(publicRoot,requested);
    assert(full.startsWith(publicRoot+path.sep),'Invalid public path',403);
    const ext=path.extname(full);
    assert(mime[ext]&&fs.existsSync(full)&&fs.statSync(full).isFile(),'Not found',404);
    res.writeHead(200,{'Content-Type':mime[ext],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"});
    fs.createReadStream(full).pipe(res);
  }catch(error){if(!res.headersSent)fail(error,res);else res.end();}
}
const server=http.createServer(app);
server.requestTimeout=20000;
const sweep=setInterval(()=>{try{store.retention(7);}catch(e){console.error('Retention:',e.message);}},3600000).unref();
server.listen(port,host,()=>console.log(`\nBugRewind listening at http://${host}:${port}\nConsole access token: ${adminToken}\nDemo: http://${host}:${port}/demo\n`));
function close(){clearInterval(sweep);server.close(()=>{store.close();process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
