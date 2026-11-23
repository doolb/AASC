const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../../../..'),assets=process.argv[2],out=process.argv[3]||path.resolve(__dirname,'../../../artifacts/moxing-texture-2026-11-18');
if(!assets)throw Error('请提供高低模与贴图所在目录。');
const {launch}=require(root+'/node_modules/puppeteer-core');
(async()=>{
fs.mkdirSync(out,{recursive:true});
const browser=await launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=8192']});
try{
const page=await browser.newPage();await page.setViewport({width:1400,height:1000});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
await page.goto(pathToFileURL(root+'/subproject/retop/web/contour-lab-3d/dist/index.html').href,{timeout:180000,waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.contourLab3D,{timeout:30000});await page.evaluate(()=>contourLab3D.demo('cube'));await page.waitForFunction(()=>!contourLab3D.busy,{timeout:180000});
await page.evaluate(()=>{document.getElementById('lowTriangleBudget').value=2122;});
const input=await page.$('#file');await input.uploadFile(assets+'/HIgh.obj',assets+'/HIgh.mtl');
await page.waitForFunction(()=>contourLab3D.result?.source.vertices.length>700000&&!contourLab3D.busy,{timeout:240000});
console.log('GEOMETRY',await page.evaluate(()=>({tris:contourLab3D.result.levels[2].audit.triangles,uvs:contourLab3D.result.source.sourceUV?.uv.length,settings:contourLab3D.result.settings.lowTriangleBudget})));
await (await page.$('#colorFile')).uploadFile(assets+'/HIGH.png');
await page.waitForFunction(()=>document.getElementById('textureStatus').textContent.includes('4096'),{timeout:30000});
await (await page.$('#referenceFile')).uploadFile(assets+'/LOW.obj');
await page.waitForFunction(()=>contourLab3D.result.referenceSource?.alignment,{timeout:30000});
await (await page.$('#referenceTexture')).uploadFile(assets+'/lOW.tga');
await page.waitForFunction(()=>document.getElementById('textureStatus').textContent.includes('512'),{timeout:30000});
await page.evaluate(()=>{contourLab3D.setLevel(2);document.getElementById('textureSize').value=2048;contourLab3D.bakeColor();});
let last='';const timer=setInterval(async()=>{try{const s=await page.$eval('#textureStatus',e=>e.textContent);if(s!==last){last=s;console.log('BAKE',s)}}catch{}},15000);
try{await page.waitForFunction(()=>!contourLab3D.busy,{timeout:900000});}finally{clearInterval(timer);}
const report=await page.evaluate(()=>{const c=contourLab3D,r=c.result,l=r.levels[2];if(!l.texture)throw Error(document.getElementById('status').textContent);return {triangles:l.audit.triangles,texture:l.texture.report,size:[l.texture.width,l.texture.height],alignment:r.referenceSource.alignment,uv:l.uv.report,errors:document.getElementById('status').textContent}});
console.log('REPORT',JSON.stringify({triangles:report.triangles,texture:report.texture,size:report.size,uvIslands:report.uv.islands,uvMaximum:Math.max(...report.uv.charts.map(c=>c.stretch.maximum))}));assert(report.triangles<=2122);assert(report.texture.coverage>.98);assert.deepEqual(errors,[]);
await page.evaluate(()=>{const c=contourLab3D;c.viewer.options({wire:false,boundary:false});c.viewer.view('front');});
const files=await page.evaluate(async()=>{
 const c=contourLab3D,l=c.result.levels[2],image=l.texture,T=createContourTextureTransfer(c.engine),canvas=new OffscreenCanvas(image.width,image.height);canvas.getContext('2d').putImageData(new ImageData(image.data,image.width,image.height),0,0);const blob=await canvas.convertToBlob({type:'image/png'}),b64=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)});return {obj:T.materialOBJ(l,'retop-low'),mtl:'newmtl BaseColor\nKd 1 1 1\nmap_Kd retop-low-basecolor.png\n',png:b64,snapshot:c.viewer.snapshot(),project:JSON.stringify({schema:'contour-lab-3d/project',sourceFingerprint:c.result.sourceFingerprint,settings:c.result.settings,low:{mesh:l.mesh,uv:l.uv}})};
});
fs.writeFileSync(out+'/retop-low.obj',files.obj);fs.writeFileSync(out+'/retop-low.mtl',files.mtl);fs.writeFileSync(out+'/retop-low-basecolor.png',Buffer.from(files.png.split(',')[1],'base64'));fs.writeFileSync(out+'/reference-vs-generated.png',Buffer.from(files.snapshot.split(',')[1],'base64'));fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const E=require(root+'/subproject/retop/web/contour-lab-3d/engine.js')(),T=require(root+'/subproject/retop/web/contour-lab-3d/texture-transfer.js')(E),read=E.parseOBJ(files.obj);assert.equal(E.audit(read).triangles,report.triangles);T.validateUV(read);
fs.writeFileSync(out+'/retop-low-textured.zip',T.zip({'retop-low.obj':files.obj,'retop-low.mtl':files.mtl,'retop-low-basecolor.png':fs.readFileSync(out+'/retop-low-basecolor.png')}));
const client=await page.createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:out});await page.evaluate(()=>contourLab3D.exportColor());
await new Promise(r=>setTimeout(r,1000));console.log('OUTPUT',out);
}finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
