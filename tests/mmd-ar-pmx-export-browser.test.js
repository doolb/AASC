const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const os=require('node:os');
const puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'../3rd/mmd-ar-test/web-dist');
const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,puppeteer.executablePath(),'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));

test('真实HTTP网页编辑、下载PMX、复制、关节修改、工程保存往返及导出模型重新加载',{
    skip:!chrome||!fs.existsSync(path.join(root,'js/web-editor-pmx.mjs')),timeout:150000
},async()=>{
    const {inspectPmxPhysics}=await import('../3rd/mmd-ar-test/web-editor-pmx.mjs');
    const original=fs.readFileSync(path.join(root,'mmd/miya/miya.pmx'));
    const source=inspectPmxPhysics(original),downloads=await fsp.mkdtemp(path.join(os.tmpdir(),'mmd-pmx-download-'));
    const server=http.createServer((req,res)=>{
        const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
        const file=path.resolve(root,relative==='api/mmd/resources'?'mmd-resources.json':relative);
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
        const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
        res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    });
    let browser;
    try {
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
        const page=await browser.newPage();await page.setViewport({width:640,height:600});const failures=[];
        page.on('pageerror',e=>failures.push(e.message));
        const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
        await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.DisplayMmd?.getState().modelReady&&document.getElementById('edExportPmx'),{timeout:60000});
        await page.evaluate(()=>{window.DisplayMmd.setLighting({pmxAoEnabled:false,keyShadowEnabled:false});window.DisplayMmd.setMotionPlaybackEnabled(false);});
        await page.click('[data-mode="edit"]');
        await page.waitForFunction(()=>!document.getElementById('mmdEditor').hasAttribute('aria-busy')&&!document.getElementById('edEditing').hidden);
        const download=async(button,extension)=>{
            // 同名PMX连续导出时，CDP允许覆盖旧文件；每轮使用独立目录以保留比较样本。
            const round=await fsp.mkdtemp(path.join(downloads,'round-'));
            await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:round});
            await page.click(button);
            const deadline=Date.now()+20000;
            while(Date.now()<deadline){
                const files=await fsp.readdir(round),file=files.find(n=>n.endsWith(extension));
                if(file){await page.waitForFunction(()=>!document.getElementById('mmdEditor').hasAttribute('aria-busy'));return path.join(round,file);}
                await new Promise(resolve=>setTimeout(resolve,100));
            }
            throw new Error('未收到下载：'+await page.$eval('#edStatus',n=>n.textContent));
        };
        const pristine=await download('#edExportPmx','.pmx');assert.deepEqual(fs.readFileSync(pristine),original);
        await page.select('#edObjects','0');
        const change=async(selector,value)=>{
            await page.$eval(selector,(node,v)=>{node.value=String(v);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
            await page.waitForFunction(()=>!document.getElementById('mmdEditor').hasAttribute('aria-busy'));
        };
        const mass=source.bodies[0].data.weight+.25;await change('[data-path="weight"]',mass);
        const edited=await download('#edExportPmx','.pmx');assert.equal(inspectPmxPhysics(fs.readFileSync(edited)).bodies[0].data.weight,mass);
        await page.click('#edCopy');await page.waitForFunction(()=>!document.getElementById('mmdEditor').hasAttribute('aria-busy'));
        await page.select('#edKind','constraints');await page.select('#edObjects','0');await change('[data-path="springPosition.0"]',15.75);
        const copyFile=await download('#edExportPmx','.pmx'),copied=inspectPmxPhysics(fs.readFileSync(copyFile));
        assert.equal(copied.bodies.length,source.bodies.length+1);assert.equal(copied.joints[0].data.springPosition[0],15.75);
        assert.deepEqual(copied.bytes.subarray(0,copied.start),source.bytes.subarray(0,source.start));
        const archive=await download('#edSave','.zip');await (await page.$('#edFile')).uploadFile(archive);
        await page.waitForFunction(()=>document.getElementById('edStatus').textContent.includes('工程已恢复'),{timeout:45000});
        const reopened=await download('#edExportPmx','.pmx');assert.deepEqual(fs.readFileSync(reopened),fs.readFileSync(copyFile));
        const textures=(await fsp.readdir(path.join(root,'mmd/miya/tex'))).map(n=>path.join(root,'mmd/miya/tex',n));
        await (await page.$('#mmdArLocalFiles')).uploadFile(reopened,...textures);
        await page.waitForFunction(()=>window.DisplayMmd.getState().modelReady&&window.DisplayMmd.getModelProfile().modelUrl.includes('-edited'),{timeout:45000});
        const loaded=await page.evaluate(()=>{const data=window.DisplayMmd.getEditorBridge().read().mesh.geometry.userData.MMD;return {mass:data.rigidBodies[0].weight,count:data.rigidBodies.length,k:data.constraints[0].springPosition[0]};});
        assert.deepEqual(loaded,{mass,count:source.bodies.length+1,k:15.75});assert.deepEqual(failures,[]);
    } finally {
        await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fsp.rm(downloads,{recursive:true,force:true});
    }
});
