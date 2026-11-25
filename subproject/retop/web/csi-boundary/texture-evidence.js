// 贴图只提供曲面颜色证据；UV 接缝、图片像素边界本身不等同结构分区。
function createCSITextureEvidence(E) {
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function validUV(mesh) {
    const uv=mesh.sourceUV;
    return uv && Array.isArray(uv.uv) && uv.uv.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)) &&
      Array.isArray(uv.indices) && uv.indices.length===mesh.faces.length && uv.indices.every((f,i)=>f.length===mesh.faces[i].length&&f.every(n=>Number.isInteger(n)&&n>=0&&n<uv.uv.length));
  }
  function sample(source,mesh,image,progress=()=>{}) {
    if(!validUV(source)) throw Error('原模型缺少有效 UV，无法使用贴图判断。');
    if(!image || !Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096||image.data?.length!==image.width*image.height*4) throw Error('贴图像素数据无效。');
    const pixel=uv=>{
      // 常规0～1范围夹到边缘，范围外重复；V轴从OBJ向图片顶部坐标转换。
      const wrap=v=>v>=0&&v<=1?v:((v%1)+1)%1;
      const x=wrap(uv[0])*(image.width-1),y=(1-wrap(uv[1]))*(image.height-1),x0=Math.floor(x),y0=Math.floor(y),out=[0,0,0];
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){const w=(i?x-x0:1-x+x0)*(j?y-y0:1-y+y0),k=(Math.min(y0+j,image.height-1)*image.width+Math.min(x0+i,image.width-1))*4;for(let c=0;c<3;c++)out[c]+=image.data[k+c]*w/255;}
      return out;
    };
    const faceUV=(model,i,weights)=>model.sourceUV.indices[i].reduce((s,n,j)=>{const p=model.sourceUV.uv[n],w=weights?weights[j]:1/model.faces[i].length;return [s[0]+p[0]*w,s[1]+p[1]*w];},[0,0]);
    const fingerprint=E.fingerprint(mesh);
    if(validUV(mesh))return {version:1,analysisFingerprint:fingerprint,textureName:image.name||'贴图',colors:mesh.faces.map((_,i)=>pixel(faceUV(mesh,i))),coverage:1,method:'原面UV中心双线性采样'};
    progress('映射原高模 UV 到分析代理');
    const bounds=E.bounds(source),cell=bounds.diagonal/80,grid=new Map(),centers=new Float64Array(source.faces.length*3),normals=new Float32Array(source.faces.length*3);
    const coord=p=>p.map(v=>Math.floor(v/cell)),key=(x,y,z)=>x+','+y+','+z;
    source.faces.forEach((f,i)=>{
      const p=[0,0,0];for(const v of f)for(let k=0;k<3;k++)p[k]+=source.vertices[v][k]/f.length;
      const n=E.unit(E.cross(E.sub(source.vertices[f[1]],source.vertices[f[0]]),E.sub(source.vertices[f[2]],source.vertices[f[0]])));
      centers.set(p,i*3);normals.set(n,i*3);const k=key(...coord(p));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);
    });
    const target=E.topology(mesh),limit=bounds.diagonal*.02;let hits=0,maxDistance=0;
    const colors=target.data.map(d=>{
      const p=d.center,c=coord(p);let best=-1,distance=limit*limit;
      // 只在局部邻域内匹配方向一致的面，避免穿过衣物或薄片采到背面颜色。
      for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)for(const i of grid.get(key(c[0]+x,c[1]+y,c[2]+z))||[]){
        let dist=0,dot=0;for(let k=0;k<3;k++){dist+=(centers[i*3+k]-p[k])**2;dot+=normals[i*3+k]*d.normal[k];}
        if(dist<distance&&dot>.25){best=i;distance=dist;}
      }
      if(best<0)return null;
      // 用选定原面的三角扇计算受限重心坐标，不使用代理面错误地索引原UV。
      const f=source.faces[best];let closest=Infinity,uv=null;
      for(let j=1;j<f.length-1;j++){
        const a=source.vertices[f[0]],b=source.vertices[f[j]],c=source.vertices[f[j+1]],v0=E.sub(b,a),v1=E.sub(c,a),v2=E.sub(p,a);
        const aa=E.dot(v0,v0),ab=E.dot(v0,v1),bb=E.dot(v1,v1),pa=E.dot(v2,v0),pb=E.dot(v2,v1),den=aa*bb-ab*ab;
        if(Math.abs(den)<1e-24)continue;
        let w=[1-(bb*pa-ab*pb)/den-(aa*pb-ab*pa)/den,(bb*pa-ab*pb)/den,(aa*pb-ab*pa)/den];w=w.map(v=>Math.max(0,v));const sum=w.reduce((s,v)=>s+v,0);w=w.map(v=>v/sum);
        const q=[0,1,2].map(k=>a[k]*w[0]+b[k]*w[1]+c[k]*w[2]),dist=E.dist(q,p);
        if(dist<closest){closest=dist;uv=[0,0];[0,j,j+1].forEach((corner,k)=>{const t=source.sourceUV.uv[source.sourceUV.indices[best][corner]];uv[0]+=t[0]*w[k];uv[1]+=t[1]*w[k];});}
      }
      if(!uv||closest>limit)return null;hits++;maxDistance=Math.max(maxDistance,closest);return pixel(uv);
    });
    return {version:1,analysisFingerprint:fingerprint,textureName:image.name||'贴图',colors,coverage:hits/mesh.faces.length,maxDistance,method:'局部同向原面近邻UV映射（近似）'};
  }
  function segment(mesh,base,colors,strength,granularity=.7) {
    if(!Number.isFinite(strength)||strength<0||strength>1)throw Error('贴图参与强度须为0～1。');
    if(base.length!==mesh.faces.length||colors.length!==base.length||colors.some(c=>c!==null&&(!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isFinite(v)||v<0||v>1))))throw Error('贴图颜色证据与模型不匹配。');
    if(strength===0)return {groups:base.slice(),added:0};
    const t=E.topology(mesh),n=base.length,parent=Array.from({length:n},(_,i)=>i),size=Array(n).fill(1),internal=Array(n).fill(0),links=[];
    const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    const join=(a,b,w)=>{parent[b]=a;size[a]+=size[b];internal[a]=Math.max(w,internal[a],internal[b]);};
    for(const edge of t.edges.values())if(edge.faces.length===2){const [a,b]=edge.faces;if(base[a]!==base[b])continue;
      const color=colors[a]&&colors[b]?Math.hypot(...colors[a].map((v,k)=>v-colors[b][k]))/Math.sqrt(3):0;
      const bend=1-clamp(E.dot(t.data[a].normal,t.data[b].normal),-1,1);
      links.push({a,b,w:color*strength+bend*.12});
    }
    links.sort((a,b)=>a.w-b.w||a.a-b.a||a.b-b.b);
    // 组件内部差异与面积规模共同控制合并；细粒度降低门限，让持续窄条成为独立区域。
    const k=8*(1.6-1.2*clamp(granularity,0,1));
    for(const e of links){const a=find(e.a),b=find(e.b);if(a!==b&&e.w<=Math.min(internal[a]+k/size[a],internal[b]+k/size[b]))join(a,b,e.w);}
    // 仅消除缺少强边界的孤立面；不以全局面积比例抹掉用户需要的细长结构。
    for(const e of links){const a=find(e.a),b=find(e.b);if(a!==b&&Math.min(size[a],size[b])<4&&e.w<.1)join(a,b,e.w);}
    const ids=new Map(),groups=parent.map((_,i)=>{const r=find(i);if(!ids.has(r))ids.set(r,ids.size);return ids.get(r);});
    return {groups,added:ids.size-new Set(base).size};
  }
  return {sample,segment,validUV};
}
if(typeof module!=='undefined')module.exports=createCSITextureEvidence;
if(typeof window!=='undefined')window.createCSITextureEvidence=createCSITextureEvidence;
