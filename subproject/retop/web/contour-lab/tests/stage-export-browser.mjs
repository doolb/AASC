import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const profile=await mkdtemp(path.join(os.tmpdir(),'contour-chrome-')),chrome=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{detached:true});let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';chrome.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});chrome.on('error',reject);setTimeout(()=>reject(Error('Chrome startup timeout')),10000).unref();});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map(),events=[];ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const cb=pending.get(data.id);pending.delete(data.id);data.error?cb.reject(Error(JSON.stringify(data.error))):cb.resolve(data.result);}else events.push(data);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(m,p)=>send(m,p,sessionId);
 await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');await call('Network.enable');await call('Emulation.setDeviceMetricsOverride',{width:1460,height:1100,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const waitFor=async(expression,timeout=600000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+expression);};
 const ready=async()=>{await waitFor('!contourLab.busy && (contourLab.result || document.getElementById("status").classList.contains("error"))');assert(await evaluate('!!contourLab.result'),await evaluate('document.getElementById("status").textContent'));};
 const screenshot=async name=>writeFile('artifacts/contour-lab/'+name,Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 const fixture=JSON.parse(await readFile('artifacts/contour-lab/reference-8-vectors.json','utf8'));await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__flowFixture=${JSON.stringify(fixture)};window.Worker=class {postMessage(data){this.timer=setTimeout(()=>this.onmessage?.({data:{id:data.id,result:structuredClone(window.__flowFixture)}}),0)}terminate(){clearTimeout(this.timer)}};`});

 const report=[];
 for(const url of process.env.CONTOUR_URL?[process.env.CONTOUR_URL]:['http://192.168.1.39/mnt/retop/web/contour-lab/','file:///mnt/retop/web/contour-lab/dist/index.html']){
  await call('Page.navigate',{url});await waitFor('window.contourLab && document.getElementById("exportStage")');assert(await evaluate('document.getElementById("exportStage").disabled'));
  await evaluate('contourLab.loadReference(7)');await ready();
  const exported=[];
  for(const index of [0,1,2,3,4]){
   await evaluate('contourLab.setLevel('+index+')');assert.equal(await evaluate('document.getElementById("exportStage").disabled'),false);
   await evaluate('document.getElementById("flowInlet").click();document.querySelector("[data-flow-edge]").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
   if(index>=2)await evaluate('document.getElementById("flowOutlet").click();(()=>{const l=contourLab.result.levels[contourLab.level],edge=contourLab.flowEngine.edges(l).find(e=>e.faces.length===2);document.querySelector(`[data-flow-edge="${edge.id}"]`).dispatchEvent(new MouseEvent("click",{bubbles:true}));})()');
   assert.equal(await evaluate('contourLab.flowStates[contourLab.result.levels[contourLab.level].id].analysis'),null);
   const snapshot=await evaluate('JSON.stringify({level:contourLab.result.levels[contourLab.level],ports:contourLab.flowStates[contourLab.result.levels[contourLab.level].id].ports})');
   const saved=await evaluate('(async()=>{let link;const old=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){link={name:this.download,url:this.href}};try{document.getElementById("exportStage").click();return {...link,text:await fetch(link.url).then(r=>r.text())}}finally{HTMLAnchorElement.prototype.click=old}})()');
   const data=JSON.parse(saved.text),expected=JSON.parse(snapshot);assert.equal(data.schema,'contour-lab/stage');assert.deepEqual(data.contour,expected.level);assert.deepEqual(data.flow.ports,expected.ports);assert.equal(saved.name,'contour-'+data.selectedLevel+'-ports.json');assert(!data.levels);assert(data.edges.some(e=>e.flowRole==='inlet'));if(index>=2)assert(data.edges.some(e=>e.flowRole==='outlet'&&e.faces.length===2));
   assert.equal(await evaluate('JSON.stringify({level:contourLab.result.levels[contourLab.level],ports:contourLab.flowStates[contourLab.result.levels[contourLab.level].id].ports})'),snapshot);exported.push(data.selectedLevel);
   if(index===4)await writeFile('artifacts/contour-lab/stage-export-ultra-'+(url.startsWith('https')?'published':url.startsWith('file')?'offline':'web')+'.json',saved.text);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert(await evaluate('document.documentElement.scrollWidth<=390'));await call('Emulation.setDeviceMetricsOverride',{width:1460,height:1100,deviceScaleFactor:1,mobile:false});await screenshot('stage-export-'+(url.startsWith('https')?'published':url.startsWith('file')?'offline':'web')+'.png');
  await evaluate('document.getElementById("clear").click()');assert(await evaluate('document.getElementById("exportStage").disabled'));
  report.push({url,exported,beforeFlowCompute:true,sharedPortAttributes:true,exactGeometry:true,stageIsolation:true,sourceUnchanged:true,mobile:true,disabledWithoutContour:true});console.log('PASS current-stage contour and ports: all five stages, precompute, shared edges, no mutation and mobile',url);
 }
 const errors=events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));await writeFile('artifacts/contour-lab/stage-export-'+(process.env.CONTOUR_URL?.startsWith('https')?'published':'local')+'-browser-report.json',JSON.stringify({geometrySource:'verified reference8 Worker fixture; actual current UI edge editing and JSON downloads',report,runtimeErrors:errors},null,2)+'\n');
}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{ws?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const closed=new Promise(r=>chrome.once('exit',r));chrome.kill();await closed;}await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
