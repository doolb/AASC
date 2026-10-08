import { zip, unzipSync, strToU8, strFromU8 } from './web-editor-zip.mjs';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { getLocalAssetFiles, readLocalAsset, createLocalModelSelection, createLocalMotionSelection, localFilePath, normalizeLocalPath } from './web-local-assets.mjs';
import { putDocument, validateDocument } from './web-editor-document.mjs';
const LIMIT=256*1024*1024;
export function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function read(url){const local=await readLocalAsset(url);if(local)return new Uint8Array(local);const u=new URL(url,location.href);if(u.origin!==location.origin)throw new Error('工程仅打包同源或已选择资源');const response=await fetch(u);if(!response.ok)throw new Error('资源读取失败：'+url);const buffer=await response.arrayBuffer();if(buffer.byteLength>LIMIT)throw new Error('资源过大');return new Uint8Array(buffer);}
export async function saveProject(profile,doc,settings){
    const entries={},local=getLocalAssetFiles(profile.modelUrl);let model;
    if(local){if(local.reduce((n,file)=>n+file.size,0)>LIMIT)throw new Error('本地工程资源超过256MB');for(const file of local)entries['assets/'+localFilePath(file)]=new Uint8Array(await file.arrayBuffer());model=decodeURIComponent(profile.modelUrl.replace(/^\.\/mmd\/__local__\/[^/]+\//,''));}
    else {
        model=decodeURIComponent(new URL(profile.modelUrl,location.href).pathname.slice(1));const buffer=await read(profile.modelUrl);entries['assets/'+model]=buffer;
        const parsed=new MMDLoader()._getParser().parsePmx(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),true);
        for(const texture of new Set(parsed.textures)){
            if(!texture)continue;const url=new URL(texture.replaceAll('\\','/'),new URL(profile.modelUrl,location.href));
            const path=decodeURIComponent(url.pathname.slice(1));entries['assets/'+normalizeLocalPath(path)]=await read(url.href);
        }
    }
    const manifest={format:'aasc-mmd-editor',version:1,model,doc,settings};
    if(profile.motionUrl){entries['assets/__editor/motion.vmd']=await read(profile.motionUrl);manifest.motion='__editor/motion.vmd';}
    if(profile.materialSourceUrl){entries['assets/__editor/material.glb']=await read(profile.materialSourceUrl);manifest.material='__editor/material.glb';}
    if(Object.values(entries).reduce((n,b)=>n+b.length,0)>LIMIT)throw new Error('工程资源总量超过256MB');
    entries['project.json']=strToU8(JSON.stringify(manifest));
    const bytes=await new Promise((resolve,reject)=>zip(entries,{level:1},(error,result)=>error?reject(error):resolve(result)));
    return new Blob([bytes],{type:'application/zip'});
}
export async function openProject(file){
    if(file.size>LIMIT)throw new Error('工程包超过256MB');
    const bytes=new Uint8Array(await file.arrayBuffer());inspectZip(bytes);
    const entries=unzipSync(bytes);
    if(Object.values(entries).reduce((n,b)=>n+b.length,0)>LIMIT)throw new Error('展开资源超过256MB');
    const manifest=JSON.parse(strFromU8(entries['project.json']||new Uint8Array()));
    if(manifest.format!=='aasc-mmd-editor'||manifest.version!==1)throw new Error('不支持的工程版本');
    const files=Object.entries(entries).filter(([name])=>name.startsWith('assets/')).map(([name,bytes])=>{
        const path=name.slice(7),f=new File([bytes],path.split('/').at(-1));Object.defineProperty(f,'webkitRelativePath',{value:path});return f;
    });
    const model=files.find(f=>localFilePath(f)===manifest.model);if(!model)throw new Error('工程缺少模型');
    const parsed=new MMDLoader()._getParser().parsePmx(await model.arrayBuffer(),true);validateDocument(manifest.doc,parsed.bones.length);
    const selection=createLocalModelSelection(files,model);let motion=null;
    try {
        if(manifest.motion){const f=files.find(f=>localFilePath(f)===manifest.motion);if(!f)throw new Error('工程缺少动作');motion=createLocalMotionSelection(f);Object.assign(selection.profile,{motionUrl:motion.motionUrl,motionResourceId:motion.motionResourceId});}
        if(manifest.material){if(!files.some(f=>localFilePath(f)===manifest.material))throw new Error('工程缺少材质源');selection.profile.materialSourceUrl=selection.profile.resourceId.slice(6)+manifest.material.split('/').map(encodeURIComponent).join('/');}
        putDocument(selection.profile.modelUrl,manifest.doc);
        return {profile:selection.profile,doc:manifest.doc,settings:manifest.settings||{},release(){selection.release();motion?.release();}};
    } catch(error){selection.release();motion?.release();throw error;}
}

// 旧版压缩库没有filter回调；解压前直接核对中央目录，避免先分配超大缓冲。
export function inspectZip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),size=bytes.length;
    if(size<22)throw new Error('工程ZIP不完整');let end=-1;
    for(let i=size-22;i>=Math.max(0,size-65558);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===size){end=i;break;}
    if(end<0)throw new Error('工程ZIP目录缺失');
    const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),length=view.getUint32(end+12,true);
    if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||!count||count>4096||offset+length>end)throw new Error('不支持分卷/ZIP64或超量工程');
    let at=offset,total=0;const names=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});
    for(let i=0;i<count;i++){
        if(at+46>offset+length||view.getUint32(at,true)!==0x02014b50)throw new Error('ZIP目录无效');
        const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),compressed=view.getUint32(at+20,true),expanded=view.getUint32(at+24,true);
        const nameSize=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),local=view.getUint32(at+42,true);
        if(at+46+nameSize+extra+comment>offset+length||(total+=expanded)>LIMIT||flags&1||![0,8].includes(method))throw new Error('工程资源大小或压缩方式不支持');
        const name=decoder.decode(bytes.subarray(at+46,at+46+nameSize));
        if(!name||normalizeLocalPath(name)!==name||names.has(name)||name==='__proto__')throw new Error('工程路径重复或无效');names.add(name);
        if(local+30>offset||view.getUint32(local,true)!==0x04034b50||local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true)+compressed>offset)throw new Error('工程文件区间无效');
        at+=46+nameSize+extra+comment;
    }
    if(at!==offset+length||!names.has('project.json'))throw new Error('工程清单缺失');return {count,total};
}
