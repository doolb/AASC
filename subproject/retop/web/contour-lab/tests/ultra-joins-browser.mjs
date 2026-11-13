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
 for(const index of [9]){
  await evaluate(`contourLab.loadReference(${index-1})`);await ready();await evaluate('contourLab.setLevel(4)');
  const result=await evaluate('contourLab.result'),level=result.levels[4],expected=index===8?2:1;
  assert.equal(level.holeCount,expected);assert.equal(level.subcontours.length,12);assert(level.audit.valid&&level.partitionAudit.valid&&level.hierarchyAudit.valid);assert(level.hierarchyAudit.geometryPreserved);
  assert.equal(level.holeFitAudit.length,expected);assert(level.holeFitAudit.every(a=>a.afterSourceError<6&&a.afterSourceIoU>.97));assert(level.adjacencyPolicy.allowCC&&level.adjacencyPolicy.allowSS&&level.audit.adjacencyPolicyValid);assert.equal(level.audit.noAdjacentS,false);assert(level.outerFitAudit.afterSourceError<1.5);assert(result.levels[3].audit.noAdjacentC&&result.levels[3].audit.noAdjacentS);for(const part of [7,10,11])assert(level.subcontours[part].segments.filter(s=>s.role==='outer').every(s=>s.kind==='C'));
  const checks=await evaluate('document.getElementById("checks").textContent');assert(checks.includes('C–C / S–S 可相连'));assert(checks.includes('外圈联合拟合'));for(let j=1;j<=expected;j++)assert(checks.includes(`孔 ${j} · 原图偏差`));
  const native=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),l=contourLab.result.levels[4];ctx.fill(new Path2D(contourLab.engine.boundaryPath(l)),'evenodd');const p=ctx.getImageData(0,0,512,512).data;let common=0,union=0;for(let j=0;j<512*512;j++){const a=p[j*4+3]>127,b=contourLab.mask[j];if(a&&b)common++;if(a||b)union++;}return {iou:common/union,reported:l.iou};})()`);assert(Math.abs(native.iou-native.reported)<.003);
  const flow=await evaluate('contourLab.flowEngine.compute(contourLab.result.levels[4],contourLab.flowEngine.automaticPorts(contourLab.result.levels[4]))');assert(flow.coverage.complete&&flow.steady.valid);
  await screenshot(`ultra-joins-reference-${index}.png`);report.push({reference:index,holeFitAudit:level.holeFitAudit,outerFitAudit:level.outerFitAudit,adjacencyPolicy:level.adjacencyPolicy,hasAdjacentS:!level.audit.noAdjacentS,iou:level.iou,sourceError:level.sourceError,native,hierarchy:level.hierarchyAudit});
 }
 const errors=events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));await writeFile('artifacts/contour-lab/ultra-joins-browser-report.json',JSON.stringify({url,engineHash:createHash('sha256').update(await readFile('web/contour-lab/engine.js')).digest('hex'),report,runtimeErrors:errors},null,2));console.log('PASS actual browser worker reference 9: U08/U11/U12 C outer arcs, C-C/S-S allowed, strict near, Canvas fill and flow');
}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{ws?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const closed=new Promise(r=>chrome.once('exit',r));chrome.kill();await closed;}await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
