import { projectPose, fitPoseAlignment, POSE_EDGES, poseMovement } from './web-human-pose-projection.mjs';
import { fitImageCamera } from './web-human-pose-camera.mjs';

export function installPoseOverlay(panel, root, { preview, human, redraw }) {
    const controls=document.createElement('div'); controls.dataset.poseOverlayPanel='';
    controls.innerHTML=`<label><input data-pose-overlay="enabled" type="checkbox">叠加当前实际骨架（青色）</label>
        <label><input data-pose-overlay="reference" type="checkbox" checked>显示识别参考点</label>
        <div class="display-mmd-ar-actions"><button type="button" data-pose-overlay="capture">按当前视角重新投影</button>
        <button type="button" data-pose-overlay="match">匹配图片视角（估计）</button>
        <button type="button" data-pose-overlay="restore">恢复匹配前视角</button>
        <button type="button" data-pose-overlay="cancel">取消视角匹配</button></div>
        <div data-pose-overlay="alignment"><label>叠加水平 <input data-pose-overlay="x" type="range" min="-100" max="100" value="0"></label>
        <label>叠加垂直 <input data-pose-overlay="y" type="range" min="-100" max="100" value="0"></label>
        <label>叠加缩放 <input data-pose-overlay="scale" type="range" min="0.2" max="3" step="0.01" value="1"></label></div>
        <p>图片只作对照，请在3D场景拖控制点。先让姿态接近参考图，再匹配视角；单图机位为估计。</p>
        <p data-pose-overlay="status" role="status"></p>`;
    preview.insertAdjacentElement('beforebegin',controls);
    const field=key=>controls.querySelector('[data-pose-overlay="'+key+'"]'), base=document.createElement('canvas');
    let image=null,pose=null,view=null,alignment=null,boundToken=null,frame=0,last=0,epoch=0,ready=false,disposed=false,fitting=false,projectionBaseline=null;
    const visible=()=>!disposed&&!panel.hidden&&root.open;
    const status=text=>{field('status').textContent=text;};
    function buttons() {
        field('enabled').disabled=!ready||!image;
        field('capture').disabled=!ready||!image||fitting;
        field('match').disabled=!ready||!pose||!image||fitting;
        field('cancel').disabled=!fitting;
        for(const key of ['x','y','scale']) field(key).disabled=!field('enabled').checked||!view||fitting;
        let canRestore=false;
        try {if(ready) canRestore=human().getImageCameraState?.().canRestore===true;} catch(error) { /* 模型正在切换时等待下一次同步。 */ }
        field('restore').disabled=!canRestore||fitting;
    }
    function stop() {if(frame) cancelAnimationFrame(frame);frame=0;}
    function cancel() {epoch++;fitting=false;stop();buttons();}
    function resetAlignment() {field('x').value=field('y').value='0';field('scale').value='1';}
    function capture(snapshot) {
        view=structuredClone(snapshot.view); boundToken=snapshot.token;
        alignment=fitPoseAlignment(projectPose(snapshot.points,view),base.width,base.height);resetAlignment();
    }
    function drawSnapshot(snapshot) {
        const ctx=preview.getContext('2d');ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(base,0,0);
        if(!field('enabled').checked) return;
        if(!view) capture(snapshot);
        const projected=projectPose(snapshot.points,view), byKey=new Map(projected.map(p=>[p.key,p]));
        const scale=alignment.scale*Number(field('scale').value), x=alignment.x+base.width*Number(field('x').value)/100,
            y=alignment.y+base.height*Number(field('y').value)/100;
        const at=p=>[x+p.x*scale,y+p.y*scale];
        ctx.strokeStyle='#19d8ff';ctx.fillStyle='#19d8ff';ctx.lineWidth=2;
        for(const [a,b] of POSE_EDGES) {const p=byKey.get(a),q=byKey.get(b);if(!p?.visible||!q?.visible)continue;
            ctx.beginPath();ctx.moveTo(...at(p));ctx.lineTo(...at(q));ctx.stroke();}
        for(const p of projected) if(p.visible) {ctx.beginPath();ctx.arc(...at(p),3,0,Math.PI*2);ctx.fill();}
    }
    function render(now=0) {
        frame=0;if(!visible()||!ready||!image||!field('enabled').checked)return;
        if(now-last>=1000/15||!view) {
            try {
                const snapshot=human().getImagePoseSnapshot();
                if(boundToken&&boundToken!==snapshot.token) {cancel();view=null;field('enabled').checked=false;redraw();status('模型已切换，请重新叠加实际骨架');return;}
                drawSnapshot(snapshot);last=now;buttons();
            } catch(error) {field('enabled').checked=false;status(error.message);buttons();return;}
        }
        frame=requestAnimationFrame(render);
    }
    function start() {if(!frame&&visible()&&ready&&image&&field('enabled').checked)frame=requestAnimationFrame(render);}
    field('enabled').addEventListener('change',()=>{
        cancel();if(field('enabled').checked) {view=null;boundToken=null;status('固定当前投影，实际骨架会跟随3D姿态更新');start();}
        else {preview.getContext('2d').clearRect(0,0,preview.width,preview.height);preview.getContext('2d').drawImage(base,0,0);}buttons();
    });
    field('reference').addEventListener('change',redraw);
    field('capture').addEventListener('click',()=>{try {cancel();capture(human().getImagePoseSnapshot());field('enabled').checked=true;start();status('已按当前视角重新投影');}catch(error){status(error.message);}});
    for(const key of ['x','y','scale'])field(key).addEventListener('input',()=>{cancel();last=0;start();});
    field('cancel').addEventListener('click',()=>{cancel();status('视角匹配已取消，当前视角保持不变');start();});
    field('match').addEventListener('click',async()=>{
        if(!visible()||!ready||!image||!pose||fitting)return;
        cancel();const id=++epoch,api=human(),sourceImage=image,sourcePose=pose;
        let snapshot;
        try {
            snapshot=api.getImagePoseSnapshot();const camera=api.getImageCameraState();
            if(!camera.available)throw new Error(camera.reason);
            fitting=true;buttons();status('正在本机估计相机视角…');start();
            const isCurrent=()=>id===epoch&&visible()&&ready&&image===sourceImage&&pose===sourcePose;
            const result=await fitImageCamera(snapshot,sourcePose,{aspect:sourceImage.width/sourceImage.height,isCurrent,maxPitch:camera.maxPitch});
            if(!isCurrent())return;
            if(poseMovement(snapshot,api.getImagePoseSnapshot())>.005)throw new Error('人物姿态仍在变化，请稳定后重新匹配');
            if(result.totalError>=result.baselineError-.0001&&result.baselineError>.008)throw new Error('未找到更好的视角，请检查姿态和参考点');
            api.applyImageCamera(result.view,camera.revision,snapshot.token);
            if(!projectionBaseline)projectionBaseline={view,alignment,boundToken,image};
            view=result.referenceView;alignment={scale:base.height,x:base.width/2,y:base.height/2};boundToken=snapshot.token;
            resetAlignment();field('enabled').checked=true;last=0;
            status(`已匹配估计视角：${result.inliers}个对应点，误差为图片高度的${(result.error*100).toFixed(1)}%。可在3D继续微调。`);start();
        } catch(error) {if(id===epoch&&error.name!=='AbortError')status(error.message);}
        finally {if(id===epoch){fitting=false;buttons();start();}}
    });
    field('restore').addEventListener('click',()=>{
        try {cancel();human().restoreImageCamera();
            if(projectionBaseline?.image===image){({view,alignment,boundToken}=projectionBaseline);}
            else {view=null;boundToken=null;}
            projectionBaseline=null;resetAlignment();last=0;status('已恢复匹配前视角');buttons();start();
        }catch(error){status(error.message);buttons();}
    });
    function onToggle(){if(root.open)start();else cancel();}
    root.addEventListener('toggle',onToggle);
    buttons();
    return {
        showReference:()=>field('reference').checked,
        setReference(nextImage,nextPose) {
            if(image!==nextImage||pose!==nextPose)cancel();
            if(image!==nextImage){view=alignment=null;boundToken=null;field('enabled').checked=false;projectionBaseline=null;resetAlignment();}
            image=nextImage;pose=nextPose;base.width=preview.width;base.height=preview.height;
            if(image)base.getContext('2d').drawImage(preview,0,0);buttons();last=0;start();
        },
        sync(value) {ready=value;if(!visible()||!ready)stop();else start();buttons();},cancel,
        dispose(){disposed=true;cancel();root.removeEventListener('toggle',onToggle);base.width=base.height=0;image=pose=view=null;}
    };
}
