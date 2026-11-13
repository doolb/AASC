import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const profile=await mkdtemp(path.join(os.tmpdir(),'contour-chrome-')),chrome=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{detached:true});let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';chrome.stderr.on('data',b=>{output+=b;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});chrome.on('error',reject);setTimeout(()=>reject(Error('Chrome startup timeout')),10000).unref();});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map(),events=[];ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id){const cb=pending.get(data.id);pending.delete(data.id);data.error?cb.reject(Error(JSON.stringify(data.error))):cb.resolve(data.result);}else events.push(data);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(m,p)=>send(m,p,sessionId);
 await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');await call('Network.enable');await call('Emulation.setDeviceMetricsOverride',{width:1460,height:1100,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const waitFor=async(expression,timeout=600000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+expression);};
 const ready=async()=>{await waitFor('!contourLab3D.busy && (contourLab3D.result || document.getElementById("status").classList.contains("error"))');assert(await evaluate('!!contourLab3D.result'),await evaluate('document.getElementById("status").textContent'));};
 const screenshot=async name=>writeFile('artifacts/contour-lab-3d/'+name,Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));




 const reports=[];
 for(const url of process.env.CONTOUR3D_URL?[process.env.CONTOUR3D_URL]:['http://192.168.1.39/mnt/retop/web/contour-lab-3d/','file:///mnt/retop/web/contour-lab-3d/dist/index.html']){
  await call('Page.navigate',{url});await waitFor('window.contourLab3D');await evaluate('contourLab3D.loadMesh(contourLab3D.engine.cube())');await ready();
  const original=await evaluate('JSON.stringify(contourLab3D.result)');await evaluate('contourLab3D.viewer.options({smooth:false,wire:false,boundary:false,split:true})');
  const sample='(()=>{const c=document.getElementById("viewport"),gl=c.getContext("webgl");return [.25,.75].map(x=>{const p=new Uint8Array(4);gl.readPixels(Math.floor(c.width*x),Math.floor(c.height*.5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p]})})()';
  const projections=[];
  for(const projection of ['orthographic','perspective']){
   await evaluate('contourLab3D.setProjection('+JSON.stringify(projection)+')');const samples=[];
   for(const view of ['front','side','top','back']){await evaluate('contourLab3D.viewer.view('+JSON.stringify(view)+')');const pixels=await evaluate(sample);assert(pixels[0][1]>50&&pixels[0][1]<220,'sample must hit the shaded model');for(let k=0;k<3;k++)assert(Math.abs(pixels[0][k]-pixels[1][k])<=1,'source and candidate use identical lights');samples.push({view,pixels});}
   const baseline=samples[0].pixels[0];for(const s of samples)for(let k=0;k<3;k++)assert(Math.abs(s.pixels[0][k]-baseline[k])<=2,'camera-facing faces retain the same brightness while the world normal rotates: '+JSON.stringify(samples));
   await evaluate('contourLab3D.viewer.view("angle")');const contrast=await evaluate('(()=>{const c=document.getElementById("viewport"),gl=c.getContext("webgl"),p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);const values=[];for(let i=0;i<p.length;i+=4)if(p[i+1]>p[i]+8&&p[i+1]<210&&p[i]>60)values.push(p[i+1]);return {minimum:Math.min(...new Set(values)),maximum:Math.max(...new Set(values))}})()');assert(contrast.maximum-contrast.minimum>15,'camera-relative lighting still distinguishes face directions');
   projections.push({projection,samples,contrast});
  }
  const tag=url.startsWith('https')?'published':url.startsWith('file')?'offline':'web';await screenshot(tag+'-camera-lighting.png');
  await evaluate('contourLab3D.setMode("uv");contourLab3D.viewer.view("side");contourLab3D.setMode("atlas")');assert(await evaluate('contourLab3D.viewer.uvInfo.available'));await evaluate('contourLab3D.setMode("model");contourLab3D.viewer.options({smooth:true});contourLab3D.viewer.view("back")');assert.equal(await evaluate('JSON.stringify(contourLab3D.result)'),original);assert.equal(await evaluate('contourLab3D.dirty'),false);
  const glError=await evaluate('document.getElementById("viewport").getContext("webgl").getError()');assert.equal(glError,0);reports.push({url,projections,cameraRelativeLighting:true,sourceAndCandidateSameLighting:true,directionalContrastPreserved:true,UVViewsWork:true,geometryAndResultsUnchanged:true,glError});console.log('PASS camera-following light in four directions and both projections; GPU pixels match',url);
 }
 const errors=events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));await writeFile('artifacts/contour-lab-3d/lighting-'+(process.env.CONTOUR3D_URL?.startsWith('https')?'published-':'')+'browser-report.json',JSON.stringify({reports,runtimeErrors:errors},null,2)+'\n');
}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{ws?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const closed=new Promise(r=>chrome.once('exit',r));chrome.kill();await closed;}await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
