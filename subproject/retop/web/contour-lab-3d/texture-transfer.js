// 逐角 UV 颜色迁移，图集烘焙和静态资源包导出。源模型只读。
function createContourTextureTransfer(E){
  'use strict';
  const {add,sub,mul,dot,cross,unit,dist}=E;
  function align(reference,source){
    const a=E.bounds(reference),b=E.bounds(source),scale=(b.hi[1]-b.lo[1])/(a.hi[1]-a.lo[1]);
    if(!Number.isFinite(scale)||scale<=0)throw Error('参考低模尺寸无效。');
    const offset=sub(b.center,mul(a.center,scale));
    const output={...reference,vertices:reference.vertices.map(p=>add(mul(p,scale),offset)),alignment:{scale,offset,method:'uniform height and bounds centre'}};
    if(output.sourceNormals)output.sourceNormals={...output.sourceNormals,signature:E.fingerprint(output)};
    return output;
  }
  function validateUV(mesh,uv=mesh.sourceUV){
    if(!uv||uv.indices.length!==mesh.faces.length||uv.uv.some(p=>p.length<2||p.some(v=>!Number.isFinite(v)))||mesh.faces.some((f,i)=>f.length!==uv.indices[i].length||uv.indices[i].some(k=>!Number.isInteger(k)||!uv.uv[k])))throw Error('需要完整的逐角 UV。');
    return uv;
  }
  function closestPoint(p,a,b,c){
    const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
    if(d1<=0&&d2<=0)return {point:a,weights:[1,0,0]};
    const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
    if(d3>=0&&d4<=d3)return {point:b,weights:[0,1,0]};
    const vc=d1*d4-d3*d2;
    if(vc<=0&&d1>=0&&d3<=0){const t=d1/(d1-d3);return {point:add(a,mul(ab,t)),weights:[1-t,t,0]};}
    const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
    if(d6>=0&&d5<=d6)return {point:c,weights:[0,0,1]};
    const vb=d5*d2-d1*d6;
    if(vb<=0&&d2>=0&&d6<=0){const t=d2/(d2-d6);return {point:add(a,mul(ac,t)),weights:[1-t,0,t]};}
    const va=d3*d6-d5*d4;
    if(va<=0&&d4-d3>=0&&d5-d6>=0){const t=(d4-d3)/(d4-d3+d5-d6);return {point:add(b,mul(sub(c,b),t)),weights:[0,1-t,t]};}
    const inv=1/(va+vb+vc),v=vb*inv,w=vc*inv;
    return {point:add(a,add(mul(ab,v),mul(ac,w))),weights:[1-v-w,v,w]};
  }
  function sourceIndex(mesh,{requireUV=true}={}){
    const uv=requireUV?validateUV(mesh):null,tr=mesh.faces.every(f=>f.length===3)?{faces:mesh.faces,source:mesh.faces.map((_,i)=>i)}:E.triangulate(mesh);
    const count=tr.faces.length,ids=Uint32Array.from({length:count},(_,i)=>i),centers=new Float32Array(count*3),normals=new Float32Array(count*3);
    const corners=uv?tr.faces.map((f,i)=>{
      const parent=tr.source[i],face=mesh.faces[parent];
      return f.map(v=>uv.indices[parent][face.indexOf(v)]);
    }):null;
    for(let i=0;i<count;i++){
      const pts=tr.faces[i].map(v=>mesh.vertices[v]),n=unit(cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])));
      for(let k=0;k<3;k++){centers[i*3+k]=(pts[0][k]+pts[1][k]+pts[2][k])/3;normals[i*3+k]=n[k];}
    }
    function build(start,end){
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let j=start;j<end;j++)for(const v of tr.faces[ids[j]])for(let k=0;k<3;k++){const x=mesh.vertices[v][k];lo[k]=Math.min(lo[k],x);hi[k]=Math.max(hi[k],x);}
      const node={lo,hi,start,end};
      if(end-start<=12)return node;
      const axis=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a]))[0];
      ids.subarray(start,end).sort((a,b)=>centers[a*3+axis]-centers[b*3+axis]);
      const middle=(start+end)>>1;
      node.left=build(start,middle);node.right=build(middle,end);return node;
    }
    const tree=build(0,count),box=(p,n)=>p.reduce((s,x,k)=>s+Math.max(n.lo[k]-x,0,x-n.hi[k])**2,0),epsilon=E.bounds(mesh).diagonal**2*1e-20;
    function closest(p,normal){
      let best=Infinity,hit=null;const stack=[tree];
      while(stack.length){
        const node=stack.pop();if(box(p,node)>best)continue;
        if(node.left){
          const a=box(p,node.left),b=box(p,node.right);
          if(a<b)stack.push(node.right,node.left);else stack.push(node.left,node.right);
          continue;
        }
        for(let j=node.start;j<node.end;j++){
          const id=ids[j];
          if(dot(normal,normals.subarray(id*3,id*3+3))<.1)continue;
          const points=tr.faces[id].map(v=>mesh.vertices[v]),candidate=closestPoint(p,...points),delta=sub(candidate.point,p),d=dot(delta,delta);
          const alignment=dot(normal,normals.subarray(id*3,id*3+3));
          if(d>best+epsilon||Math.abs(d-best)<=epsilon&&alignment<=(hit?.alignment??-1))continue;
          best=d;hit={...candidate,id,distance:Math.sqrt(d),alignment};
        }
      }
      if(!hit)return null;
      if(uv)hit.uv=[0,1].map(k=>corners[hit.id].reduce((s,id,i)=>s+uv.uv[id][k]*hit.weights[i],0));
      const triangle=tr.faces[hit.id],parent=tr.source[hit.id];
      hit.normal=mesh.sourceNormals?unit(triangle.reduce((sum,v,j)=>add(sum,mul(mesh.sourceNormals.vectors[mesh.sourceNormals.indices[parent][mesh.faces[parent].indexOf(v)]],hit.weights[j])),[0,0,0])):Array.from(normals.subarray(hit.id*3,hit.id*3+3));
      return hit;
    }
    let splitVertices=null;
    function touchesNormalSeam(triangleId){
      if(!mesh.sourceNormals)return false;
      if(!splitVertices){
        // 同位置顶点可能为了 UV 或对象边界而重复。将它们一起检查，不把 UV 接缝当作硬边。
        const positions=mesh.vertices,order=Uint32Array.from(positions,(_,i)=>i);
        const compare=(a,b)=>positions[a][0]-positions[b][0]||positions[a][1]-positions[b][1]||positions[a][2]-positions[b][2];
        order.sort(compare);
        const canonical=new Uint32Array(order.length);
        let representative=order[0];
        for(const i of order){
          if(compare(representative,i)!==0)representative=i;
          canonical[i]=representative;
        }
        const first=new Int32Array(order.length).fill(-1),split=new Uint8Array(order.length);
        const {indices,vectors}=mesh.sourceNormals,threshold=Math.cos(10*Math.PI/180);
        mesh.faces.forEach((face,fi)=>face.forEach((v,j)=>{
          const at=canonical[v],normal=indices[fi][j];
          if(first[at]===-1)first[at]=normal;
          else if(first[at]!==normal&&dot(vectors[first[at]],vectors[normal])<threshold)split[at]=1;
        }));
        splitVertices=Uint8Array.from(canonical,i=>split[i]);
      }
      return tr.faces[triangleId].some(i=>splitVertices[i]);
    }
    return {closest,touchesNormalSeam};
  }
  function sample(image,uv){
    const repeat=v=>v-Math.floor(v),x=repeat(uv[0])*image.width-.5,y=(1-repeat(uv[1]))*image.height-.5,ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
    const at=(a,b,k)=>image.data[(((b%image.height+image.height)%image.height)*image.width+(a%image.width+image.width)%image.width)*4+k];
    return [0,1,2,3].map(k=>(at(ix,iy,k)*(1-tx)+at(ix+1,iy,k)*tx)*(1-ty)+(at(ix,iy+1,k)*(1-tx)+at(ix+1,iy+1,k)*tx)*ty);
  }
  function transferNormals(source,mesh,{normalDetail=null,maxDistance=.08}={},existingIndex=null){
    normalDetail=normalDetail??Math.min(.4,Math.sqrt(mesh.faces.reduce((sum,f)=>sum+f.length-2,0)/source.faces.reduce((sum,f)=>sum+f.length-2,0)));
    if(!Number.isFinite(normalDetail)||normalDetail<0||normalDetail>1)throw Error('源法线细节权重应为0～1。');
    const index=existingIndex||sourceIndex(source,{requireUV:false}),limit=E.bounds(source).diagonal*maxDistance;
    const shading=E.autoSmooth(mesh,{angle:85});
    const native=E.cornerNormals({...mesh,surfaceNormals:null,sourceNormals:null},shading.groups,{sharpEdges:shading.sharpEdges});
    const hasSurfaceKinds=mesh.csiSurfaceCharts&&Array.isArray(mesh.csiHardSurfaceGroups),rigidGroups=new Set(mesh.csiHardSurfaceGroups||[]),rigidVertices=new Set();
    if(hasSurfaceKinds)mesh.faces.forEach((f,i)=>{if(rigidGroups.has(mesh.csiPatchGroups?.[i]))f.forEach(v=>rigidVertices.add(v));});
    const verifySeams=!!(source.sourceNormals&&(mesh.csiReport?.characterTemplate||mesh.hierarchy?.characterTemplate));
    const seamCorners=verifySeams?mesh.faces.map(face=>new Uint8Array(face.length)):null;
    let hits=0,misses=0;
    const projected=mesh.faces.map((face,fi)=>{
      const faceNormal=E.faceData(mesh,face).normal;
      return face.map((id,corner)=>{
        const expected=hasSurfaceKinds&&!rigidVertices.has(id)?mesh.csiFeatureAnchorNormals?.[id]||faceNormal:faceNormal,hit=index.closest(mesh.vertices[id],expected);
        if(!hit||hit.distance>limit||dot(hit.normal,expected)<=0){misses++;return native[fi][corner];}
        hits++;
        if(verifySeams)seamCorners[fi][corner]=index.touchesNormalSeam(hit.id);
        return hit.normal;
      });
    });
    const topology=E.topology(mesh),hardEdges=[];
    for(const [k,e]of topology.edges){
      if(e.faces.length!==2){hardEdges.push(k);continue;}
      const [a,b]=e.faces,cosine=dot(topology.data[a].normal,topology.data[b].normal);
      const discontinuous=[e.a,e.b].some(v=>{
        const i=mesh.faces[a].indexOf(v),j=mesh.faces[b].indexOf(v);
        return (!verifySeams||seamCorners[a][i]||seamCorners[b][j])&&dot(projected[a][i],projected[b][j])<Math.cos(35*Math.PI/180);
      });
      if(cosine<Math.cos(40*Math.PI/180)&&discontinuous)hardEdges.push(k);
    }
    const restored=E.autoSmooth(mesh,{angle:180,hardEdges}),control=E.cornerNormals({...mesh,surfaceNormals:null,sourceNormals:null},restored.groups,{sharpEdges:restored.sharpEdges});
    // 共享光滑扇区先协调源法线，避免同一顶点因投影面不同产生额外着色接缝。
    const coordinated=E.cornerNormals({...mesh,surfaceNormals:null,sourceNormals:null},restored.groups,{sharpEdges:restored.sharpEdges,sampleNormals:projected});
    const signature=E.fingerprint(mesh);
    const anchors=mesh.faceTemplateShading?.signature===signature?mesh.faceTemplateShading.anchors:null;
    const profileAnchors=mesh.profileShading?.signature===signature?mesh.profileShading.anchors:null;
    const head=mesh.headSideShading?.signature===signature?mesh.headSideShading:null;
    const creaseVertices=new Set();
    if(anchors||profileAnchors)for(const edge of hardEdges){
      const {a,b}=topology.edges.get(edge);
      creaseVertices.add(a);creaseVertices.add(b);
    }
    const values=coordinated.map((face,i)=>face.map((n,j)=>{
      const vertex=mesh.faces[i][j],detail=hasSurfaceKinds&&!rigidVertices.has(vertex)?1:normalDetail;
      const base=unit(add(mul(control[i][j],1-detail),mul(n,detail)));
      const anchor=anchors?.[vertex]||profileAnchors?.[vertex];
      if(!anchor||creaseVertices.has(vertex)||dot(anchor.normal,base)<.15)return base;
      // 仅调整同向光滑扇区，源硬缝及背向面保留各自的角法线。
      const weight=anchor.weight*(1-(head?.weights[vertex]||0));
      return unit(add(mul(base,1-weight),mul(anchor.normal,weight)));
    }));
    return {signature,values,hits,misses,normalDetail,softSurfaceDetail:hasSurfaceKinds?1:normalDetail,groups:restored.groups,sharpEdges:restored.sharpEdges,angle:180};
  }
  function restoreLevels(source,levels,progress=()=>{}){
    if(!source.sourceNormals)return levels;
    // 多档共用原高模查询索引；只修改新生成档位的着色信息，不改顶点和面。
    progress('建立原高模法线投影索引');
    const index=sourceIndex(source,{requireUV:false});
    for(const level of levels){
      progress('恢复高模法线和平滑组 · '+level.label);
      level.mesh.surfaceNormals=transferNormals(source,level.mesh,{},index);
      E.applyAutoSmooth(level.mesh,level.mesh.surfaceNormals.angle);
    }
    return levels;
  }
  function bake(source,level,image,{size=2048,padding=8,maxDistance=.08,normalDetail=null}={},progress=()=>{}){
    const mesh=level.mesh||level;
    let uv=validateUV(mesh,level.uv||mesh.sourceUV);
    if(uv.report?.sharedPairs?.length)uv=E.uvAtlas(mesh,{density:uv.density});
    if(!Number.isInteger(size)||size<16||size>4096||image.data.length!==image.width*image.height*4)throw Error('贴图尺寸或像素数据无效。');
    progress('建立原高模 UV 投影索引');
    const index=sourceIndex(source),limit=E.bounds(source).diagonal*maxDistance;
    const tr=E.triangulate(mesh);
    function raster(layout,size,partIds){
      const uv=layout,data=new Uint8ClampedArray(size*size*4),mask=new Uint8Array(size*size);
      const owner=partIds?new Int32Array(size*size).fill(-1):null;
      let covered=0,missed=0,maximum=0,sum=0;
      for(let fi=0;fi<tr.faces.length;fi++){
        const face=tr.faces[fi],parent=tr.source[fi],points=face.map(id=>mesh.vertices[id]),coords=face.map(id=>uv.uv[uv.indices[parent][mesh.faces[parent].indexOf(id)]]).map(p=>[p[0]*size,(1-p[1])*size]);
        const [a,b,c]=coords,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
        if(Math.abs(den)<1e-12)continue;
        const normal=unit(cross(sub(points[1],points[0]),sub(points[2],points[0])));
        const x0=Math.max(0,Math.floor(Math.min(...coords.map(p=>p[0])))),x1=Math.min(size-1,Math.ceil(Math.max(...coords.map(p=>p[0]))));
        const y0=Math.max(0,Math.floor(Math.min(...coords.map(p=>p[1])))),y1=Math.min(size-1,Math.ceil(Math.max(...coords.map(p=>p[1]))));
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/den,v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/den,w=1-u-v;
          if(Math.min(u,v,w)<-1e-8)continue;
          const id=y*size+x;if(mask[id])continue;
          const point=add(mul(points[0],u),add(mul(points[1],v),mul(points[2],w))),hit=index.closest(point,normal);
          if(!hit||hit.distance>limit){missed++;continue;}
          if(owner)owner[id]=partIds[parent];
          data.set(sample(image,hit.uv),id*4);mask[id]=1;covered++;maximum=Math.max(maximum,hit.distance);sum+=hit.distance;
        }
        if(!owner&&fi%100===0)progress(`颜色转移 ${fi+1} / ${tr.faces.length}`);
      }
      return {size,data,mask,owner,covered,missed,maximum,sum};
    }
    if(uv.parts){
      progress('比较左右同名 UV 岛的高模颜色');
      const partIds=new Int32Array(mesh.faces.length);
      uv.parts.forEach((part,i)=>part.faces.forEach(fi=>partIds[fi]=i));
      const probe=raster(uv,Math.min(512,size),partIds);
      const unwrap=typeof createContourUVUnwrap==='function'?createContourUVUnwrap:require('./uv-unwrap.js');
      uv=unwrap(E).shareCharacterColors(mesh,uv,probe);
    }
    const {data,mask,covered,missed,maximum,sum}=raster(uv,size);
    if(uv.report?.sharedPairs?.length)uv={...uv,report:{...uv.report,packingUtilization:covered/(size*size)}};
    let frontier=[];
    for(let i=0;i<mask.length;i++)if(mask[i])frontier.push(i);
    for(let round=0;round<padding&&frontier.length;round++){
      const next=[];
      for(const id of frontier){const x=id%size,y=Math.floor(id/size);for(const [a,b]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        if(a<0||b<0||a>=size||b>=size)continue;const j=b*size+a;if(mask[j])continue;
        mask[j]=2;data.set(data.subarray(id*4,id*4+4),j*4);next.push(j);
      }}
      frontier=next;
    }
    if(!covered)throw Error('贴图投影没有命中有效源表面。');
    const surfaceNormals=transferNormals(source,mesh,{normalDetail,maxDistance},index);
    return {width:size,height:size,data,surfaceNormals,...(uv.parts?{targetUV:uv}:{}),report:{covered,missed,coverage:covered/(covered+missed),maximumDistance:maximum,meanDistance:sum/covered,padding,sourceTriangles:source.faces.length,sourceNormalsTransferred:surfaceNormals.hits,normalMisses:surfaceNormals.misses,normalDetail:surfaceNormals.normalDetail}};
  }
  function tga(buffer){
    const view=new DataView(buffer),bytes=new Uint8Array(buffer),type=bytes[2],width=view.getUint16(12,true),height=view.getUint16(14,true),bits=bytes[16],stride=bits/8;
    if(bytes[1]||![2,10].includes(type)||![24,32].includes(bits)||!width||!height||width*height>67108864)throw Error('支持未压缩或 RLE 的 24/32 位真彩色 TGA。');
    const data=new Uint8ClampedArray(width*height*4);let pos=18+bytes[0],pixel=0;
    function read(){if(pos+stride>bytes.length)throw Error('TGA 像素数据不完整。');const p=[bytes[pos+2],bytes[pos+1],bytes[pos],stride===4?bytes[pos+3]:255];pos+=stride;return p;}
    function put(p){if(pixel>=width*height)throw Error('TGA 像素数量超限。');const x=pixel%width,y=Math.floor(pixel/width),xx=bytes[17]&16?width-1-x:x,yy=bytes[17]&32?y:height-1-y;data.set(p,(yy*width+xx)*4);pixel++;}
    while(pixel<width*height){if(type===2){put(read());continue;}if(pos>=bytes.length)throw Error('TGA RLE 数据不完整。');const packet=bytes[pos++],count=(packet&127)+1;if(packet&128){const p=read();for(let i=0;i<count;i++)put(p);}else for(let i=0;i<count;i++)put(read());}
    return {width,height,data};
  }
  async function decode(file){
    if(file.name.toLowerCase().endsWith('.tga'))return tga(await file.arrayBuffer());
    const image=await createImageBitmap(file),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');
    ctx.drawImage(image,0,0);image.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);return {width:canvas.width,height:canvas.height,data:pixels.data};
  }
  function zip(files){
    const encoder=new TextEncoder(),table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
    const chunks=[],directory=[];let offset=0;
    for(const [name,value]of Object.entries(files)){
      const filename=encoder.encode(name),data=typeof value==='string'?encoder.encode(value):new Uint8Array(value);let crc=0xffffffff;
      for(const b of data)crc=table[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
      const local=new Uint8Array(30+filename.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,filename.length,true);local.set(filename,30);
      const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);
      chunks.push(local,data);directory.push(central);offset+=local.length+data.length;
    }
    const total=directory.reduce((s,d)=>s+d.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length,true);e.setUint16(10,directory.length,true);e.setUint32(12,total,true);e.setUint32(16,offset,true);
    const out=new Uint8Array(offset+total+22);let i=0;for(const part of [...chunks,...directory,end]){out.set(part,i);i+=part.length;}return out;
  }
  function materialOBJ(level,name){return E.obj(level).replace(/^o .+$/m,`mtllib ${name}.mtl\no ${name}\nusemtl BaseColor`);}
  function uvSVG(level){
    const uv=validateUV(level.mesh,level.uv),paths=uv.indices.map(face=>'<polygon points="'+face.map(id=>uv.uv[id].map((v,k)=>(k?1-v:v)*1024).join(',')).join(' ')+'"/>').join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="white"/><g fill="none" stroke="#234d3e" stroke-width="0.6">'+paths+'</g></svg>';
  }
  return {align,validateUV,bake,decode,tga,zip,materialOBJ,uvSVG,transferNormals,restoreLevels};
}
if(typeof module!=='undefined')module.exports=createContourTextureTransfer;
if(typeof window!=='undefined')window.createContourTextureTransfer=createContourTextureTransfer;
