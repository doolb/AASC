/* Group-first UV charts. Geometry and shading are read-only. No native dependency. */
function createContourUVUnwrap(E){
  'use strict';
  const {sub,dot,cross,len,unit,dist,key}=E;
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const median=a=>a.length?a.sort((x,y)=>x-y)[a.length>>1]:1;
  function dsu(n){const p=Int32Array.from({length:n},(_,i)=>i);const find=i=>{while(p[i]!==i){p[i]=p[p[i]];i=p[i];}return i;};return {find,join(a,b){a=find(a);b=find(b);if(a!==b)p[b]=a;}};}
  function intersectArea(a,b){let poly=a;const sign=Math.sign(turn(...b));for(let j=0;j<3&&poly.length;j++){const x=b[j],y=b[(j+1)%3],out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=turn(x,y,p)*sign,dq=turn(x,y,q)*sign;if(dp>=0)out.push(p);if((dp<0)!==(dq<0)){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}poly=out;}let area=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];area+=p[0]*q[1]-p[1]*q[0];}return Math.abs(area)/2;}
  function inspect(coords,triangles){
    if(coords.some(p=>!p||p.length!==2||!p.every(Number.isFinite)))return {valid:false,reason:'missing coordinates'};
    const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of coords)for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    const span=Math.max(hi[0]-lo[0],hi[1]-lo[1]);if(!(span>0))return {valid:false,reason:'zero span'};
    // Normalized predicates keep overlap/degeneracy checks independent of object units.
    const ps=coords.map(p=>p.map((v,k)=>(v-lo[k])/span)),rows=[];let sign=0,area=0;
    for(const ids of triangles){const p=ids.map(i=>ps[i]),a=turn(...p);if(Math.abs(a)<1e-15)return {valid:false,reason:'degenerate triangle'};if(sign&&a*sign<0)return {valid:false,reason:'flipped triangle'};sign=Math.sign(a);area+=Math.abs(a)/2;rows.push({p,lo:[0,1].map(k=>Math.min(...p.map(q=>q[k]))),hi:[0,1].map(k=>Math.max(...p.map(q=>q[k]))),area:Math.abs(a)/2});}
    rows.sort((a,b)=>a.lo[0]-b.lo[0]);let active=[];
    for(const a of rows){active=active.filter(b=>b.hi[0]>a.lo[0]+1e-13);for(const b of active)if(a.lo[1]<b.hi[1]-1e-13&&a.hi[1]>b.lo[1]+1e-13){const overlap=intersectArea(a.p,b.p);if(overlap>Math.max(1e-14,Math.min(a.area,b.area)*1e-8))return {valid:false,reason:'overlapping triangles'};}active.push(a);}
    return {valid:true,area:area*span*span,lo,hi,sign};
  }
  // 用高模头部坐标确定左右和朝向。腿根、腰和肩的位置随鼻尖到脚底的距离缩放。
  function characterParts(mesh,t,frame){
    const local=p=>frame.axes.map(axis=>dot(sub(p,frame.origin),axis)/frame.width);
    const points=mesh.vertices.map(local),depth=-points.reduce((v,p)=>Math.min(v,p[1]),0);
    const labels=t.data.map(({center})=>{
      const [x,y,z]=local(center),side=x<0?'L':'R',height=-y/depth;
      if(y>-.31 && Math.abs(x)<.78){
        if(z<-.76 || y>.67)return 'scalp';
        return 'face-'+side;
      }
      const front=z>-.68?'front':'back';
      if(height>.86)return 'boot-'+side+'-'+front;
      if(height>.64)return 'leg-'+side+'-'+front;
      if(Math.abs(x)>.63+Math.max(0,.24-height)*1.4)return 'arm-'+side+'-'+front;
      return 'torso-'+front;
    });
    // 消除处在分类边界上的孤立小片，只吸收与其实际共享最长边的相邻区域。
    const visited=new Set();
    for(let i=0;i<labels.length;i++){
      if(visited.has(i))continue;
      const faces=[i],borders=new Map();visited.add(i);
      for(let j=0;j<faces.length;j++){
        const fi=faces[j],f=mesh.faces[fi];
        for(let c=0;c<f.length;c++){
          const a=f[c],b=f[(c+1)%f.length],other=t.edges.get(key(a,b)).faces.find(k=>k!==fi);
          if(other===undefined)continue;
          if(labels[other]!==labels[i])borders.set(labels[other],(borders.get(labels[other])||0)+dist(mesh.vertices[a],mesh.vertices[b]));
          else if(!visited.has(other)){visited.add(other);faces.push(other);}
        }
      }
      if(faces.length<Math.max(4,labels.length*.002)&&borders.size){
        const best=[...borders].sort((a,b)=>b[1]-a[1])[0][0];for(const fi of faces)labels[fi]=best;
      }
    }
    return {points,labels};
  }

  // 按三角形逐行求轮廓，保留保护边距。凹岛的外侧空白可供其他岛使用。
  function packCharacter(charts){
    const size=160,padding=1;
    const anchor=name=>{
      if(name.startsWith('face'))return name.endsWith('L')?[0,1]:[0,.62];
      if(name==='scalp')return [.53,1];
      if(name.startsWith('torso'))return name.endsWith('front')?[1,.74]:[0,.52];
      return name.startsWith('arm')?[1,.42]:[.35,0];
    };
    const priority=c=>({'face-L':0,scalp:1,'torso-front':2,'face-R':3,'torso-back':4}[c.region.group]??5);
    const order=charts.slice().sort((a,b)=>priority(a)-priority(b)||b.w*b.h-a.w*a.h);
    function footprint(chart,scale){
      const w=Math.ceil(chart.w*scale)+2*padding+1,h=Math.ceil(chart.h*scale)+2*padding+1;
      if(w>size||h>size)return null;
      const rows=Array.from({length:h},()=>[w,-1]);
      for(const tri of chart.l.triangles){
        const p=tri.map(i=>chart.ps[i].map(v=>v*scale+padding));
        const ymin=Math.min(...p.map(q=>q[1])),ymax=Math.max(...p.map(q=>q[1]));
        for(let y=Math.floor(ymin);y<=Math.floor(ymax);y++){
          const xs=p.filter(q=>q[1]>=y&&q[1]<=y+1).map(q=>q[0]);
          for(let i=0;i<3;i++){
            const a=p[i],b=p[(i+1)%3];
            for(const yy of [y,y+1])if((a[1]<yy)!==(b[1]<yy))xs.push(a[0]+(b[0]-a[0])*(yy-a[1])/(b[1]-a[1]));
          }
          if(!xs.length)continue;
          const lo=Math.max(0,Math.floor(Math.min(...xs))-padding),hi=Math.min(w-1,Math.floor(Math.max(...xs))+padding);
          for(let yy=Math.max(0,y-padding);yy<=Math.min(h-1,y+padding);yy++){
            rows[yy][0]=Math.min(rows[yy][0],lo);rows[yy][1]=Math.max(rows[yy][1],hi);
          }
        }
      }
      return {w,h,rows};
    }
    function layout(scale,variant){
      const occupied=Array.from({length:size},()=>new Uint8Array(size)),placements=[];
      for(const chart of order){
        const shape=footprint(chart,scale);if(!shape)return null;
        const {w,h,rows}=shape;
        let [ax,ay]=anchor(chart.region.group);
        if(variant===1&&priority(chart)===2)ay=1;
        if(variant>1&&priority(chart)>2){ax=(variant&1)?1-ax:ax;ay=(variant&2)?0:1;if(variant===4){ax=0;ay=0;}}
        const target=[ax*(size-w),ay*(size-h)];
        let choice=null,score=Infinity;
        const contact=variant>=5,lines=occupied.map(row=>{const counts=new Uint16Array(size+1);for(let i=0;i<size;i++)counts[i+1]=counts[i]+row[i];return counts;});
        for(let y=0;y<=size-h;y++)for(let x=0;x<=size-w;x++){
          const d=(x-target[0])**2+(y-target[1])**2;if(!contact&&d>=score)continue;
          let fits=true;
          let touching=0;
          for(let j=0;j<h&&fits;j++){
            const [lo,hi]=rows[j];if(hi<lo)continue;
            const start=x+lo,end=x+hi+1,line=lines[y+j];
            if(line[end]>line[start]){fits=false;break;}
            if(contact){
              const occ=occupied[y+j];
              touching+=Number(!start||occ[start-1])+Number(end===size||occ[end]);
              for(const yy of [y+j-1,y+j+1])touching+=yy<0||yy>=size?end-start:lines[yy][end]-lines[yy][start];
            }
          }
          const cost=d-touching*(variant===5?24:80);
          if(fits&&cost<score){choice=[x,y];score=cost;}
        }
        if(!choice)return null;
        const [x,y]=choice;
        rows.forEach(([lo,hi],j)=>{if(hi>=lo)occupied[y+j].fill(1,x+lo,x+hi+1);});
        placements.push({chart,x:(x+padding)/size,y:(y+padding)/size,scale:scale/size});
      }
      return placements;
    }
    let high=size/Math.sqrt(charts.reduce((s,c)=>s+c.area,0)),low=0,best=null;
    for(let i=0;i<10;i++){
      const scale=(low+high)/2;let placed=null;
      for(let variant=0;variant<7&&!placed;variant++)placed=layout(scale,variant);
      if(placed){best=placed;low=scale;}else high=scale;
    }
    return best;
  }
  function atlas(mesh,{maxStretch=Infinity,characterFrame=null,density}={}){
    const t=E.topology(mesh),labels=mesh.smoothingGroups?.length===mesh.faces.length?mesh.smoothingGroups:E.autoSmooth(mesh,{topology:t}).groups;
    const character=characterFrame&&characterParts(mesh,t,characterFrame);
    const weights=character?E.characterUVDensity(density):null;
    const label=i=>character?character.labels[i]:labels[i]===0?'flat-'+i:labels[i],seen=new Set(),regions=[];
    for(let fi=0;fi<mesh.faces.length;fi++)if(!seen.has(fi)){const faces=[fi];seen.add(fi);for(let q=0;q<faces.length;q++)for(const other of t.adj[faces[q]])if(!seen.has(other)&&label(other)===label(fi)){seen.add(other);faces.push(other);}regions.push({group:label(fi),faces});}
    const tr=E.triangulate(mesh),byFace=mesh.faces.map(()=>[]);tr.faces.forEach((f,i)=>byFace[tr.source[i]].push(f));
    const charts=[],reports=[];
    function local(region,cuts=new Set()){
      const offsets=new Map();let n=0;for(const fi of region.faces){offsets.set(fi,n);n+=mesh.faces[fi].length;}const ds=dsu(n);
      for(const [k,e]of t.edges)if(e.faces.length===2&&!cuts.has(k)&&e.faces.every(fi=>offsets.has(fi)))for(const v of [e.a,e.b])ds.join(offsets.get(e.faces[0])+mesh.faces[e.faces[0]].indexOf(v),offsets.get(e.faces[1])+mesh.faces[e.faces[1]].indexOf(v));
      const ids=new Map(),vertices=[],faces=[],triangles=[],corners=[];for(const fi of region.faces){const f=mesh.faces[fi],row=f.map((vi,j)=>{const r=ds.find(offsets.get(fi)+j);if(!ids.has(r)){ids.set(r,vertices.length);vertices.push(vi);}return ids.get(r);});faces.push(row);corners.push(f.map((_,j)=>offsets.get(fi)+j));for(const tri of byFace[fi])triangles.push(tri.map(vi=>row[f.indexOf(vi)]));}
      const edges=new Map();for(const f of faces)f.forEach((a,j)=>{const b=f[(j+1)%f.length],k=key(a,b);if(!edges.has(k))edges.set(k,{a,b,count:0});edges.get(k).count++;});
      const boundary=[...edges.values()].filter(e=>e.count===1),next=new Map();let regular=true;for(const e of boundary){if(next.has(e.a))regular=false;next.set(e.a,e.b);}const loops=[],used=new Set();for(const root of next.keys())if(!used.has(root)){const loop=[];let v=root;while(!used.has(v)&&next.has(v)){used.add(v);loop.push(v);v=next.get(v);}if(v!==root)regular=false;loops.push(loop);}
      return {vertices,faces,triangles,edges,boundary,loops,disk:regular&&loops.length===1&&loops[0].length>=3&&vertices.length-edges.size+faces.length===1};
    }
    function projection(l){let normal=[0,0,0];for(const ids of l.triangles){const p=ids.map(i=>mesh.vertices[l.vertices[i]]),n=cross(sub(p[1],p[0]),sub(p[2],p[0]));normal=E.add(normal,n);}normal=unit(normal);if(len(normal)<.5)return null;let u=null,best=0;for(const e of l.edges.values()){const d=sub(mesh.vertices[l.vertices[e.b]],mesh.vertices[l.vertices[e.a]]),p=sub(d,E.mul(normal,dot(d,normal)));if(len(p)>best){best=len(p);u=unit(p);}}if(!u)return null;const v=cross(normal,u),origin=mesh.vertices[l.vertices[0]];return l.vertices.map(vi=>{const p=sub(mesh.vertices[vi],origin);return [dot(p,u),dot(p,v)];});}
    function csi(region,l){
      const patch=mesh.csiPatchGroups?.[region.faces[0]],c=mesh.csiCharts?.find(c=>c.patch===patch);if(!c||region.faces.some(fi=>mesh.csiPatchGroups[fi]!==patch))return null;
      const map=new Map(),coords=Array(l.vertices.length);if(c.structureLattice)c.latticeVertices.forEach((id,i)=>map.set(id,[c.latticeCoordinates[i]]));
      else for(let y=0;y<c.grid.length;y++)for(let x=0;x<c.grid[y].length;x++){const id=c.grid[y][x],p=c.parameters?.[y]?.[x]||[x/c.U,y/c.V];if(!map.has(id))map.set(id,[]);map.get(id).push(p);}
      const patchFaces=mesh.faces.map((_,i)=>i).filter(i=>mesh.csiPatchGroups[i]===patch),faceIndex=new Map(patchFaces.map((fi,i)=>[fi,i]));
      for(let i=0;i<region.faces.length;i++){const fi=region.faces[i],f=mesh.faces[fi],saved=c.faceParameters?.[faceIndex.get(fi)];let ps=saved;if(!ps){const first=map.get(f[0])?.[0];if(!first)return null;ps=f.map(vi=>map.get(vi)?.slice().sort((a,b)=>dist(a,first)-dist(b,first))[0]);}if(!ps||ps.length!==f.length||ps.some(p=>!p))return null;for(let j=0;j<f.length;j++){const id=l.faces[i][j];if(coords[id]&&dist(coords[id],ps[j])>1e-8)return null;coords[id]=ps[j].slice();}}
      if(!c.structureLattice){const ratios=[[],[]];for(const e of l.edges.values()){const a=coords[e.a],b=coords[e.b];if(!a||!b)return null;const d=a.map((x,k)=>Math.abs(x-b[k])),length=dist(mesh.vertices[l.vertices[e.a]],mesh.vertices[l.vertices[e.b]]);for(let k=0;k<2;k++)if(d[k]>1e-10&&d[1-k]<d[k]*.05)ratios[k].push(length/d[k]);}const scale=ratios.map(median);return coords.map(p=>p.map((v,k)=>v*scale[k]));}return coords;
    }
    function cutGraph(region){
      const fs=new Set(region.faces),edges=[...t.edges.entries()].filter(([,e])=>e.faces.some(i=>fs.has(i))),graph=new Map();for(const [k,e]of edges)for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){if(!graph.has(a))graph.set(a,[]);graph.get(a).push({v:b,k,w:dist(mesh.vertices[a],mesh.vertices[b])});}
      // Tree-cotree cut graph: retain the dual tree plus contractible loops,
      // and prune unnecessary primal branches instead of cutting every face.
      const root=edges.find(([,e])=>e.faces.filter(i=>fs.has(i)).length===1)?.[1].a??graph.keys().next().value;
      const distances=new Map([[root,0]]),parent=new Map(),done=new Set();let queue=[root];
      // Binary min heap, to avoid quadratic searches on subdivided smooth meshes.
      const heap=[];function push(v,d){let i=heap.length;heap.push({v,d});while(i){const p=(i-1)>>1;if(heap[p].d<=d)break;heap[i]=heap[p];i=p;}heap[i]={v,d};}function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[j].d>=last.d)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;}push(root,0);
      while(heap.length){const {v,d}=pop();if(done.has(v))continue;done.add(v);for(const e of graph.get(v)){const nd=d+e.w;if(nd<(distances.get(e.v)??Infinity)){distances.set(e.v,nd);parent.set(e.v,{v,k:e.k});push(e.v,nd);}}}
      const primal=new Set([...parent.values()].map(p=>p.k)),dual=new Set(),faceSeen=new Set([region.faces[0]]);queue=[region.faces[0]];
      for(let q=0;q<queue.length;q++){const fi=queue[q],f=mesh.faces[fi];for(let j=0;j<f.length;j++){const k=key(f[j],f[(j+1)%f.length]),e=t.edges.get(k);if(primal.has(k)||e.faces.length!==2)continue;const other=e.faces.find(i=>i!==fi);if(fs.has(other)&&!faceSeen.has(other)){faceSeen.add(other);queue.push(other);dual.add(k);}}}
      const cuts=new Set(edges.filter(([k,e])=>e.faces.length===2&&e.faces.every(i=>fs.has(i))&&!dual.has(k)).map(([k])=>k));
      const boundary=new Set(edges.filter(([,e])=>e.faces.filter(i=>fs.has(i)).length===1).flatMap(([,e])=>[e.a,e.b])),cutAdj=new Map();for(const k of cuts){const e=t.edges.get(k);for(const v of [e.a,e.b]){if(!cutAdj.has(v))cutAdj.set(v,new Set());cutAdj.get(v).add(k);}}
      queue=[...cutAdj.keys()].filter(v=>cutAdj.get(v).size===1&&!boundary.has(v));for(let q=0;q<queue.length;q++){const v=queue[q],a=cutAdj.get(v);if(a.size!==1||boundary.has(v))continue;const k=[...a][0],e=t.edges.get(k),other=e.a===v?e.b:e.a;cuts.delete(k);a.delete(k);cutAdj.get(other).delete(k);if(cutAdj.get(other).size===1)queue.push(other);}
      if(!boundary.size&&!cuts.size){const far=[...distances].sort((a,b)=>b[1]-a[1])[0][0];let v=far;while(parent.has(v)){const p=parent.get(v);cuts.add(p.k);v=p.v;}if(cuts.size<2){const edge=graph.get(root).find(e=>!cuts.has(e.k));if(edge)cuts.add(edge.k);}}
      return cuts;
    }
    function harmonic(l){
      if(!l.disk)return null;const coords=l.vertices.map(()=>[0,0]),fixed=new Set(l.loops[0]),loop=l.loops[0],lengths=loop.map((v,i)=>dist(mesh.vertices[l.vertices[v]],mesh.vertices[l.vertices[loop[(i+1)%loop.length]]])),perimeter=lengths.reduce((s,x)=>s+x,0);let offset=0;
      loop.forEach((v,i)=>{const angle=2*Math.PI*offset/perimeter;coords[v]=[Math.cos(angle),Math.sin(angle)];offset+=lengths[i];});
      const adj=l.vertices.map(()=>new Set());for(const f of l.triangles)for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3];adj[a].add(b);adj[b].add(a);}
      const unknown=l.vertices.map((_,i)=>i).filter(i=>!fixed.has(i)),index=new Map(unknown.map((v,i)=>[v,i]));if(!unknown.length)return coords;
      const links=unknown.map(v=>[...adj[v]].filter(w=>!fixed.has(w)).map(w=>index.get(w))),degree=unknown.map(v=>adj[v].size),N=unknown.length;
      const apply=x=>Float64Array.from(x,(v,i)=>degree[i]*v-links[i].reduce((s,j)=>s+x[j],0)),inner=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
      for(let axis=0;axis<2;axis++){const b=Float64Array.from(unknown,v=>[...adj[v]].filter(w=>fixed.has(w)).reduce((s,w)=>s+coords[w][axis],0)),x=new Float64Array(N),r=b.slice(),z=Float64Array.from(r,(v,i)=>v/degree[i]);let p=z.slice(),rz=inner(r,z);const target=Math.max(1e-24,inner(b,b)*1e-20);
        for(let n=0;n<Math.min(2500,Math.max(100,N*2))&&inner(r,r)>target;n++){const ap=apply(p),den=inner(p,ap);if(!(den>0))break;const alpha=rz/den;for(let i=0;i<N;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/degree[i];}const next=inner(r,z),beta=next/rz;for(let i=0;i<N;i++)p[i]=z[i]+beta*p[i];rz=next;}unknown.forEach((v,i)=>coords[v][axis]=x[i]);}
      return coords;
    }
    function openSmallBoundary(l){
      // A nearly closed group with a tiny opening would squeeze most of the
      // surface into the circle centre. Extend that opening with one slit.
      const boundary=new Set(l.loops[0]),distance=l.vertices.map(()=>Infinity),parent=new Map(),queue=[];for(const v of boundary){distance[v]=0;queue.push(v);}
      const adj=l.vertices.map(()=>[]);for(const e of l.edges.values()){const w=dist(mesh.vertices[l.vertices[e.a]],mesh.vertices[l.vertices[e.b]]);adj[e.a].push([e.b,w]);adj[e.b].push([e.a,w]);}
      const inQueue=new Set(queue);for(let q=0;q<queue.length;q++){const v=queue[q];inQueue.delete(v);for(const [other,w]of adj[v])if(distance[v]+w<distance[other]){distance[other]=distance[v]+w;parent.set(other,v);if(!inQueue.has(other)){inQueue.add(other);queue.push(other);}}}
      let v=distance.reduce((best,d,i)=>d>distance[best]?i:best,0);const cuts=new Set();while(parent.has(v)){const other=parent.get(v);cuts.add(key(l.vertices[v],l.vertices[other]));v=other;}return cuts;
    }
    // 耳根、衣领的区域可能含孔，将内圈沿最短网格路径接到外圈，避免整片切成树。
    function joinBoundaryLoops(region){
      const cuts=new Set();let l=local(region,cuts);
      while(l.loops.length>1){
        const loops=l.loops.slice().sort((a,b)=>b.length-a.length),targets=new Set(loops.slice(1).flat());
        const adj=l.vertices.map(()=>[]);
        for(const e of l.edges.values()){
          const a=l.vertices[e.a],b=l.vertices[e.b],cost=dist(mesh.vertices[a],mesh.vertices[b]);
          adj[e.a].push([e.b,cost]);adj[e.b].push([e.a,cost]);
        }
        const queue=loops[0].slice(),distance=new Map(queue.map(v=>[v,0])),parent=new Map(),queued=new Set(queue);
        for(let i=0;i<queue.length;i++){
          const a=queue[i];queued.delete(a);
          for(const [b,cost] of adj[a]){
            const next=distance.get(a)+cost;if(next>=(distance.get(b)??Infinity))continue;
            distance.set(b,next);parent.set(b,a);
            if(!queued.has(b)){queued.add(b);queue.push(b);}
          }
        }
        let end=[...targets].sort((a,b)=>distance.get(a)-distance.get(b))[0];
        while(parent.has(end)){const start=parent.get(end);cuts.add(key(l.vertices[start],l.vertices[end]));end=start;}
        const next=local(region,cuts);if(next.loops.length>=l.loops.length)break;l=next;
      }
      return {l,cuts};
    }
    function conformal(l,coords){
      // Least-squares Cauchy-Riemann energy with two fixed UV vertices.
      // Free boundaries may fold on difficult charts; validation below gates acceptance.
      const a=l.loops[0]?.[0]??0,b=coords.reduce((best,p,i)=>dist(p,coords[a])>dist(coords[best],coords[a])?i:best,a),pins=new Set([a,b]),index=new Int32Array(coords.length*2).fill(-1);let N=0;
      for(let v=0;v<coords.length;v++)if(!pins.has(v))for(let k=0;k<2;k++)index[2*v+k]=N++;
      if(!N)return null;const rows=[],rhs=new Float64Array(N),diag=new Float64Array(N);
      for(const f of l.triangles){const p=f.map(i=>mesh.vertices[l.vertices[i]]),ab=sub(p[1],p[0]),ac=sub(p[2],p[0]),length=len(ab),x=dot(ac,ab)/length,h=len(cross(ab,ac))/length,weight=Math.sqrt(length*h/2),dx=[-1/length,1/length,0],dy=[(x-length)/(length*h),-x/(length*h),1/h];
        for(let row=0;row<2;row++){const ids=[],values=[];let constant=0;for(let j=0;j<3;j++)for(let k=0;k<2;k++){const c=weight*(row===0?(k===0?dx[j]:-dy[j]):(k===0?dy[j]:dx[j])),i=index[2*f[j]+k];if(i<0)constant+=c*coords[f[j]][k];else{ids.push(i);values.push(c);diag[i]+=c*c;}}
          ids.forEach((v,i)=>rhs[v]-=values[i]*constant);rows.push({ids,values});}
      }
      const apply=x=>{const out=new Float64Array(N);for(const {ids,values}of rows){let sum=0;for(let j=0;j<ids.length;j++)sum+=values[j]*x[ids[j]];for(let j=0;j<ids.length;j++)out[ids[j]]+=values[j]*sum;}return out;},inner=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),x=new Float64Array(N);
      coords.forEach((p,v)=>p.forEach((q,k)=>{const i=index[v*2+k];if(i>=0)x[i]=q;}));const ax=apply(x),r=Float64Array.from(rhs,(v,i)=>v-ax[i]),z=Float64Array.from(r,(v,i)=>v/(diag[i]||1));let direction=z.slice(),rz=inner(r,z);const target=Math.max(1e-25,inner(rhs,rhs)*1e-17);
      for(let it=0;it<Math.min(1200,Math.max(100,N*2))&&inner(r,r)>target;it++){const ad=apply(direction),den=inner(direction,ad);if(!(den>0))break;const alpha=rz/den;for(let i=0;i<N;i++){x[i]+=alpha*direction[i];r[i]-=alpha*ad[i];z[i]=r[i]/(diag[i]||1);}const next=inner(r,z),beta=next/rz;for(let i=0;i<N;i++)direction[i]=z[i]+beta*direction[i];rz=next;}
      return coords.map((p,v)=>p.map((q,k)=>index[v*2+k]<0?q:x[index[v*2+k]]));
    }
    function deformation(l,coords){
      let area3D=0,score=0;const stretch=[];
      for(const f of l.triangles){const p=f.map(i=>mesh.vertices[l.vertices[i]]),ab=sub(p[1],p[0]),ac=sub(p[2],p[0]),a=len(cross(ab,ac))/2;area3D+=a;const length=len(ab),x=dot(ac,ab)/length,y=2*a/length,q=f.map(i=>coords[i]),u=sub(q[1],q[0]).map(v=>v/length),v=sub(sub(q[2],q[0]),E.mul(u,x)).map(v=>v/y),trace=dot(u,u)+dot(v,v),det=u[0]*v[1]-u[1]*v[0],high=(trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2,ratio=high/Math.abs(det);stretch.push({ratio,area:a});score+=a*Math.log(ratio);}
      stretch.sort((a,b)=>a.ratio-b.ratio);const quantile=q=>{let sum=0;for(const x of stretch){sum+=x.area;if(sum>=area3D*q)return x.ratio;}return stretch.at(-1).ratio;};return {area3D,score:score/area3D,stretch:{areaWeightedMedian:quantile(.5),areaWeightedP90:quantile(.9),maximum:stretch.at(-1).ratio}};
    }
    // 以三维三角形为静止形状，最小化正向与逆向雅可比的平方和。面积屏障阻止翻面，
    // 松开圆盘边界，使鼻翼、衣领等凹凸区域可展开成带有真实轮廓的大岛。
    function relaxCharacter(l,coords,initial){
      const rest=[],mass=new Float64Array(coords.length);let total=0;
      for(const ids of l.triangles){
        const [a,b,c]=ids.map(i=>mesh.vertices[l.vertices[i]]),ab=sub(b,a),ac=sub(c,a),base=len(ab);
        const x=dot(ac,ab)/base,y=len(cross(ab,ac))/base,area=base*y/2;
        const du=[-1/base,1/base,0],dv=[(x/base-1)/y,-x/(base*y),1/y];
        rest.push({ids,area,du,dv});total+=area;
        ids.forEach((id,k)=>mass[id]+=area*(du[k]**2+dv[k]**2));
      }
      const scale=Math.sqrt(total/initial.area);
      let points=coords.map(([u,v])=>[u*scale,v*scale*initial.sign]),step=.25;
      function energy(ps,grad,diagonal){
        let sum=0;
        for(const {ids,area,du,dv} of rest){
          let a=0,b=0,c=0,d=0;
          for(let k=0;k<3;k++){const [u,v]=ps[ids[k]];a+=u*du[k];b+=u*dv[k];c+=v*du[k];d+=v*dv[k];}
          const det=a*d-b*c;if(det<=1e-12)return Infinity;
          const squared=a*a+b*b+c*c+d*d,inv=1/det,weight=1+inv*inv;
          sum+=area*squared*weight;
          if(!grad)continue;
          const factor=squared*inv**3;
          for(let k=0;k<3;k++){
            const id=ids[k],gu=d*du[k]-c*dv[k],gv=a*dv[k]-b*du[k];
            grad[id][0]+=2*area*((a*du[k]+b*dv[k])*weight-factor*gu);
            grad[id][1]+=2*area*((c*du[k]+d*dv[k])*weight-factor*gv);
            diagonal[id]+=area*(weight*(du[k]**2+dv[k]**2)+3*factor*inv*(gu*gu+gv*gv));
          }
        }
        return sum;
      }
      const boundary=new Set(l.loops.flat());
      function clearBoundary(ps){
        const edges=l.boundary;
        for(let i=0;i<edges.length;i++){
          const {a,b}=edges[i],p=ps[a],q=ps[b];
          for(let j=0;j<i;j++){
            const {a:c,b:d}=edges[j];if(a===c||a===d||b===c||b===d)continue;
            if(turn(p,q,ps[c])*turn(p,q,ps[d])<0&&turn(ps[c],ps[d],p)*turn(ps[c],ps[d],q)<0)return false;
          }
        }
        return true;
      }
      for(let i=0;i<120;i++){
        const g=points.map(()=>[0,0]),diag=new Float64Array(points.length),prev=energy(points,g,diag);
        let accepted=false;
        for(let j=0;j<10;j++){
          const next=points.map((p,k)=>(i<20&&boundary.has(k))?p:p.map((v,h)=>v-step*g[k][h]/Math.max(diag[k],mass[k])));
          if(energy(next)<prev && (i<20||clearBoundary(next))){points=next;step=Math.min(1.8,step*1.3);accepted=true;break;}
          step*=.5;
        }
        if(!accepted)break;
      }
      return points;
    }
    function addChart(region,l,coords,method,cuts){
      let check=inspect(coords,l.triangles);if(!check.valid)return false;let quality=deformation(l,coords);const before=quality.stretch;let relaxation=false;
      if(!method.startsWith('CSI')&&quality.score>.005){const candidate=conformal(l,coords);if(candidate)for(const weight of [1,.5,.25,.125]){const ps=coords.map((p,i)=>p.map((v,k)=>v+(candidate[i][k]-v)*weight)),test=inspect(ps,l.triangles);if(!test.valid)continue;const next=deformation(l,ps);if(next.score<quality.score-1e-6&&next.stretch.areaWeightedP90<=quality.stretch.areaWeightedP90*1.02&&next.stretch.maximum<=quality.stretch.maximum*1.02){coords=ps;check=test;quality=next;relaxation=true;break;}}}
      if(character&&(quality.stretch.areaWeightedP90>3||quality.stretch.maximum>maxStretch*2)&&l.disk){
        const ps=relaxCharacter(l,coords,check),test=inspect(ps,l.triangles);
        if(test.valid){const next=deformation(l,ps);if(next.score<quality.score){coords=ps;check=test;quality=next;relaxation=true;}}
      }
      if(quality.stretch.areaWeightedP90>maxStretch||quality.stretch.maximum>maxStretch*4)return false;
      if(character){
        // 用纵坐标的面内梯度统一岛的上下方向，再用前向或左右坐标确定水平正向。
        const world=l.vertices.map(i=>character.points[i]),mean=(arr,k)=>arr.reduce((s,p)=>s+p[k],0)/arr.length;
        const mx=mean(coords,0),my=mean(coords,1),height=mean(world,1);
        let dx=0,dy=0;
        for(let i=0;i<coords.length;i++){dx+=(coords[i][0]-mx)*(world[i][1]-height);dy+=(coords[i][1]-my)*(world[i][1]-height);}
        const norm=Math.hypot(dx,dy)||1,s=dx/norm,c=(dx||dy)?dy/norm:1;
        coords=coords.map(([u,v])=>[c*(u-mx)-s*(v-my),s*(u-mx)+c*(v-my)]);
        const axis=region.group.startsWith('face')?2:0;
        if(coords.reduce((sum,p,i)=>sum+p[0]*world[i][axis],0)<0)coords.forEach(p=>p[0]*=-1);
        check=inspect(coords,l.triangles);
        if(!check.valid)return false;
      }
      if(character){
        // 让每个方向分配给稀疏岛尖的空间逐渐减小，限制变化幅度，并重新检查逐三角形拉伸。
        const bins=24,axes=[0,1].map(k=>{
          const low=check.lo[k],span=check.hi[k]-low,measure=new Float64Array(bins);
          for(const ids of l.triangles){
            const ps=ids.map(i=>coords[i]),xs=ps.map(p=>(p[k]-low)/span*bins).sort((a,b)=>a-b),[a,b,c]=xs;
            const area=Math.abs(turn(...ps))/2;
            const cdf=x=>x<=a?0:x>=c?1:x<b?(x-a)**2/((b-a)*(c-a)):1-(c-x)**2/((c-b)*(c-a));
            for(let j=Math.max(0,Math.floor(a));j<=Math.min(bins-1,Math.floor(c));j++)measure[j]+=area*(cdf(j+1)-cdf(j));
          }
          const prefix=[0];for(const v of measure)prefix.push(prefix.at(-1)+v);
          return value=>{
            const t=Math.max(0,Math.min(bins-1e-10,(value-low)/span*bins)),j=Math.floor(t);
            const cumulative=(prefix[j]+(t-j)*measure[j])/prefix[bins];
            return low+span*(.52*t/bins+.48*cumulative);
          };
        });
        const adjusted=coords.map(p=>p.map((v,k)=>axes[k](v))),test=inspect(adjusted,l.triangles);
        if(test.valid){const next=deformation(l,adjusted);if(next.stretch.areaWeightedP90<=maxStretch&&next.stretch.maximum<=4*maxStretch){coords=adjusted;check=test;quality=next;}}
      }
      const part=character?region.group.replace(/-[LR](?:-.+)?$/,''):null;
      const area3D=quality.area3D,detail=weights?.[part]??1,scale=detail*Math.sqrt(area3D/check.area),ps=coords.map(p=>p.map((v,k)=>(v-check.lo[k])*scale)),chart={region,l,ps,area:area3D*detail*detail,w:(check.hi[0]-check.lo[0])*scale,h:(check.hi[1]-check.lo[1])*scale};charts.push(chart);
      reports.push({group:region.group,faces:region.faces.length,method:method+(relaxation?'＋共形松弛':''),necessaryCuts:[...cuts],surfaceArea:area3D,overlapChecked:true,relaxationAccepted:relaxation,stretchBeforeRelaxation:before,stretch:quality.stretch});return true;
    }
    for(const region of regions){
      const faceSet=new Set(region.faces),patch=mesh.csiPatchGroups?.[region.faces[0]],saved=mesh.csiCharts?.find(c=>c.patch===patch)?.faceParameters;
      let cuts=new Set();if(saved){const all=mesh.faces.map((_,i)=>i).filter(i=>mesh.csiPatchGroups[i]===patch),order=new Map(all.map((fi,i)=>[fi,i]));for(const [k,e]of t.edges)if(e.faces.length===2&&e.faces.every(i=>faceSet.has(i))&&[e.a,e.b].some(v=>{const [a,b]=e.faces,pa=saved[order.get(a)]?.[mesh.faces[a].indexOf(v)],pb=saved[order.get(b)]?.[mesh.faces[b].indexOf(v)];return pa&&pb&&dist(pa,pb)>1e-8;}))cuts.add(k);}
      let l=local(region,cuts),coords=csi(region,l);
      if(coords&&addChart(region,l,coords,'CSI经纬参数',cuts))continue;
      coords=projection(l);if(coords&&addChart(region,l,coords,'平滑组平面投影',cuts))continue;
      if(character&&l.loops.length>1){const joined=joinBoundaryLoops(region);l=joined.l;cuts=joined.cuts;}
      if(l.disk&&!cuts.size){const perimeter=l.loops[0].reduce((s,v,i,a)=>s+dist(mesh.vertices[l.vertices[v]],mesh.vertices[l.vertices[a[(i+1)%a.length]]]),0),area=region.faces.reduce((s,i)=>s+t.data[i].area,0);if(perimeter<Math.sqrt(area)*2){cuts=openSmallBoundary(l);l=local(region,cuts);}}
      if(!l.disk){cuts=new Set([...cuts,...cutGraph(region)]);l=local(region,cuts);}
      coords=harmonic(l);if(coords&&addChart(region,l,coords,'平滑组圆盘调和展开',cuts))continue;
      // A face-dual tree is a last-resort disk cut, still one connected island.
      const fs=new Set(region.faces),dual=new Set(),visited=new Set([region.faces[0]]),queue=[region.faces[0]];for(let q=0;q<queue.length;q++){const f=mesh.faces[queue[q]];f.forEach((v,j)=>{const k=key(v,f[(j+1)%f.length]),e=t.edges.get(k);if(e.faces.length!==2)return;const other=e.faces.find(fi=>fi!==queue[q]);if(fs.has(other)&&!visited.has(other)){visited.add(other);queue.push(other);dual.add(k);}});}
      cuts=new Set([...t.edges].filter(([k,e])=>e.faces.length===2&&e.faces.every(fi=>fs.has(fi))&&!dual.has(k)).map(([k])=>k));l=local(region,cuts);coords=harmonic(l);
      if(coords&&addChart(region,l,coords,'平滑组保守圆盘切割',cuts))continue;
      if(Number.isFinite(maxStretch)&&region.faces.length>1){
        // 将高拉伸大岛按最长空间方向拆开，再保持每个新岛的面邻接连通。
        const centers=region.faces.map(i=>t.data[i].center),spans=[0,1,2].map(k=>Math.max(...centers.map(p=>p[k]))-Math.min(...centers.map(p=>p[k]))),axis=spans.indexOf(Math.max(...spans));
        const ordered=region.faces.slice().sort((a,b)=>t.data[a].center[axis]-t.data[b].center[axis]),half=Math.ceil(ordered.length/2);
        for(const part of [ordered.slice(0,half),ordered.slice(half)]){
          const allowed=new Set(part),visited=new Set();
          for(const id of part)if(!visited.has(id)){
            const faces=[id];visited.add(id);
            for(let q=0;q<faces.length;q++)for(const other of t.adj[faces[q]])if(allowed.has(other)&&!visited.has(other)){visited.add(other);faces.push(other);}
            regions.push({group:region.group,faces});
          }
        }
        continue;
      }
      throw Error('平滑组 '+region.group+' 的UV未通过无翻转/重叠检查；保留此前结果。 '+JSON.stringify({disk:l.disk,loops:l.loops.map(l=>l.length),euler:l.vertices.length-l.edges.size+l.faces.length,check:coords?inspect(coords,l.triangles):null}));
    }
    if(character){
      const placements=packCharacter(charts);
      if(placements){
        const uv=[],indices=mesh.faces.map(()=>[]),parts=[];let utilization=0;
        for(const {chart,x,y,scale} of placements){
          const base=uv.length;for(const [u,v] of chart.ps)uv.push([x+u*scale,y+v*scale]);
          chart.region.faces.forEach((fi,i)=>indices[fi]=chart.l.faces[i].map(v=>base+v));
          utilization+=chart.area*scale*scale;
          parts.push({group:chart.region.group,faces:chart.region.faces});
        }
        return {version:3,uv,indices,charts:charts.length,parts,density:weights,groupCount:new Set(labels).size,method:'人物部位展开',report:{islands:charts.length,charts:reports,packingUtilization:utilization,nonOverlapping:true,finite:true,geometryUnchanged:true}};
      }
    }
    const rectangleArea=charts.reduce((s,c)=>s+c.w*c.h,0),size=Math.sqrt(rectangleArea)*1.4,pad=Math.sqrt(rectangleArea)*.006;
    let x=pad,y=pad,row=0,maxX=0;const uv=[],indices=mesh.faces.map(()=>[]);
    for(const c of charts.sort((a,b)=>b.h-a.h)){if(x+c.w+pad>size&&x>pad){x=pad;y+=row+pad;row=0;}const offset=uv.length;for(const p of c.ps)uv.push([p[0]+x,p[1]+y]);c.region.faces.forEach((fi,i)=>indices[fi]=c.l.faces[i].map(v=>offset+v));x+=c.w+pad;row=Math.max(row,c.h);maxX=Math.max(maxX,x);}
    const extent=Math.max(maxX,y+row+pad);
    // 岛数过多时轮廓排放可能无解，行排仍须携带人物部位与倍率，供再次烘焙使用。
    if(character){
      const parts=charts.map(({region})=>({group:region.group,faces:region.faces}));
      return {version:3,uv:uv.map(p=>p.map(v=>v/extent)),indices,charts:charts.length,parts,density:weights,groupCount:new Set(labels).size,method:'人物部位展开（行排）',report:{islands:charts.length,charts:reports,packingUtilization:charts.reduce((sum,c)=>sum+c.area,0)/extent**2,nonOverlapping:true,finite:true,geometryUnchanged:true}};
    }
    return {version:2,uv:uv.map(p=>p.map(v=>v/extent)),indices,charts:charts.length,groupCount:new Set(labels).size,method:'按平滑组展开；CSI经纬 / 平面 / 正权重调和圆盘；统一面积密度',seamless:false,report:{islands:charts.length,smoothGroups:new Set(labels).size,singleFaceIslands:reports.filter(r=>r.faces===1).length,charts:reports,nonOverlapping:true,finite:true,geometryUnchanged:true,packingUtilization:reports.reduce((s,c)=>s+c.surfaceArea,0)/(extent*extent)}};
  }
  // 在独立的小图上比较左右同名区域。采样时逐像素核对岛归属，旁边的岛与空白均不参与。
  function shareCharacterColors(mesh,base,probe){
    if(!base.parts)return base;
    const {size,data,owner}=probe,uv=base.uv,tri=E.triangulate(mesh);
    const sections=base.parts.map(({group,faces},id)=>{
      const ids=[...new Set(faces.flatMap(fi=>base.indices[fi]))],points=ids.map(i=>uv[i]);
      const lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...points.map(p=>p[k])));
      return {group,faces,id,ids,lo,span:hi.map((x,k)=>x-lo[k]),samples:[],triangles:[]};
    });
    const byFace=new Int32Array(mesh.faces.length);
    sections.forEach(s=>s.faces.forEach(fi=>byFace[fi]=s.id));
    tri.faces.forEach((f,i)=>{const fi=tri.source[i];sections[byFace[fi]].triangles.push(f.map(v=>base.indices[fi][mesh.faces[fi].indexOf(v)]));});
    for(let i=0;i<owner.length;i++)if(owner[i]>=0)sections[owner[i]].samples.push(i);
    const world=new Map();
    mesh.faces.forEach((f,i)=>f.forEach((v,j)=>world.set(base.indices[i][j],mesh.vertices[v])));
    function alignedMaps(right,left,sign){
      const affine=p=>{const u=(p[0]-right.lo[0])/right.span[0],v=(p[1]-right.lo[1])/right.span[1];
        return [left.lo[0]+left.span[0]*(sign===1?u:1-u),left.lo[1]+left.span[1]*v];};
      const maps=[affine];
      const frame=mesh.headSideShading?.frame;
      if(frame){
        // 用对侧的几何对应点对齐两张独立展开的岛。宽核抑制耳根或腋下接缝处的跳变。
        const axis=frame.axes[0],center=s=>s.ids.reduce((p,i)=>E.add(p,E.mul(world.get(i),1/s.ids.length)),[0,0,0]);
        const a=center(right),b=center(left);
        const controls=right.ids.map(id=>{
          const q=sub(world.get(id),a),mirror=E.add(b,sub(q,E.mul(axis,2*dot(q,axis)))),p=uv[id],basePoint=affine(p);
          let nearest=null,best=Infinity;
          for(const dest of left.ids){
            const delta=sub(uv[dest],basePoint).map((x,k)=>x/left.span[k]);
            const d=(dist(world.get(dest),mirror)/frame.width)**2+.006*dot(delta,delta);
            if(d<best){best=d;nearest=dest;}
          }
          return {p,delta:sub(uv[nearest],basePoint)};
        });
        for(const radius of [.25,.13,.075]){
          const grid=13,nodes=[];
          for(let j=0;j<=grid;j++)for(let i=0;i<=grid;i++){
            let weight=0,du=0,dv=0;
            for(const c of controls){
              const x=(c.p[0]-right.lo[0])/right.span[0]-i/grid,y=(c.p[1]-right.lo[1])/right.span[1]-j/grid;
              const w=Math.exp(-(x*x+y*y)/(2*radius*radius));
              weight+=w;du+=w*c.delta[0];dv+=w*c.delta[1];
            }
            nodes.push([du/(weight||1),dv/(weight||1)]);
          }
          maps.push(p=>{
            const [u,v]=p.map((value,k)=>Math.min(grid-1e-9,Math.max(0,(value-right.lo[k])/right.span[k]*grid)));
            const i=Math.floor(u),j=Math.floor(v),result=affine(p);
            for(let y=0;y<=1;y++)for(let x=0;x<=1;x++){
              const w=(x?u-i:1-u+i)*(y?v-j:1-v+j),d=nodes[(j+y)*(grid+1)+i+x];
              result[0]+=w*d[0];result[1]+=w*d[1];
            }
            return result;
          });
        }
      }
      return maps;
    }
    function compareColors(right,left,map){
      const mapped=right.ids.map(i=>map(uv[i])),lookup=new Map(right.ids.map((id,i)=>[id,i]));
      if(!inspect(mapped,right.triangles.map(f=>f.map(i=>lookup.get(i)))).valid)return null;
      let n=0,error=0,distinct=0;
      for(const f of right.triangles){
        const old=f.map(k=>uv[k]),next=f.map(k=>mapped[lookup.get(k)]),den=turn(...old);
        const ix=old.map(p=>p[0]*size),iy=old.map(p=>(1-p[1])*size);
        const x0=Math.max(0,Math.floor(Math.min(...ix))),x1=Math.min(size,Math.ceil(Math.max(...ix)));
        const y0=Math.max(0,Math.floor(Math.min(...iy))),y1=Math.min(size,Math.ceil(Math.max(...iy)));
        for(let v=y0;v<y1;v++)for(let u=x0;u<x1;u++){
          const i=v*size+u;if(owner[i]!==right.id)continue;
          const q=[(u+.5)/size,1-(v+.5)/size],a=turn(old[1],old[2],q)/den,b=turn(old[2],old[0],q)/den,c=1-a-b;
          if(Math.min(a,b,c)<0)continue;
          const x=Math.floor(size*(a*next[0][0]+b*next[1][0]+c*next[2][0])),y=Math.floor(size*(1-a*next[0][1]-b*next[1][1]-c*next[2][1])),j=y*size+x;
          if(x<0||x>=size||y<0||y>=size||owner[j]!==left.id)continue;
          let peak=0;
          for(let k=0;k<4;k++){const d=Math.abs(data[i*4+k]-data[j*4+k]);if(k<3)error+=d;peak=Math.max(peak,d);}
          if(peak>32)distinct++;n++;
        }
      }
      const overlap=n/right.samples.length,mean=error/(3*n);
      return overlap>=.8&&mean<=8&&distinct<=n*.025?{mean,overlap}:null;
    }
    const pairs=[];
    for(const right of sections.filter(s=>s.group.includes('-R'))){
      const lefts=sections.filter(s=>s.group===right.group.replace('-R','-L')&&!s.mate);
      let best=null;
      for(const left of lefts){
        if(Math.min(left.samples.length,right.samples.length)<80)continue;
        for(const sign of [1,-1]){
          for(const map of alignedMaps(right,left,sign)){
            const match=compareColors(right,left,map);
            if(match&&(!best||match.mean<best.mean))best={left,map,...match};
          }
        }
      }
      if(best){right.into=best.left;right.map=best.map;best.left.mate=right;pairs.push({from:right.id,to:best.left.id,mean:best.mean,overlap:best.overlap});}
    }
    if(!pairs.length)return base;
    const charts=sections.filter(s=>!s.into).map(s=>{
      const ids=s.mate?s.ids.concat(s.mate.ids):s.ids,lookup=new Map(ids.map((v,i)=>[v,i]));
      const points=s.ids.map(i=>uv[i]).concat(s.mate?s.mate.ids.map(i=>s.mate.map(uv[i])):[]);
      const lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),ps=points.map(p=>p.map((x,k)=>x-lo[k]));
      const triangles=s.triangles.concat(s.mate?.triangles||[]).map(f=>f.map(i=>lookup.get(i)));
      const area=triangles.reduce((v,f)=>v+Math.abs(turn(...f.map(i=>ps[i])))/2,0);
      return {ids,region:{group:s.group},ps,l:{triangles},area,w:Math.max(...ps.map(p=>p[0])),h:Math.max(...ps.map(p=>p[1]))};
    });
    const placement=packCharacter(charts);if(!placement)return base;
    const packed=uv.slice();for(const {chart,scale,x,y} of placement)chart.ids.forEach((id,i)=>packed[id]=[x+scale*chart.ps[i][0],y+scale*chart.ps[i][1]]);
    return {...base,uv:packed,report:{...base.report,packingUtilization:null,sharedPairs:pairs,nonOverlapping:false}};
  }
  return {atlas,inspect,shareCharacterColors};
}
if(typeof module!=='undefined')module.exports=createContourUVUnwrap;
