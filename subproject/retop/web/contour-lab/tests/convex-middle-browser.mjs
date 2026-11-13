import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const profile=await mkdtemp(path.join(os.tmpdir(),'contour-chrome-')),chrome=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{detached:true});let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';chrome.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});chrome.on('error',reject);setTimeout(()=>reject(Error('Chrome startup timeout')),10000).unref();});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map(),events=[];ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const cb=pending.get(data.id);pending.delete(data.id);data.error?cb.reject(Error(JSON.stringify(data.error))):cb.resolve(data.result);}else events.push(data);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(m,p)=>send(m,p,sessionId);
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1460,height:1100,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const waitFor=async(expression,timeout=600000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+expression);};
 const ready=async()=>{await waitFor('!contourLab.busy && (contourLab.result || document.getElementById("status").classList.contains("error"))');assert(await evaluate('!!contourLab.result'),await evaluate('document.getElementById("status").textContent'));};
 const screenshot=async name=>writeFile('artifacts/contour-lab/'+name,Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 const url=process.env.CONTOUR_URL||'file:///mnt/retop/web/contour-lab/dist/index.html';await call('Page.navigate',{url});await waitFor('window.contourLab && document.querySelectorAll(".ref").length===9');



 const report=[];
 for(const index of [8]){
  await evaluate(`contourLab.loadReference(${index-1})`);await ready();await evaluate('contourLab.setLevel(2)');
  const result=await evaluate('contourLab.result'),m=result.levels[2],n=result.levels[3],u=result.levels[4],expected=index===8?2:1;
  for(const l of [m,n,u]){assert(l.audit.valid&&l.partitionAudit.valid);assert.equal(l.holeCount,expected);assert(l.subcontours.every(p=>p.segments.length<=6));}
  assert.equal(m.subcontours.length,5);assert.equal(u.subcontours.length,12);assert(n.topologyAudit.valid);assert(u.hierarchyAudit.valid&&u.hierarchyAudit.geometryPreserved);assert(n.audit.noAdjacentC&&n.audit.noAdjacentS);assert(u.adjacencyPolicy.allowCC&&u.adjacencyPolicy.allowSS);
  if(index===8){assert(m.subcontours[1].regularity.convex);assert(m.subcontours[1].regularity.minInteriorAngle>47);assert.equal(m.subcontours[0].edgePolicy.mode,'convex-six');assert(m.partitionAudit.sharpParts===0);assert.equal(m.segments.length,9);assert(u.outerFitAudit.afterSourceIoU>=u.outerFitAudit.beforeSourceIoU);}
  const checks=await evaluate('document.getElementById("checks").textContent');assert(checks.includes('凸分区'));assert(checks.includes('最小内角'));await screenshot(`convex-middle-reference-${index}.png`);
  const flow=await evaluate('contourLab.flowEngine.compute(contourLab.result.levels[4],contourLab.flowEngine.automaticPorts(contourLab.result.levels[4]))');assert(flow.coverage.complete&&flow.steady.valid);
  result._verification={engineHash:createHash('sha256').update(await readFile('web/contour-lab/engine.js')).digest('hex'),maskHash:createHash('sha256').update(await readFile(`artifacts/contour-lab/reference-${index}-mask.json`)).digest('hex'),origin:'verified actual browser worker'};
  await writeFile(`artifacts/contour-lab/reference-${index}-vectors.json`,JSON.stringify(result));
  for(const i of [2,3,4])await writeFile(`artifacts/contour-lab/reference-${index}-${result.levels[i].id}.svg`,await evaluate(`contourLab.engine.svg(contourLab.result,${i})`));
  report.push({reference:index,middle:m.partitionAudit,repair:m.middleShapeAudit,parts:m.subcontours.map(p=>({id:p.id,sides:p.segments.length,convex:p.regularity.convex,minAngle:p.regularity.minInteriorAngle})),nearTopology:n.topologyAudit,ultraHierarchy:u.hierarchyAudit,ultraIoU:u.iou,ultraSourceError:u.sourceError});console.log('PASS browser reference',index);
 }
 const errors=events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));await writeFile('artifacts/contour-lab/convex-middle-browser-report.json',JSON.stringify({url,engineHash:createHash('sha256').update(await readFile('web/contour-lab/engine.js')).digest('hex'),report,runtimeErrors:errors},null,2));

}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{ws?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const closed=new Promise(r=>chrome.once('exit',r));chrome.kill();await closed;}await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
