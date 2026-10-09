import { clone,createHistory,putDocument,validateDocument,boneOrigins } from './web-editor-document.mjs';
import { createEditorView } from './web-editor-view.mjs';
import { saveProject,openProject,exportPmx,download } from './web-editor-project.mjs';
const style=document.createElement('style');style.textContent=`
#mmdEditor{position:fixed;left:10px;top:10px;z-index:80;color:#eee;font:13px system-ui;max-width:calc(100vw - 80px)}
#mmdEditor button,#mmdEditor select,#mmdEditor input{font:inherit;color:inherit;background:#242936;border:1px solid #525d73;border-radius:5px;padding:5px;margin:2px;box-sizing:border-box}
#mmdEditor button:disabled{opacity:.4}#mmdEditor button[aria-pressed=true]{background:#245783}#mmdEditor nav{display:flex;gap:3px;flex-wrap:wrap}
#mmdEditor .ed-panel{background:rgba(18,23,32,.94);border:1px solid #536078;border-radius:8px;padding:8px;margin-top:6px;max-height:75vh;overflow:auto;width:300px;max-width:calc(100vw - 100px)}
#mmdEditor .ed-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}#mmdEditor .ed-grid input{min-width:0;width:100%}#mmdEditor label{display:block;margin:5px 0}#mmdEditor label>input,#mmdEditor label>select{max-width:100%}
#mmdEditor #edObjects{width:100%;height:130px}#mmdEditor summary{cursor:pointer}#mmdEditor small{color:#aebfd4}#edStatus{max-width:310px;margin-top:5px;background:#18202bcf;padding:4px;border-radius:4px;white-space:pre-wrap}#mmdEditor [hidden]{display:none!important}
@media(min-width:1000px){#edProperties:not(:empty){position:fixed;right:80px;top:50px;width:270px;max-height:80vh;overflow:auto;background:#121720f2;padding:10px;border:1px solid #536078;border-radius:8px}}
`;document.head.append(style);
const host=document.createElement('section');host.id='mmdEditor';host.setAttribute('aria-label','模型工作区');host.innerHTML=`
<nav><button data-mode="edit">编辑</button><button data-mode="preview">预览</button><button data-mode="render">渲染</button><button id="edBlender" type="button" data-blender-only>Blender工程</button><button id="edCollapse" aria-expanded="false">展开</button></nav>
<div id="edStatus" role="status" aria-live="polite" hidden></div>
<div class="ed-panel" id="edPanel" hidden>
<div id="edPmxWorkspace">
<div><button id="edSave">保存工程</button><button id="edOpen">打开工程</button><button id="edExportPmx">导出 PMX</button><input id="edFile" type="file" accept=".zip" hidden></div>
<div><button data-face="0,0,1">正面</button><button data-face="1,0,0">侧面</button><button data-face="0,0,-1">背面</button><button id="edViewReset">自由视角</button></div>
<section id="edEditing" hidden><div><button id="edUndo">撤销</button><button id="edRedo">重做</button></div>
<select id="edKind"><option value="rigidBodies">刚体</option><option value="constraints">关节</option></select><input id="edSearch" placeholder="按名称筛选" aria-label="对象搜索">
<select id="edObjects" multiple aria-label="对象列表"></select><small>Ctrl／长按多选；属性修改应用于选中项。</small>
<div><button id="edAdd">新增</button><button id="edCopy">复制</button><button id="edMirror">镜像复制</button><button id="edDelete">删除</button></div>
<div><button data-tool="move">移动</button><button data-tool="rotate">旋转</button><button data-tool="scale">尺寸</button></div><small>拖动彩色轴；位置单位为模型单位，角度为度。</small><label><input id="edOnly" type="checkbox" checked>只显示选中的碰撞体／关节</label><div id="edProperties"></div></section>
<section id="edPreview"><button id="edPlay">播放／暂停</button><button id="edReset">重置物理</button><label><input id="edPhysics" type="checkbox">启用物理</label><input id="edTime" type="range" min="0" max="1" step="0.033333" value="0" aria-label="动作进度"><output id="edTimeText">无动作</output><small>拖动进度会关闭物理；可重新开启检查。</small></section>
<section id="edRender" hidden><label>宽 <input id="edWidth" type="number" min="64" max="4096" value="1920"></label><label>高 <input id="edHeight" type="number" min="64" max="4096" value="1080"></label><label><input id="edTransparent" type="checkbox" checked>透明背景</label><button id="edPng">导出 PNG</button><small>输出当前姿态和场景光照，不含操作面板。</small></section>
</div>
<div id="edBlenderSession" hidden></div>
`;document.body.append(host);
const $=id=>host.querySelector('#'+id),api=()=>window.DisplayMmd;
let mode='preview',kind='rigidBodies',selection=[],history=null,key='',bridge=null,view=null,busy=false,previousPhysics=true,previousPlay=true,dragStart=null,dragValue=null,project=null,dirty=false,blenderSession=null,blenderPrevious=null;
const status=message=>{$('edStatus').hidden=!message;$('edStatus').textContent=message;};
async function run(task){if(busy)return;busy=true;host.setAttribute('aria-busy','true');try{await task();}catch(error){status(error.message||String(error));}finally{busy=false;host.removeAttribute('aria-busy');}}
function snapshot(){const {mesh,profile}=bridge.read();return {mesh,profile,data:{rigidBodies:clone(mesh.geometry.userData.MMD.rigidBodies),constraints:clone(mesh.geometry.userData.MMD.constraints)}};}
function rebuildView(){if(!bridge||!history)return;view?.dispose();view=createEditorView(bridge,(index,add)=>{selection=add?[...new Set([...selection,index])]:[index];refresh();},transform);view.setOnlySelected($('edOnly').checked);view.setVisible(mode==='edit');refresh();}
function sync(){bridge=api()?.getEditorBridge?.();if(!bridge)return;const {profile,data}=snapshot();if(key!==profile.modelUrl||!history){key=profile.modelUrl;selection=[];history=createHistory(data,next=>{putDocument(key,next);dirty=true;refresh();});dirty=false;}rebuildView();}
function commit(next){validateDocument(next,bridge.read().mesh.skeleton.bones.length);history.commit(next);}
function refresh(){if(!history||!bridge)return;const doc=history.get(),items=doc[kind],search=$('edSearch').value.toLowerCase();selection=selection.filter(i=>i<items.length);const fragment=document.createDocumentFragment();items.forEach((item,index)=>{if(search&&!String(item.name).toLowerCase().includes(search))return;const option=document.createElement('option');option.value=index;option.textContent=`${index} · ${item.name||'未命名'}`;option.selected=selection.includes(index);fragment.append(option);});$('edObjects').replaceChildren(fragment);$('edUndo').disabled=!history.canUndo();$('edRedo').disabled=!history.canRedo();properties(doc);view?.update(bridge.read().mesh,doc,kind,selection);}
function field(label,path,value,options=null){const row=document.createElement('label');row.append(document.createTextNode(label+' '));const input=document.createElement(options?'select':'input');if(options){for(const [v,title]of options){const o=document.createElement('option');o.value=v;o.textContent=title;input.append(o);}}else{input.type=typeof value==='string'?'text':'number';if(input.type==='number')input.step='any';}input.value=value;input.dataset.path=path;row.append(input);return row;}
const vectorFields={position:'位置',rotation:'方向',translationLimitation1:'平移下限',translationLimitation2:'平移上限',rotationLimitation1:'旋转下限',rotationLimitation2:'旋转上限',springPosition:'平移弹簧 K',springRotation:'旋转弹簧 K'};
const isAngle=path=>path.startsWith('rotation');
function properties(doc){const box=$('edProperties');box.replaceChildren();if(!selection.length)return;const item=doc[kind][selection[0]],fragment=document.createDocumentFragment();fragment.append(field('名称','name',item.name||''));
    if(kind==='rigidBodies'){
        fragment.append(field('形状','shapeType',item.shapeType,[[0,'球'],[1,'盒'],[2,'胶囊']]));
        fragment.append(field('运动','type',item.type,[[0,'跟随骨骼'],[1,'物理'],[2,'物理＋骨骼位置']]));
        fragment.append(field('骨骼','boneIndex',item.boneIndex,[[-1,'无'],...bridge.read().mesh.skeleton.bones.map((b,i)=>[i,`${i} ${b.name}`])]));
        for(const [name,label]of Object.entries({width:'半径／盒半宽',height:'圆柱长度／盒半高',depth:'盒半深',weight:'质量',positionDamping:'平移阻尼',rotationDamping:'旋转阻尼',restitution:'恢复系数',friction:'摩擦',groupIndex:'碰撞组 0～15',groupTarget:'碰撞掩码 0～65535'}))fragment.append(field(label,name,item[name]));
    }else{const options=doc.rigidBodies.map((b,i)=>[i,`${i} ${b.name}`]);fragment.append(field('刚体 A','rigidBodyIndex1',item.rigidBodyIndex1,options),field('刚体 B','rigidBodyIndex2',item.rigidBodyIndex2,options));}
    for(const [name,label]of Object.entries(vectorFields)){if(!item[name])continue;const section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=label+(name==='position'&&kind==='rigidBodies'?'（骨骼相对）':'');section.append(legend);const grid=document.createElement('div');grid.className='ed-grid';item[name].forEach((v,i)=>{const row=field('XYZ'[i],name+'.'+i,isAngle(name)?v*180/Math.PI:v);grid.append(row);});section.append(grid);fragment.append(section);}box.append(fragment);
}
$('edProperties').addEventListener('change',event=>run(async()=>{const path=event.target.dataset.path;if(!path)return;const doc=history.get(),parts=path.split('.');let value=path==='name'?event.target.value:Number(event.target.value);if(isAngle(path))value*=Math.PI/180;const origins=boneOrigins(bridge.read().mesh,bridge.context.THREE);
for(const index of selection){const item=doc[kind][index];if(path==='boneIndex'){const old=origins[item.boneIndex]||[0,0,0],next=origins[value]||[0,0,0];item.position=item.position.map((v,i)=>v+old[i]-next[i]);}if(parts.length===2)item[parts[0]][Number(parts[1])]=value;else item[path]=value;
if(path==='shapeType'){item.height=Math.max(.1,item.height);item.depth=Math.max(.1,item.depth);}}
commit(doc);status('修改已记录；切到预览检查物理。');}));
function transform(axis,amount,tool,finish){try{if(finish){if(dragValue)commit(dragValue);dragStart=dragValue=null;return;}dragStart ||= history.get();const next=clone(dragStart);for(const i of selection){const item=next[kind][i];if(tool==='scale'&&kind==='rigidBodies'){const name=item.shapeType===1?['width','height','depth'][axis]:item.shapeType===2&&axis===1?'height':'width';item[name]=Math.max(.001,item[name]*Math.max(.05,1+amount*.2));}else item[tool==='rotate'?'rotation':'position'][axis]+=amount;}dragValue=next;view.update(bridge.read().mesh,next,kind,selection);}catch(error){status(error.message);}}
async function workspace(next){if(blenderSession){mode=next;blenderSession.setMode(next);$('edPanel').hidden=false;$('edCollapse').textContent='收起';$('edCollapse').setAttribute('aria-expanded','true');for(const b of host.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));return;}if(!api()?.getState().modelReady)throw new Error('模型尚未加载');if(next==='edit')api().getEditorBridge().read();if(next===mode&&bridge){$('edPanel').hidden=false;$('edCollapse').textContent='收起';return;}const was=mode;view?.setVisible(false);
    if(next==='edit'){previousPhysics=api().getState().physicsEnabled;previousPlay=api().getState().motionPlaybackEnabled;api().setMotionPlaybackEnabled(false);if(!await api().setPhysicsEnabled(false))throw new Error('暂停物理失败');bridge=api().getEditorBridge();bridge.rest();api().setPointerEnabled(false);}
    else if(was==='edit'){if(previousPhysics){if(!await api().setPhysicsEnabled(true))throw new Error('重建物理失败');}else if(!await api().loadModel(api().getModelProfile()))throw new Error('应用修改失败');api().setPointerEnabled(true);api().setMotionPlaybackEnabled(previousPlay);}
    mode=next;sync();$('edPanel').hidden=false;$('edCollapse').textContent='收起';$('edCollapse').setAttribute('aria-expanded','true');$('edEditing').hidden=mode!=='edit';$('edPreview').hidden=mode==='edit';$('edRender').hidden=mode!=='render';$('edPhysics').checked=api().getState().physicsEnabled;for(const b of host.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));status(mode==='edit'?'绑定姿态编辑；修改切到预览后生效。':'');
}
for(const button of host.querySelectorAll('[data-mode]'))button.onclick=()=>run(()=>workspace(button.dataset.mode));
if($('edBlender'))$('edBlender').onclick=()=>run(async()=>{
    const button=$('edBlender');
    if(button.disabled)return;
    $('edPanel').hidden=false;$('edCollapse').textContent='收起';$('edCollapse').setAttribute('aria-expanded','true');
    status('请选择包含 Blender 工程的目录。');
    button.disabled=true;
    try{
        if(!window.showDirectoryPicker)throw new Error('Blender工程需要支持目录读写的桌面Chromium浏览器。');
        const directory=await window.showDirectoryPicker({mode:'readwrite'});
        status('正在加载 Blender 工程工作区…');
        const module=await import('__BLENDER_WORKBENCH_URL__');
        $('edPmxWorkspace').hidden=true;$('edBlenderSession').hidden=false;
        const restoreMmd=async()=>{
            if(!blenderPrevious)return;
            const previous=blenderPrevious;blenderPrevious=null;
            api()?.setPointerEnabled(previous.pointer);
            if(previous.physics!==api()?.getState().physicsEnabled&&api()?.getState().modelReady)await api().setPhysicsEnabled(previous.physics);
            api()?.setMotionPlaybackEnabled(previous.play===true);
            mode=previous.uiMode;
            $('edEditing').hidden=mode!=='edit';$('edPreview').hidden=mode==='edit';$('edRender').hidden=mode!=='render';
            $('edPhysics').checked=api()?.getState().physicsEnabled===true;
            view?.setVisible(mode==='edit');
        };
        const onClosed=async()=>{
            blenderSession=null;$('edBlenderSession').replaceChildren();$('edBlenderSession').hidden=true;$('edPmxWorkspace').hidden=false;button.disabled=false;
            await restoreMmd();
            for(const b of host.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
        };
        blenderSession=await module.mountBlenderWorkbench(directory,{
            displayBridge:api()?.getEditorBridge?.(),container:$('edBlenderSession'),
            onStart:async()=>{
                const state=api()?.getState();if(!state?.modelReady)throw new Error('当前角色尚未加载');
                blenderPrevious={physics:state.physicsEnabled,play:state.motionPlaybackEnabled,pointer:mode!=='edit',uiMode:mode};
                view?.setVisible(false);api().setMotionPlaybackEnabled(false);
                if(state.physicsEnabled&&!await api().setPhysicsEnabled(false))throw new Error('暂停当前角色物理失败');
            },
            onClosed,
            onModeChange:next=>{mode=next;for(const b of host.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}
        });
        status('');
    }catch(error){
        if(!blenderSession){$('edBlenderSession').replaceChildren();$('edBlenderSession').hidden=true;$('edPmxWorkspace').hidden=false;}
        button.disabled=false;
        if(error?.name==='AbortError'){status('');return;}
        throw error;
    }
});
for(const button of host.querySelectorAll('[data-tool]'))button.onclick=()=>{view?.setMode(button.dataset.tool);};
$('edCollapse').onclick=()=>{$('edPanel').hidden=!$('edPanel').hidden;$('edCollapse').textContent=$('edPanel').hidden?'展开':'收起';$('edCollapse').setAttribute('aria-expanded',String(!$('edPanel').hidden));if(!$('edPanel').hidden&&!history)run(async()=>sync());};
$('edObjects').onchange=()=>{selection=[...$('edObjects').selectedOptions].map(o=>Number(o.value));refresh();};$('edKind').onchange=()=>{kind=$('edKind').value;selection=[];refresh();};$('edSearch').oninput=refresh;
$('edUndo').onclick=()=>{if(!busy)history?.undo();};$('edRedo').onclick=()=>{if(!busy)history?.redo();};$('edOnly').onchange=()=>{view?.setOnlySelected($('edOnly').checked);refresh();};
$('edAdd').onclick=()=>run(async()=>{const doc=history.get();if(kind==='rigidBodies')doc.rigidBodies.push({_pmxSourceIndex:null,name:'新刚体',boneIndex:-1,groupIndex:0,groupTarget:65535,shapeType:0,width:.5,height:.5,depth:.5,position:[0,10,0],rotation:[0,0,0],weight:1,positionDamping:.5,rotationDamping:.5,restitution:0,friction:.5,type:0});else{if(doc.rigidBodies.length<2)throw new Error('至少需要两个刚体');doc.constraints.push({_pmxSourceIndex:null,name:'新关节',type:0,rigidBodyIndex1:0,rigidBodyIndex2:1,position:[0,10,0],rotation:[0,0,0],translationLimitation1:[0,0,0],translationLimitation2:[0,0,0],rotationLimitation1:[0,0,0],rotationLimitation2:[0,0,0],springPosition:[0,0,0],springRotation:[0,0,0]});}selection=[doc[kind].length-1];commit(doc);});
function copy(mirror){const doc=history.get(),added=[],bones=bridge.read().mesh.skeleton.bones,origins=boneOrigins(bridge.read().mesh,bridge.context.THREE);for(const index of selection){const item=clone(doc[kind][index]);item._pmxSourceIndex=null;delete item._pmxSource;item.name=(item.name||'')+(mirror?'_镜像':'_复制');if(mirror){item.position[0]*=-1;item.rotation[1]*=-1;item.rotation[2]*=-1;if(kind==='rigidBodies'&&item.boneIndex>=0){const name=bones[item.boneIndex].name;const other=name.replace(/[左右]/,c=>c==='左'?'右':'左');const found=bones.findIndex(b=>b.name===other);const oldOrigin=origins[item.boneIndex]||[0,0,0];if(found>=0)item.boneIndex=found;const newOrigin=origins[item.boneIndex]||[0,0,0];item.position=item.position.map((v,i)=>v+(i===0?-oldOrigin[i]:oldOrigin[i])-newOrigin[i]);}if(kind==='constraints'){for(const [prefix,axes]of [['translation',[0]],['rotation',[1,2]]])for(const axis of axes){const a=item[prefix+'Limitation1'][axis],b=item[prefix+'Limitation2'][axis];item[prefix+'Limitation1'][axis]=-b;item[prefix+'Limitation2'][axis]=-a;}}}added.push(doc[kind].length);doc[kind].push(item);}selection=added;commit(doc);}
$('edCopy').onclick=()=>run(async()=>copy(false));$('edMirror').onclick=()=>run(async()=>{copy(true);status('已镜像复制；关节连接端请在属性中核对。');});
$('edDelete').onclick=()=>run(async()=>{const doc=history.get(),remove=new Set(selection);if(kind==='rigidBodies'){const mapping=new Map();doc.rigidBodies=doc.rigidBodies.filter((b,i)=>{if(remove.has(i))return false;mapping.set(i,mapping.size);return true;});doc.constraints=doc.constraints.filter(j=>mapping.has(j.rigidBodyIndex1)&&mapping.has(j.rigidBodyIndex2)).map(j=>({...j,rigidBodyIndex1:mapping.get(j.rigidBodyIndex1),rigidBodyIndex2:mapping.get(j.rigidBodyIndex2)}));}else doc.constraints=doc.constraints.filter((j,i)=>!remove.has(i));selection=[];commit(doc);});
$('edPlay').onclick=()=>api()?.setMotionPlaybackEnabled(!api().getState().motionPlaybackEnabled);
$('edPhysics').onchange=()=>run(async()=>{if(!await api().setPhysicsEnabled($('edPhysics').checked))throw new Error('切换物理失败');});
$('edReset').onclick=()=>run(async()=>{if(!await api().loadModel(api().getModelProfile()))throw new Error('重置失败');});
$('edTime').onchange=()=>run(async()=>{api().setMotionPlaybackEnabled(false);await api().setPhysicsEnabled(false);$('edPhysics').checked=false;api().getEditorBridge().seek(Number($('edTime').value));});
const settings=()=>({referenceHz:api().getEditorBridge().context.referenceHz,camera:api().getEditorBridge().cameraView(),lighting:api().getLighting(),wind:api().getWindSettings(),solver:api().getPhysicsSolver(),screenLighting:window.MmdArScreenLighting,physics:mode==='edit'?previousPhysics:api().getState().physicsEnabled,play:mode==='edit'?previousPlay:api().getState().motionPlaybackEnabled});
$('edExportPmx').onclick=()=>run(async()=>{if(!history)sync();const {profile}=bridge.read();status('正在生成修改后的PMX…');await new Promise(resolve=>setTimeout(resolve,0));const {blob,name}=await exportPmx(profile,history.get());download(blob,name);status('PMX已导出；请与原贴图保持相同相对路径。灯光和动作等设置请另存工程ZIP。');});
$('edSave').onclick=()=>run(async()=>{if(!history)sync();status('正在打包原始模型与贴图…');const blob=await saveProject(bridge.read().profile,history.get(),settings());download(blob,'mmd-ar-project.zip');dirty=false;status('工程包已生成，可通过“打开工程”恢复。');});
$('edOpen').onclick=()=>$('edFile').click();$('edFile').onchange=()=>run(async()=>{const file=$('edFile').files[0];if(!file)return;status('正在打开工程…');const next=await openProject(file);try{api().setMotionPlaybackEnabled(false);if(!await api().loadModel(next.profile))throw new Error('工程模型加载失败');const old=project;project=next;old?.release();key='';history=null;mode='preview';sync();if(Number.isFinite(next.settings.referenceHz))api().setPhysicsStabilityReference(next.settings.referenceHz);if(next.settings.camera)api().getEditorBridge().setCameraView(next.settings.camera);if(next.settings.lighting)api().setLighting(next.settings.lighting);if(next.settings.wind)api().setWindSettings(next.settings.wind);if(next.settings.screenLighting)window.MmdArScreenLighting=Object.freeze({...next.settings.screenLighting});if(next.settings.solver)await api().setPhysicsSolver(next.settings.solver);await api().setPhysicsEnabled(next.settings.physics!==false);api().setMotionPlaybackEnabled(next.settings.play===true);await workspace('edit');dirty=false;status('工程已恢复，当前为绑定姿态编辑。');}catch(error){if(project!==next)next.release();throw error;}finally{$('edFile').value='';}});
$('edPng').onclick=()=>run(async()=>{const playing=api().getState().motionPlaybackEnabled;api().setMotionPlaybackEnabled(false);view?.setVisible(false);try{const blob=await api().getEditorBridge().capture($('edWidth').value,$('edHeight').value,$('edTransparent').checked);download(blob,'mmd-ar-render.png');status('PNG已生成。');}finally{api().setMotionPlaybackEnabled(playing);view?.setVisible(mode==='edit');}});
document.addEventListener('mmd-ar-character-loaded',()=>{blenderSession?.refreshCharacter();if(history&&!blenderSession)setTimeout(()=>{try{sync();if(mode==='edit')bridge.rest();}catch(error){view?.dispose();view=null;bridge=null;history=null;key='';api()?.setPointerEnabled(true);status(error.message);}},0);});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if($('edPanel').hidden||mode==='edit'||!api())return;const p=api().getMotionProgress();if(p){$('edTime').max=p.durationSeconds;if(document.activeElement!==$('edTime'))$('edTime').value=p.timeSeconds;$('edTimeText').textContent=`${p.timeSeconds.toFixed(2)} / ${p.durationSeconds.toFixed(2)}秒`;}},250);

for(const button of host.querySelectorAll('[data-face]'))button.onclick=()=>run(async()=>api().getEditorBridge().face(button.dataset.face.split(',').map(Number)));
$('edViewReset').onclick=()=>api()?.getEditorBridge()?.resetCameraView();
