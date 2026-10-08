'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {hashFile}=require('./apk-artifact');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('编辑器缺少唯一锚点：'+a.slice(0,70));return s.replace(a,b);};
async function stage(root){
    const folder=path.join(root,'js');
    const names=['web-editor-document.mjs','web-editor-bridge.mjs','web-editor-view.mjs','web-editor-project.mjs','web-editor-ui.mjs'];
    await fs.copyFile(path.join(path.dirname(require.resolve('three')),'../examples/jsm/libs/fflate.module.js'),path.join(folder,'web-editor-zip.mjs'));
    await fs.copyFile(path.join(__dirname,'web-editor-zip.LICENSE.txt'),path.join(folder,'web-editor-zip.LICENSE.txt'));
    const versions=new Map([['web-local-assets.mjs',(await hashFile(path.join(folder,'web-local-assets.mjs'))).sha256.slice(0,12)],['web-editor-zip.mjs',(await hashFile(path.join(folder,'web-editor-zip.mjs'))).sha256.slice(0,12)]]);
    for(const name of names){
        let text=await fs.readFile(path.join(__dirname,name),'utf8');
        for(const [dependency,hash] of versions)text=text.replaceAll('./'+dependency,'./'+dependency+'?v='+hash);
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
            get referenceHz(){return physicsStabilityReferenceHz;},get mesh(){return currentMesh;},get profile(){return currentProfile;},get helper(){return helper.current;} }),
        getMotionProgress: () => {`);
    await fs.writeFile(file,runtime);
    const display=path.join(folder,'display-mmd.js');let source=await fs.readFile(display,'utf8');
    source=once(source,'        DEFAULT_MMD_LIGHTING,','        getEditorBridge: () => state.runtime?.getEditorBridge?.(),\n        DEFAULT_MMD_LIGHTING,');
    source+=`\nimport('./web-editor-ui.mjs?v=${versions.get('web-editor-ui.mjs')}');\n`;
    await fs.writeFile(display,source);
}
module.exports={stage};
