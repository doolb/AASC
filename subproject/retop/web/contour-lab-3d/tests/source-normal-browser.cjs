// 真实 Worker 与下载验收：无 UV、无颜色图的 OBJ 导入后应自动恢复法线。
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../../../..'),E=require('../engine.js')(),{launch}=require(root+'/node_modules/puppeteer-core');
const out=path.resolve(process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'retop-normal-browser-')));
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const input=path.join(out,'source.obj');fs.writeFileSync(input,E.obj({mesh:E.cube()}));
  const browser=await launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'../dist/index.html')).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.contourLab3D);
    await page.evaluate(()=>contourLab3D.demo('cube'));
    await page.waitForFunction(()=>!contourLab3D.busy,{timeout:120000});
    await page.evaluate(()=>document.getElementById('lowTriangleBudget').value=100);
    await (await page.$('#file')).uploadFile(input);
    await page.waitForFunction(()=>!contourLab3D.busy&&contourLab3D.result?.source.sourceNormals,{timeout:120000});
    const report=await page.evaluate(()=>{
      const c=contourLab3D,l=c.result.levels[2];
      // 单色仅用于检查实际下载链路；法线来自刚刚导入并生成的网格。
      l.texture={width:32,height:32,data:new Uint8ClampedArray(32*32*4).fill(255)};
      c.setLevel(2);
      return {sourceUV:!!c.result.source.sourceUV,levels:c.result.levels.slice(2).map(l=>({id:l.id,hits:l.mesh.surfaceNormals?.hits,report:l.mesh.smoothingReport})),obj:c.engine.obj(l)};
    });
    assert.equal(report.sourceUV,false);assert(report.levels.every(l=>l.hits>0&&l.report.partitionSource==='source-normals'));
    const read=E.parseOBJ(report.obj);assert(read.sourceNormals);
    const client=await browser.target().createCDPSession();
    await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
    const completed=new Promise((resolve,reject)=>client.on('Browser.downloadProgress',e=>{if(e.state==='completed')resolve();if(e.state==='canceled')reject(Error('下载被取消。'));}));
    await page.click('#exportColor');
    let timer;try{await Promise.race([completed,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('ZIP 下载超时。')),30000))]);}finally{clearTimeout(timer);}
    assert(fs.existsSync(path.join(out,'retop-low-textured.zip')));assert.deepEqual(errors,[]);
    delete report.obj;fs.writeFileSync(path.join(out,'browser-normal.json'),JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
