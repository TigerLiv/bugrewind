import {initBugRewind} from './sdk.js';
const $=id=>document.getElementById(id);
let sdk;
const config=await (await fetch('/api/demo/config')).json();
function setStatus(text,detail){$('status').textContent=text;$('help').textContent=detail;}
$('start').onclick=()=>{
  sdk=initBugRewind({projectKey:config.projectKey,release:'demo-1.0.0'});
  const id=sdk.start();
  $('session').textContent=id;
  $('start').disabled=true;
  for(const key of ['save','throw','ok','end'])$(key).disabled=false;
  setStatus('采集已启用','请触发一个合成故障，然后返回控制台查看回放。');
};
$('save').onclick=async()=>{
  setStatus('正在保存…','正在请求模拟 API');
  try{
    const r=await fetch('/api/demo/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!r.ok){setStatus('保存失败：服务器异常','HTTP '+r.status+'，请重试');return;}
    setStatus('保存成功','没有异常');
  }catch{setStatus('保存失败：网络异常','请求未完成');}
};
$('throw').onclick=()=>{
  setStatus('错误已触发','模拟 JavaScript TypeError，查看控制台和故障列表。');
  setTimeout(()=>{const response=null;response.items.map(x=>x.id);},80);
};
$('ok').onclick=async()=>{const r=await fetch('/api/demo/success',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setStatus(r.ok?'保存成功':'保存失败',r.ok?'请求返回 HTTP 200':'请求失败');};
$('end').onclick=async()=>{await sdk?.stop();setStatus('采集已结束','返回控制台查看会话和相关问题。');for(const key of ['save','throw','ok','end'])$(key).disabled=true;};
