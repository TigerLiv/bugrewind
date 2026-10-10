/* BugRewind SDK v1 — local-only, consent-gated, privacy-first structural replay. */
export function initBugRewind({endpoint=location.origin,projectKey,release='development',captureNetwork=true,maskAllText=true}={}){
  if(!projectKey)throw Error('projectKey required');
  const sessionId=crypto.randomUUID();
  let seq=0,active=false,queue=[],sending=false,flushInterval=null,retryTimer=null,observer=null,scheduled=null,lastSnapshot='',lastScroll=0;
  const handlers=[];
  const scrub=(text)=>String(text||'').slice(0,180).replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g,'[email]').replace(/(?:sk-[\w-]+|gh[pousr]_[\w-]+)/g,'[token]');
  const route=()=>location.pathname;
  const selectorOf=(node)=>{
    const el=node?.closest?.('[data-testid]');
    if(el)return '[data-testid="'+String(el.getAttribute('data-testid')).replace(/[^a-zA-Z0-9_-]/g,'')+'"]';
    return node?.tagName?.toLowerCase?.()||'element';
  };
  function emit(kind,label,detail={},snapshot){
    if(!active)return;
    const event={seq:seq++,at:Date.now(),kind,label:scrub(label),detail};
    if(kind==='snapshot')event.snapshot=snapshot;
    queue.push(event);
    if(queue.length>300)queue=queue.slice(-300);
    if(kind==='error'||kind==='network'||queue.length>=30)void flush();
  }
  function safeDom(){
    const body=document.body.cloneNode(true);
    const forbidden=new Set(['SCRIPT','IFRAME','OBJECT','EMBED','FORM','INPUT','TEXTAREA','SELECT','LINK','META','STYLE','IMG','VIDEO','AUDIO','CANVAS','NOSCRIPT']);
    function sanitize(node,allowed=false){
      if(node.nodeType===Node.TEXT_NODE){
        const value=node.textContent||'';
        node.textContent=(!maskAllText||allowed)?scrub(value).slice(0,140):value.trim()?'•••':'';
        return;
      }
      if(node.nodeType!==Node.ELEMENT_NODE){node.remove();return;}
      if(forbidden.has(node.tagName)){node.replaceWith(document.createElement('span'));return;}
      const safe=allowed||node.hasAttribute('data-replay-safe');
      for(const attr of [...node.attributes]){
        if(!['class','data-testid','data-replay-safe','role'].includes(attr.name))node.removeAttribute(attr.name);
        else if(attr.name==='class')node.setAttribute('class',attr.value.replace(/[^a-zA-Z0-9_\- ]/g,'').slice(0,120));
        else if(attr.name==='data-testid')node.setAttribute('data-testid',attr.value.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60));
      }
      for(const child of [...node.childNodes])sanitize(child,safe);
    }
    sanitize(body);
    return body.outerHTML.slice(0,35000);
  }
  function snapshot(reason='state'){
    if(!active)return;
    const html=safeDom();
    if(html!==lastSnapshot){lastSnapshot=html;emit('snapshot',reason,{route:route()},html);}
  }
  function queueSnapshot(){clearTimeout(scheduled);scheduled=setTimeout(()=>snapshot('DOM changed'),320);}
  async function flush(){
    if(!queue.length||sending)return;
    sending=true;
    const batch=queue.slice(0,30);
    try{
      const res=await fetch(endpoint+'/api/v1/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectKey,sessionId,release,route:route(),events:batch}),keepalive:true});
      if(!res.ok)throw Error('Upload failed '+res.status);
      queue.splice(0,batch.length);
    }catch{ /* retain the same sequence numbers for idempotent retry */ }
    finally{sending=false;if(queue.length>0)retryTimer=setTimeout(flush,1800);}
  }
  const add=(target,event,fn,opts)=>{target.addEventListener(event,fn,opts);handlers.push(()=>target.removeEventListener(event,fn,opts));};
  let undoFetch=()=>{};
  function start(){
    if(active)return sessionId;
    active=true;seq=0;queue=[];lastSnapshot='';
    add(document,'click',(ev)=>{const s=selectorOf(ev.target);emit('click','Clicked '+s,{selector:s,route:route()});queueSnapshot();},true);
    add(window,'error',(e)=>{emit('error',scrub(e.message||'Unknown browser exception'),{category:'uncaught',stack:scrub(e.error?.stack||'')});void flush();});
    add(window,'unhandledrejection',(e)=>{const reason=e.reason instanceof Error?e.reason.message:String(e.reason);emit('error',scrub(reason),{category:'unhandledrejection'});void flush();});
    add(window,'popstate',()=>{emit('route','Navigated '+route(),{route:route()});queueSnapshot();});
    add(window,'scroll',()=>{if(Date.now()-lastScroll>800){lastScroll=Date.now();emit('scroll','Scrolled',{y:Math.round(window.scrollY)});}}, {passive:true});
    observer=new MutationObserver(queueSnapshot);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden']});
    const oldFetch=window.fetch;
    if(captureNetwork){
      const patched=async function(input,init){
        const t=performance.now();const method=String(init?.method||input?.method||'GET').toUpperCase();
        const requestPath=(()=>{try{const u=new URL(typeof input==='string'?input:input.url,location.href);return u.origin===location.origin?u.pathname.slice(0,160):'[external]';}catch{return '[unknown]';}})();
        try{const result=await oldFetch.apply(this,arguments);if(active&&(!requestPath.startsWith('/api/v1/ingest')))emit('network',method+' '+requestPath+' → '+result.status,{method,path:requestPath,status:result.status,durationMs:Math.round(performance.now()-t)});return result;}
        catch(error){if(active)emit('network',method+' '+requestPath+' → failed',{method,path:requestPath,status:0,durationMs:Math.round(performance.now()-t)});throw error;}
      };
      window.fetch=patched;
      undoFetch=()=>{if(window.fetch===patched)window.fetch=oldFetch;};
    }
    snapshot('session started');
    flushInterval=setInterval(()=>void flush(),2400);
    return sessionId;
  }
  async function stop(){
    if(!active)return;
    snapshot('session ended');active=false;
    observer?.disconnect();observer=null;handlers.splice(0).forEach(fn=>fn());undoFetch();clearTimeout(scheduled);clearInterval(flushInterval);clearTimeout(retryTimer);
    for(let i=0;i<10&&queue.length;i++)await flush();
  }
  return {sessionId,start,stop,flush,track:(label,detail={})=>emit('note',label,detail),get isActive(){return active;}};
}
