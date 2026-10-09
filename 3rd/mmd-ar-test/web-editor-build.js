'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const {hashFile}=require('./apk-artifact');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('编辑器缺少唯一锚点：'+a.slice(0,70));return s.replace(a,b);};
const BLENDER_VERSION='0.1.136';
async function assertSubdirectoryBlenderUrls(root){
    const directory=path.join(root,'js','blender-engine'),files=[];
    const visit=async current=>{for(const entry of await fs.readdir(current,{withFileTypes:true})){const file=path.join(current,entry.name);if(entry.isDirectory())await visit(file);else if(/\.(?:m?js)$/u.test(entry.name))files.push(file);}};
    await visit(directory);
    const rows=await Promise.all(files.map(async file=>({file,source:await fs.readFile(file,'utf8')})));
    for(const {file,source} of rows){
        if(/new URL\(["']\/assets\/(?:worker|sky-precompute-worker|blender-motion-worker)-/u.test(source))
            throw new Error(`Blender 子目录构建产物仍从域名根目录加载 worker：${path.relative(directory,file)}`);
        if(/(?:fetch|new URL)\([\s]*["'`]\/__editor\//u.test(source))
            throw new Error(`Blender 子目录构建产物仍从域名根目录请求 Service Worker API：${path.relative(directory,file)}`);
        if(source.includes('Object.assign({})[')&&source.includes('__editor/'))
            throw new Error(`Blender 子目录 API URL 被改写成空的静态资源映射：${path.relative(directory,file)}`);
        if(/ARTIFACT_BASE\s*=\s*["']\/__editor\/blender-wasm/u.test(source))
            throw new Error(`Blender 子目录构建产物仍将 WASM API 固定到域名根目录：${path.relative(directory,file)}`);
    }
    if(!rows.some(({source})=>source.includes('worker-')&&source.includes('assets/')))
        throw new Error('Blender 子目录构建产物中找不到相对 worker 资源引用');
    const worker=rows.find(({file})=>file.includes(`${path.sep}assets${path.sep}worker-`));
    if(!worker?.source.includes('__editor/')||!worker.source.includes('repeat(3)'))
        throw new Error('Blender worker 的应用内 API 路径未使用当前子目录基准');
}
async function buildBlenderBundle(root){
    const engineRoot=path.join(__dirname,'blender-engine');
    const vite=path.join(engineRoot,'node_modules','vite','bin','vite.js');
    const packageRoot=path.join(engineRoot,'node_modules','@volter','blender-engine');
    await Promise.all([fs.access(vite),fs.access(path.join(packageRoot,'wasm','BUNDLE.json'))]).catch(()=>{
        throw new Error('Blender 工作区构建依赖未安装；先运行 npm install --prefix 3rd/mmd-ar-test/blender-engine');
    });
    await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[vite,'build','--config',path.join(engineRoot,'vite.config.mjs')],{cwd:engineRoot,stdio:'inherit'});
        child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Blender 工作区模块构建失败：${code}`)));
    });
    const workbenchPath=path.join(root,'js','blender-engine','workbench.mjs');
    const workbenchSource=await fs.readFile(workbenchPath,'utf8');
    if(!/\bmountBlenderWorkbench\b/.test(workbenchSource))throw new Error('Blender 工作区构建产物缺少 mountBlenderWorkbench 导出');
    await assertSubdirectoryBlenderUrls(root);
    const versionRoot=path.join(root,'assets','blender-engine',BLENDER_VERSION);
    await fs.mkdir(versionRoot,{recursive:true});
    const workerSource=await fs.readFile(path.join(__dirname,'web-blender-service-worker.js'),'utf8');
    await fs.writeFile(path.join(root,'web-blender-service-worker.js'),once(workerSource,
        "const ENGINE_VERSION = '__BLENDER_VERSION__';",`const ENGINE_VERSION = '${BLENDER_VERSION}';`));
    const wasmRoot=path.join(packageRoot,'wasm');
    for(const name of ['blender_browser.js','blender_browser.wasm.br','blender_browser.data.br','essentials.bin.br','essentials.json','BUNDLE.json','DEPENDENCY-LICENSES.txt'])
        await fs.copyFile(path.join(wasmRoot,name),path.join(versionRoot,name));
    await fs.copyFile(path.join(packageRoot,'LICENSE'),path.join(versionRoot,'LICENSE'));
    const bundle=JSON.parse(await fs.readFile(path.join(wasmRoot,'BUNDLE.json'),'utf8'));
    const essentials=JSON.parse(await fs.readFile(path.join(wasmRoot,'essentials.json'),'utf8'));
    const status={
        available:true,skew:'emscripten',dir:`assets/blender-engine/${BLENDER_VERSION}`,
        sizes:{
            'blender_browser.js':bundle.rawFiles['blender_browser.js'].bytes,
            'blender_browser.wasm':bundle.rawFiles['blender_browser.wasm'].bytes,
            'blender_browser.data':bundle.rawFiles['blender_browser.data'].bytes,
            'essentials.bin':essentials.bytes,
        },
        encoded:{'blender_browser.wasm':'br','blender_browser.data':'br','essentials.bin':'br'},
        digests:{
            'blender_browser.wasm':bundle.rawFiles['blender_browser.wasm'].sha256,
            'blender_browser.data':bundle.rawFiles['blender_browser.data'].sha256,
            'essentials.bin':essentials.sha256,
        },
        inTab:false,missing:[],
    };
    await fs.writeFile(path.join(versionRoot,'status'),JSON.stringify(status)+'\n');
    await fs.writeFile(path.join(versionRoot,'.htaccess'),[
        '<IfModule mod_mime.c>',
        'AddEncoding br .br',
        'AddType application/wasm .wasm.br',
        'AddType application/octet-stream .data.br .bin.br',
        '</IfModule>',
        '<IfModule mod_headers.c>',
        '<FilesMatch "\\.(js|wasm|data|bin)(\\.br)?$">',
        'Header set Cache-Control "public, max-age=31536000, immutable"',
        '</FilesMatch>',
        '</IfModule>',
        '',
    ].join('\n'));
    await fs.writeFile(path.join(root,'.htaccess'),[
        '<IfModule mod_headers.c>',
        'Header always set Cross-Origin-Opener-Policy "same-origin"',
        'Header always set Cross-Origin-Embedder-Policy "credentialless"',
        '</IfModule>',
        '',
    ].join('\n'));
    return (await hashFile(path.join(root,'js','blender-engine','workbench.mjs'))).sha256.slice(0,12);
}
async function stage(root,{webMode=false}={}){
    const folder=path.join(root,'js');
    const names=['web-editor-document.mjs','web-editor-bridge.mjs','web-editor-view.mjs','web-editor-pmx.mjs','web-editor-project.mjs','web-editor-ui.mjs'];
    const blenderVersion=webMode?await buildBlenderBundle(root):null;
    await fs.copyFile(path.join(path.dirname(require.resolve('three')),'../examples/jsm/libs/fflate.module.js'),path.join(folder,'web-editor-zip.mjs'));
    await fs.copyFile(path.join(__dirname,'web-editor-zip.LICENSE.txt'),path.join(folder,'web-editor-zip.LICENSE.txt'));
    const versions=new Map([['web-local-assets.mjs',(await hashFile(path.join(folder,'web-local-assets.mjs'))).sha256.slice(0,12)],['web-editor-zip.mjs',(await hashFile(path.join(folder,'web-editor-zip.mjs'))).sha256.slice(0,12)]]);
    for(const name of names){
        let text=await fs.readFile(path.join(__dirname,name),'utf8');
        for(const [dependency,hash] of versions)text=text.replaceAll('./'+dependency,'./'+dependency+'?v='+hash);
        if(name==='web-editor-ui.mjs'){
            text=text.replace('__BLENDER_WORKBENCH_URL__',`./blender-engine/workbench.mjs?v=${blenderVersion||'web-only-disabled'}`);
            if(!webMode)text=text.replace('<button id="edBlender" type="button" data-blender-only>Blender工程</button>','');
        }
        await fs.writeFile(path.join(folder,name),text);versions.set(name,(await hashFile(path.join(folder,name))).sha256.slice(0,12));
    }
    const doc='./web-editor-document.mjs?v='+versions.get('web-editor-document.mjs');
    const bridge='./web-editor-bridge.mjs?v='+versions.get('web-editor-bridge.mjs');
    const file=path.join(folder,'display-pmx-runtime.js');let runtime=await fs.readFile(file,'utf8');
    runtime=`import { stageEditorDocument } from '${doc}';\nimport { createEditorBridge } from '${bridge}';\n`+runtime;
    runtime=once(runtime,'            stagedMesh = await loadModelMesh(profile.modelUrl, report);','            stagedMesh = await loadModelMesh(profile.modelUrl, report);\n            stageEditorDocument(stagedMesh, profile);');
    runtime=once(runtime,'    const helper = { current: null };','    const helper = { current: null };\n    const editorCameraControl = { view: null };');
    runtime=once(runtime,'        const frameHelper = motionSwitchMesh',`        if (editorCameraControl.view) {
            camera.position.fromArray(editorCameraControl.view.position);camera.quaternion.fromArray(editorCameraControl.view.quaternion);
            camera.updateMatrixWorld(true);
        }
        const frameHelper = motionSwitchMesh`);
    runtime=once(runtime,'        getMotionProgress: () => {',`        getEditorBridge: () => createEditorBridge({ THREE,renderer,camera,scene,ambientOcclusion,editorCameraControl,
            get referenceHz(){return physicsStabilityReferenceHz;},get mesh(){return currentMesh;},get currentPivot(){return currentRotationPivot;},get profile(){return currentProfile;},get helper(){return helper.current;},
            fitCameraToModel,fitShadowCamera,applyShadowFlags }),
        getMotionProgress: () => {`);
    await fs.writeFile(file,runtime);
    const display=path.join(folder,'display-mmd.js');let source=await fs.readFile(display,'utf8');
    source=once(source,'        DEFAULT_MMD_LIGHTING,','        getEditorBridge: () => state.runtime?.getEditorBridge?.(),\n        DEFAULT_MMD_LIGHTING,');
    source+=`\nimport('./web-editor-ui.mjs?v=${versions.get('web-editor-ui.mjs')}');\n`;
    await fs.writeFile(display,source);
}
module.exports={stage};
