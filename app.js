'use strict';
const $ = id => document.getElementById(id);
const labels = ['Angry','Disgust','Fear','Happy','Neutral','Sad','Surprise'];
const config = window.MORPHCAST_CONFIG || {};
let running=false, busy=false, controller=null, listeners=[], timer=null, safety=null, watchdog=null, records=[], session=null, last={}, scriptPromise=null, initializedKey=null, initializedExtra=null;
$('key').value=config.licenseKey || '';
labels.forEach(name=>{const row=document.createElement('div');row.className='barrow';row.innerHTML=`<span>${name}</span><div class="track"><div class="fill" id="bar${name}"></div></div><output id="val${name}">—</output>`;$('bars').append(row);});
function status(message){$('status').textContent=message;}
function controls(){['mode','key','extra','consent'].forEach(id=>$(id).disabled=running||busy);$('start').disabled=running||busy;$('stop').disabled=!running||busy;}
function clearMetrics(){['faces','dominant','attention','arousal','valence'].forEach(id=>$(id).textContent='—');labels.forEach(n=>{$('bar'+n).style.width='0%';$('val'+n).textContent='—';});}
function updateMode(){const live=$('mode').value==='live';$('start').textContent=live?'Start live test':'Start demo';$('badge').textContent=live?'LIVE / SDK':'DEMO / SIMULATED';$('cameraLabel').textContent=live?'Camera starts with your permission':'No camera required';$('cameraHint').textContent=live?'Paste your license and agree to the camera test.':'Start a demo to explore the dashboard.';}
$('mode').onchange=updateMode;
function record(module,payload){if(!running)return;const event={timestamp:new Date().toISOString(),elapsed_ms:Math.round(performance.now()-session.clock),mode:session.mode,module,payload};records.push(event);last[module]=Date.now();$('count').textContent=records.length;$('csv').disabled=$('json').disabled=false;$('raw').textContent=JSON.stringify(event,null,2);
const out=payload.output||{};
if(module==='FACE_DETECTOR'){$('faces').textContent=payload.totalFaces??'—';if(payload.totalFaces===0){clearMetrics();$('faces').textContent='0';}}
if(module==='FACE_EMOTION'){let dominant=out.dominantEmotion;if(!dominant&&out.emotion)dominant=Object.entries(out.emotion).sort((a,b)=>b[1]-a[1])[0]?.[0];$('dominant').textContent=dominant||'—';labels.forEach(n=>{const v=out.emotion?.[n];$('bar'+n).style.width=Number.isFinite(v)?`${Math.min(100,Math.max(0,v*100))}%`:'0%';$('val'+n).textContent=Number.isFinite(v)?(v*100).toFixed(1)+'%':'—';});}
if(module==='FACE_ATTENTION')$('attention').textContent=Number.isFinite(out.attention)?(out.attention*100).toFixed(1)+'%':'—';
if(module==='FACE_AROUSAL_VALENCE')['arousal','valence'].forEach(n=>$(n).textContent=Number.isFinite(out[n])?out[n].toFixed(3):'—');
if(records.length>=20000)void stop('Stopped at 20,000 events. Export before starting again.');}
function listen(name,fn){window.addEventListener(name,fn);listeners.push([name,fn]);}
function detach(){listeners.forEach(([n,f])=>window.removeEventListener(n,f));listeners=[];}
function loadScript(){if(window.CY)return Promise.resolve();if(scriptPromise)return scriptPromise;scriptPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');let done=false;const end=(err)=>{if(done)return;done=true;clearTimeout(timeout);if(err){script.remove();reject(err);}else resolve();};const timeout=setTimeout(()=>end(new Error('SDK download timed out. Check internet access, then reload the page.')),30000);script.src=config.sdkUrl||'https://ai-sdk.morphcast.com/v1.17/ai-sdk.js';script.onload=()=>end(window.CY?null:new Error('SDK loaded without CY. Reload the page.'));script.onerror=()=>end(new Error('SDK download failed. Check network access to ai-sdk.morphcast.com.'));document.head.append(script);});return scriptPromise;}
async function stop(message='Session stopped. Results are ready to export.'){if(busy)return;running=false;busy=true;clearInterval(timer);clearInterval(watchdog);clearTimeout(safety);detach();controls();try{if(controller)await controller.stop();}catch(e){message='Stop could not be confirmed. Close this tab to release the camera.';}finally{busy=false;$('camera').hidden=true;$('placeholder').hidden=false;clearMetrics();if(session)session.endedAt=new Date().toISOString();status(message);controls();}}
$('stop').onclick=()=>stop();
$('start').onclick=async()=>{
const mode=$('mode').value,key=$('key').value.trim(),extra=$('extra').checked;
if(mode==='live'&&!key)return status('Paste your MorphCast SDK license key first, or choose Demo.');
if(mode==='live'&&!$('consent').checked)return status('Please agree to use your camera before starting Live mode.');
if(mode==='live'&&!window.isSecureContext)return status('Live mode needs HTTPS or localhost. Use your GitHub Pages URL.');
if(mode==='live'&&controller&&(key!==initializedKey||extra!==initializedExtra))return status('Export your results, then reload the page before changing the license or modules.');
busy=true;controls();records=[];last={};clearMetrics();$('raw').textContent='Waiting for events…';$('count').textContent='0';$('csv').disabled=$('json').disabled=true;session={id:new Date().toISOString().replace(/[:.]/g,'-'),mode,startedAt:new Date().toISOString(),clock:performance.now(),optionalModules:extra,sdkUrl:mode==='live'?config.sdkUrl:null};status(mode==='demo'?'Starting simulated session…':'Loading MorphCast. Please allow camera access when prompted.');
try{
if(mode==='live'){
await loadScript();const modules=CY.modules();
if(!controller){let builder=CY.loader().licenseKey(key).addModule(modules.FACE_DETECTOR.name).addModule(modules.FACE_EMOTION.name);
if(extra)builder=builder.addModule(modules.FACE_ATTENTION.name).addModule(modules.FACE_AROUSAL_VALENCE.name);
builder=builder.runErrorHandler(()=>{if(running&&!busy)void stop('SDK runtime error. Check license, camera and connectivity; reload to retry.');});
controller=await builder.load();initializedKey=key;initializedExtra=extra;}
const enabled=['FACE_DETECTOR','FACE_EMOTION',...(extra?['FACE_ATTENTION','FACE_AROUSAL_VALENCE']:[])];enabled.forEach(n=>listen(modules[n].eventName,e=>record(n,e.detail)));
listen(modules.CAMERA.eventName,e=>{if(!running)return;const frame=e.detail;if(frame?.width&&frame?.height){const canvas=$('camera');canvas.width=frame.width;canvas.height=frame.height;canvas.getContext('2d').putImageData(frame,0,0);canvas.hidden=false;$('placeholder').hidden=true;}});
running=true;await controller.start();status('Live SDK started. Waiting for analysis events…');
}else{running=true;timer=setInterval(()=>{const values=labels.map((_,i)=>.03+Math.pow((1+Math.sin(Date.now()/1600+i))/2,5));const sum=values.reduce((a,b)=>a+b,0);const emotion=Object.fromEntries(labels.map((n,i)=>[n,values[i]/sum]));record('FACE_DETECTOR',{totalFaces:1});record('FACE_EMOTION',{output:{emotion,dominantEmotion:labels[values.indexOf(Math.max(...values))]}});if(extra){record('FACE_ATTENTION',{output:{attention:.65+.25*Math.sin(Date.now()/3500)}});record('FACE_AROUSAL_VALENCE',{output:{arousal:Math.sin(Date.now()/4000)*.6,valence:Math.cos(Date.now()/5000)*.7}});}},500);status('Demo running. All values are simulated; no camera or SDK connection.');}
busy=false;controls();safety=setTimeout(()=>stop('10-minute test limit reached. Export your results.'),600000);
watchdog=setInterval(()=>{if(!running||mode!=='live')return;const now=Date.now();if(last.FACE_EMOTION&&now-last.FACE_EMOTION<3000)status('Live analysis receiving data.');else{clearMetrics();status('No recent emotion output. Check your face position, lighting, camera and license.');}if(!last.FACE_ATTENTION||now-last.FACE_ATTENTION>3000)$('attention').textContent='—';if(!last.FACE_AROUSAL_VALENCE||now-last.FACE_AROUSAL_VALENCE>3000){$('arousal').textContent=$('valence').textContent='—';}},2000);
}catch(error){running=false;detach();if(controller){try{await controller.stop();}catch{}}busy=false;controls();$('camera').hidden=true;$('placeholder').hidden=false;const message=String(error?.message||error).split(key||'UNMATCHABLE_KEY').join('[key removed]');status('Could not start: '+message+' Export any results, then reload to retry.');}
};
function download(ext,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`morphcast-${session.mode}-${session.id}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('json').onclick=()=>{const {clock,...metadata}=session;download('json',JSON.stringify({schemaVersion:1,session:metadata,exportedAt:new Date().toISOString(),notice:session.mode==='demo'?'SIMULATED DATA':'Model estimates; not verified psychological states',events:records},null,2),'application/json');};
const columns=['timestamp','elapsed_ms','mode','module','totalFaces','dominantEmotion',...labels,'attention','arousal','valence'];
function csvCell(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"';}
$('csv').onclick=()=>{const rows=records.map(e=>{const o=e.payload.output||{};const flat={timestamp:e.timestamp,elapsed_ms:e.elapsed_ms,mode:e.mode,module:e.module,totalFaces:e.payload.totalFaces,dominantEmotion:o.dominantEmotion,...o.emotion,attention:o.attention,arousal:o.arousal,valence:o.valence};return columns.map(c=>csvCell(flat[c])).join(',');});download('csv','\uFEFF'+columns.join(',')+'\r\n'+rows.join('\r\n'),'text/csv;charset=utf-8');};
window.addEventListener('pagehide',()=>{running=false;detach();if(controller)try{controller.stop();}catch{}});
updateMode();controls();
