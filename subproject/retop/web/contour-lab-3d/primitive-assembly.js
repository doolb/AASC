/* 中远档按曲面连通性试分区，每个区域独立比较解析体。 */
function createContourPrimitiveAssembly(E) {
  const {add,sub,mul,dot,unit,len,cross,clamp}=E;
  const MAX_BLOCKS=48;
  const labels={box:'长方体',roundedBox:'圆角盒',sphere:'球体',ellipsoid:'椭球',cylinder:'圆柱',frustum:'截锥',profilePrism:'轮廓棱柱',chamferBox:'切角盒',sectionBody:'变截面棱台'};

  function blockLimit(value=24) {
    if(!Number.isInteger(value)||value<1||value>MAX_BLOCKS)throw Error('体块上限须为 1～48 的整数。');
    return value;
  }

  function build(parameters,detail,buildOne) {
    const blocks=parameters.blocks;
    if(!Array.isArray(blocks)||!blocks.length||blocks.length>MAX_BLOCKS)throw Error('多基本体需要 1～48 组参数。');
    const vertices=[],faces=[],primitiveGroups=[],faceKinds=[];
    blocks.forEach((p,i)=>{
      if(!p||!['box','roundedBox','sphere','ellipsoid','cylinder','frustum','profilePrism','chamferBox','sectionBody'].includes(p.type))throw Error('多基本体的子体类型无效。');
      const mesh=buildOne(p),offset=vertices.length;
      vertices.push(...mesh.vertices);
      for(const face of mesh.faces){
        faces.push(face.map(v=>v+offset));primitiveGroups.push(i);faceKinds.push('part_'+(i+1)+'_'+(parameters.regions?.[i]||p.type));
      }
    });
    const triangles=faces.reduce((sum,f)=>sum+f.length-2,0);
    return {vertices,faces,faceKinds,primitiveGroups,method:'自动分区多基本体',primitive:{
      type:'assembly',label:'自动分区多基本体',parts:blocks.length,parameters,proxy:{detail,triangles},
      expression:blocks.map((p,i)=>(i+1)+' · '+labels[p.type]+'  ('+p.radii.map(v=>Number(v.toPrecision(3))).join(', ')+')').join('\n'),
      combination:'每个体块有独立坐标架与闭合表面，交界允许重叠'
    }};
  }

  // 在区域内按面积等距抽样，避免三角面密集的小装饰主导拟合。
  function representatives(ids,data,area) {
    if(ids.length<=170)return ids.map(i=>[i,data[i].area]);
    const result=[],step=area/170;
    let index=0,total=data[ids[0]].area;
    for(let i=0;i<170;i++){
      while(index+1<ids.length&&total<(i+.5)*step)total+=data[ids[++index]].area;
      result.push([ids[index],step]);
    }
    return result;
  }

  function principal(samples,origin,reference) {
    const cov=Array.from({length:3},()=>[0,0,0]);
    for(const s of samples){
      const q=sub(s.p,origin);
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)cov[i][j]+=s.w*q[i]*q[j];
    }
    const transform=v=>cov.map(row=>dot(row,v));
    function dominant(exclude) {
      const project=v=>exclude?sub(v,mul(exclude,dot(exclude,v))):v;
      const seeds=reference.map(v=>project(transform(project(v))));
      let v=seeds.reduce((a,b)=>len(a)>len(b)?a:b);
      if(len(v)<1e-24)return reference.find(a=>!exclude||Math.abs(dot(a,exclude))<.8);
      v=unit(v);
      for(let k=0;k<12;k++)v=unit(project(transform(v)));
      return v;
    }
    const x=dominant(),y=dominant(x),z=unit(cross(x,y));
    return [x,unit(cross(z,x)),z];
  }

  function fitRegion(ids,source,data,reference,scale) {
    const area=ids.reduce((s,id)=>s+data[id].area,0);
    const representativesInRegion=representatives(ids,data,area);
    const samples=representativesInRegion.map(([id,w])=>({p:data[id].center,n:data[id].normal,w:w/area}));
    const origin=samples.reduce((p,s)=>add(p,mul(s.p,s.w)),[0,0,0]);
    const axes=principal(samples,origin,reference),points=[];
    for(const [id] of representativesInRegion)for(const v of source.faces[id])points.push(sub(source.vertices[v],origin));
    // 同时尝试整体轴与局部轴。对称形体及斜伸肢体可分别保留稳定朝向。
    let best=null;
    for(const basis of [reference,axes]){
      const lo=[],hi=[];
      for(const axis of basis){
        const values=points.map(p=>dot(p,axis)).sort((a,b)=>a-b),trim=Math.floor(values.length*.003);
        lo.push(values[trim]);hi.push(values[values.length-1-trim]);
      }
      const half=mul(sub(hi,lo),.5).map(h=>Math.max(h,scale*.003));
      const center=mul(add(hi,lo),.5),world=add(origin,basis.reduce((p,a,k)=>add(p,mul(a,center[k])),[0,0,0]));
      const rows=samples.map(s=>({q:basis.map((a,k)=>dot(sub(s.p,world),a)/half[k]),n:basis.map(a=>dot(s.n,a)),w:s.w}));
      const small=Math.min(...half);
      function offer(type,power=2,axis=2,ratio=1){
        let loss=0;const a=(axis+1)%3,b=(axis+2)%3,round=type==='cylinder'||type==='frustum';
        for(const {q,n,w} of rows){
          let distance,alignment;
          if(round){
            const radial=Math.hypot(q[a],q[b])||1e-9,rr=(1+ratio+(ratio-1)*q[axis])/2/Math.max(1,ratio);
            const ga=q[a]/radial/half[a],gb=q[b]/radial/half[b],gc=(1-ratio)/(2*Math.max(1,ratio)*half[axis]);
            const g=Math.hypot(ga,gb,gc),side=(radial-rr)/g,cap=(Math.abs(q[axis])-1)*half[axis];
            distance=Math.max(side,cap);alignment=side>cap?Math.abs((ga*n[a]+gb*n[b]+gc*n[axis])/g):Math.abs(n[axis]);
          }else if(type==='box'){
            const d=q.map((v,k)=>(Math.abs(v)-1)*half[k]),k=d.indexOf(Math.max(...d));distance=d[k];alignment=Math.abs(n[k]);
          }else{
            const g=q.map((v,k)=>Math.sign(v)*Math.abs(v)**(power-1)/half[k]),m=Math.max(len(g),1/Math.max(...half)*.12);
            distance=(q.reduce((s,v)=>s+Math.abs(v)**power,0)-1)/(power*m);
            alignment=Math.min(1,Math.abs(dot(g,n))/m);
          }
          loss+=w*(Math.min(Math.abs(distance),2*small)**2+(small*.25*(1-alignment))**2);
        }
        if(best&&loss>=best.loss)return;
        const order=round?[a,b,axis]:[0,1,2];
        const p={type,basisOrigin:world,basisAxes:order.map(k=>basis[k]),center:[0,0,0],radii:order.map(k=>half[k])};
        if(type==='frustum'){p.topRatio=ratio;for(let i=0;i<2;i++)p.radii[i]/=Math.max(1,ratio);}
        if(type==='roundedBox')p.exponent=power;
        if(type==='ellipsoid'&&Math.max(...half)/small<1.055){p.type='sphere';p.radii=Array(3).fill(half.reduce((s,v)=>s+v)/3);}
        best={p,loss};
      }
      offer('box');offer('ellipsoid');offer('roundedBox',4);
      for(let k=0;k<3;k++){
        offer('cylinder',2,k);
        const a=(k+1)%3,b=(k+2)%3;
        const radii=sign=>rows.filter(s=>s.q[k]*sign>.32&&Math.abs(s.n[k])<.75).map(s=>Math.hypot(s.q[a],s.q[b])).sort((x,y)=>x-y);
        const bottom=radii(-1),top=radii(1);
        if(bottom.length>2&&top.length>2){
          const ratio=clamp((top[Math.floor(top.length*.65)]/Math.max(.15,bottom[Math.floor(bottom.length*.65)]))**1.5,.32,2.8);
          if(Math.abs(1-ratio)>.09)offer('frustum',2,k,ratio);
        }
      }
    }
    return {ids,area,cost:best.loss*area,p:best.p,axes};
  }

  // 截取三角形与格柱的交点，奇偶配对得到实体体素。体积评分会惩罚穿过腋下和两腿间隙的几何体。
  function solidSamples(source,ctx) {
    if([...E.topology(source).edges.values()].some(e=>e.faces.length!==2))return null;
    const pts=ctx.f.local,lo=[Infinity,Infinity,Infinity],hi=lo.map(()=>-Infinity);
    for(const p of pts)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    const step=ctx.s/52,dim=hi.map((x,k)=>Math.ceil((x-lo[k])/step)),[nx,ny,nz]=dim;
    const hits=Array.from({length:nx*ny},()=>[]);
    for(const face of source.faces)for(let j=1;j+1<face.length;j++){
      const [a,b,c]=[face[0],face[j],face[j+1]].map(i=>pts[i]);
      const u=sub(b,a),v=sub(c,a),det=u[0]*v[1]-v[0]*u[1];
      if(Math.abs(det)<step*step*1e-9)continue;
      const first=[0,1].map(k=>Math.max(0,Math.ceil((Math.min(a[k],b[k],c[k])-lo[k])/step-.5)));
      const last=[0,1].map(k=>Math.min(dim[k]-1,Math.floor((Math.max(a[k],b[k],c[k])-lo[k])/step-.5)));
      for(let y=first[1];y<=last[1];y++)for(let x=first[0];x<=last[0];x++){
        const dx=lo[0]+(x+.500013)*step-a[0],dy=lo[1]+(y+.500027)*step-a[1];
        const s=(dx*v[1]-dy*v[0])/det,t=(u[0]*dy-u[1]*dx)/det;
        if(s>=0&&t>=0&&s+t<=1)hits[y*nx+x].push(a[2]+s*u[2]+t*v[2]);
      }
    }
    const index=new Int32Array(nx*ny*nz).fill(-1),data=[],adj=[];
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const list=hits[y*nx+x].sort((a,b)=>a-b);
      for(let j=1;j<list.length;j+=2){
        const start=Math.max(0,Math.ceil((list[j-1]-lo[2])/step-.5));
        for(let z=start;z<nz&&lo[2]+(z+.5)*step<list[j];z++){
          const id=data.length,key=x+nx*(y+ny*z);index[key]=id;adj.push([]);
          data.push({cell:[x,y,z],center:ctx.f.toWorld([x,y,z].map((n,k)=>lo[k]+(n+.5)*step)),area:step**3});
          for(const n of [x>0?key-1:-1,y>0?key-nx:-1,z>0?key-nx*ny:-1]){
            if(n<0||index[n]<0)continue;
            adj[id].push(index[n]);adj[index[n]].push(id);
          }
        }
      }
    }
    return data.length>=80?{data,adj,step,lo,dim}:null;
  }

  // 在相同分区上比较覆盖到的实体和向外多占的体积，可区分大小相近的盒、椭球和截锥。
  function fitSolid(ids,data,reference,step){
    const volume=ids.length*step**3,rep=representatives(ids,data,volume);
    const samples=rep.map(([i,w])=>({p:data[i].center,w:w/volume}));
    const origin=samples.reduce((p,s)=>add(p,mul(s.p,s.w)),[0,0,0]);
    const axes=principal(samples,origin,reference);let best=null;
    for(const basis of [reference,axes]){
      const lo=[Infinity,Infinity,Infinity],hi=lo.map(()=>-Infinity);
      for(const id of ids){
        const p=sub(data[id].center,origin);
        for(let k=0;k<3;k++){const x=dot(p,basis[k]);lo[k]=Math.min(lo[k],x);hi[k]=Math.max(hi[k],x);}
      }
      const half=hi.map((h,k)=>(h-lo[k]+step)/2),mid=mul(add(lo,hi),.5),world=add(origin,basis.reduce((p,a,k)=>add(p,mul(a,mid[k])),[0,0,0]));
      const q=samples.map(s=>basis.map((a,k)=>dot(sub(s.p,world),a)/half[k]));
      function offer(type,k,ratio,power,factor){
        const a=(k+1)%3,b=(k+2)%3,round=type==='cylinder'||type==='frustum';
        const baseVolume=factor*half[0]*half[1]*half[2];
        const soft=.48*step/(round?Math.min(half[a],half[b]):Math.min(...half));
        for(const t of [.94,1,1.045]){
          const approx=baseVolume*t**(round?2:3);
          let inside=0;for(let i=0;i<q.length;i++)inside+=samples[i].w*clamp(.5+(t-q[i].radius)/soft,0,1);
          const exposed=half[0]*half[1]+half[1]*half[2]+half[2]*half[0];
          const score=volume+approx-2*Math.min(inside*volume,approx)+exposed*step*.7;
          if(best&&score>=best.cost)continue;
          const order=round?[a,b,k]:[0,1,2];
          const p={type,basisOrigin:world,basisAxes:order.map(j=>basis[j]),center:[0,0,0],radii:order.map(j=>half[j]*t)};
          if(round){p.radii[2]=half[k];p.radii[0]/=Math.max(1,ratio);p.radii[1]/=Math.max(1,ratio);}
          if(type==='frustum')p.topRatio=ratio;
          if(type==='roundedBox')p.exponent=power;
          if(type==='ellipsoid'&&Math.max(...half)/Math.min(...half)<1.03){p.type='sphere';p.radii=Array(3).fill(Math.cbrt(p.radii.reduce((s,r)=>s*r,1)));}
          best={p,cost:score};
        }
      }
      for(const [type,power,factor] of [['box',Infinity,8],['ellipsoid',2,4*Math.PI/3],['roundedBox',4,6.482]]){
        for(const z of q)z.radius=Number.isFinite(power)?(Math.abs(z[0])**power+Math.abs(z[1])**power+Math.abs(z[2])**power)**(1/power):Math.max(...z.map(Math.abs));
        offer(type,2,1,power,factor);
      }
      for(let k=0;k<3;k++){
        const a=(k+1)%3,b=(k+2)%3;
        for(const ratio of [1,.64,1/.64]){
          for(const z of q)z.radius=Math.hypot(z[a],z[b])*Math.max(1,ratio)/((1+ratio+(ratio-1)*z[k])/2);
          offer(ratio===1?'cylinder':'frustum',k,ratio,2,2*Math.PI*(1+ratio+ratio**2)/(3*Math.max(1,ratio)**2));
        }
      }
    }
    return {ids,area:volume,axes,...best};
  }

  // 从实体外壳向内计算厚度。越过细颈才相连的厚区作为不同起点，可分开同一壳体内的头、手臂和胸廓。
  function medialGroups(data,adj,limit) {
    const n=data.length,depth=new Float64Array(n).fill(-1),queue=[];
    for(let i=0;i<n;i++)if(adj[i].length<6){depth[i]=0;queue.push(i);}
    for(let i=0;i<queue.length;i++)for(const next of adj[queue[i]])if(depth[next]<0){
      depth[next]=depth[queue[i]]+1;queue.push(next);
    }
    let height=depth;
    for(let iter=0;iter<3;iter++)height=height.map((v,i)=>(v*3+adj[i].reduce((s,j)=>s+height[j],0))/(3+adj[i].length));
    const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>height[b]-height[a]||a-b);
    const peak=new Int32Array(n).fill(-1),parent=new Int32Array(n),size=new Int32Array(n);
    const death=new Map();
    function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    for(const i of order){
      const uphill=adj[i].filter(j=>peak[j]>=0).sort((a,b)=>height[b]-height[a]);
      if(!uphill.length){peak[i]=parent[i]=i;size[i]=1;continue;}
      peak[i]=peak[uphill[0]];
      const roots=[...new Set(uphill.map(j=>root(peak[j])))].sort((a,b)=>height[b]-height[a]||a-b);
      const keep=roots[0];size[keep]++;
      for(const lost of roots.slice(1)){
        death.set(lost,{saddle:height[i],volume:size[lost],next:keep});parent[lost]=keep;size[keep]+=size[lost];
      }
    }
    const maxima=order.filter(i=>peak[i]===i);
    const priority=p=>{
      const d=death.get(p);return d?(height[p]-d.saddle)*Math.cbrt(d.volume):100+size[p];
    };
    const main=maxima.filter(p=>size[p]>=4&&(!death.has(p)||(height[p]-death.get(p).saddle>.45&&death.get(p).volume>=7)))
      .sort((a,b)=>priority(b)-priority(a)).slice(0,limit);
    if(main.length<2)return null;
    const chosen=new Set(main),owner=new Int32Array(n).fill(-1),work=[];
    for(const i of order){
      let p=peak[i];while(!chosen.has(p)&&death.has(p))p=death.get(p).next;
      if(chosen.has(p)&&height[i]>=Math.max(.55*height[p],death.get(p)?.saddle??0)){
        owner[i]=p;work.push(i);
      }
    }
    for(let i=0;i<work.length;i++)for(const next of adj[work[i]])if(owner[next]<0){
      owner[next]=owner[work[i]];work.push(next);
    }
    const lists=new Map(main.map(p=>[p,[]]));
    for(let i=0;i<n;i++){
      if(owner[i]<0){
        let nearest=main[0];for(const p of main)if(E.dist(data[p].center,data[i].center)<E.dist(data[nearest].center,data[i].center))nearest=p;
        owner[i]=nearest;
      }
      lists.get(owner[i]).push(i);
    }
    return [...lists.values()].filter(a=>a.length);
  }

  // 沿最大跨度观察截面分支。若两个侧枝逐渐贴到中央体块，沿前一截面的厚度延续两侧归属，
  // 直到该枝不再有足够宽度，可避免一张横截面把两臂与胸廓吞为一块。
  function axialGroups(solid,limit){
    const {data}=solid,rows=[];
    for(let id=0;id<data.length;id++){
      const [level,col]=data[id].cell;
      rows[level]??=[];rows[level][col]??=[];rows[level][col].push(id);
    }
    const section=(ids)=>{
      let lo=Infinity,hi=-Infinity;
      for(const id of ids){const col=data[id].cell[1];lo=Math.min(lo,col);hi=Math.max(hi,col);}
      return {ids,lo,hi,middle:(lo+hi)/2,width:hi-lo+1};
    };
    const layers=rows.map(cols=>{
      const parts=[];let ids=[];
      for(let j=0;j<=cols.length;j++){
        if(cols[j]?.length)ids.push(...cols[j]);
        else if(ids.length){parts.push(section(ids));ids=[];}
      }
      return parts;
    });
    const major=parts=>parts.filter(s=>s.ids.length>=6&&s.width>=3);
    for(const dir of [-1,1])for(let k=0;k<layers.length;k++){
      const prev=major(layers[k]||[]).sort((a,b)=>a.lo-b.lo),prior=major(layers[k-dir]||[]);
      if(prev.length!==3||prior.length!==3||major(layers[k+dir]||[]).length>=3)continue;
      const middle=prev[1],left=prev[0],right=prev[2];
      if(middle.width<1.25*Math.max(left.width,right.width))continue;
      for(let j=k+dir;layers[j];j+=dir){
        const pieces=major(layers[j]);if(pieces.length>2||!pieces.length)break;
        const all=section(layers[j].flatMap(s=>s.ids));
        if(all.width<middle.width+.6*(left.width+right.width))break;
        const width=Math.min(1,(all.width-middle.width)/(left.width+right.width));
        const a=all.lo+left.width*width,b=all.hi-right.width*width;
        const subsets=[[],[],[]];
        for(const id of all.ids){const x=data[id].cell[1];subsets[x<a?0:x>b?2:1].push(id);}
        if(subsets.some(g=>g.length<5))break;
        layers[j]=subsets.map(section);
      }
    }
    const tracks=[];
    for(let k=0;k<layers.length;k++){
      const before=layers[k-1]||[],now=layers[k]||[];
      const score=(a,b)=>{
        const overlap=Math.max(0,Math.min(a.hi,b.hi)-Math.max(a.lo,b.lo)+1);
        return overlap/(a.width+b.width-overlap);
      };
      const best=(a,list)=>list.reduce((r,b)=>!r||score(a,b)>score(a,r)?b:r,null);
      for(const s of now){
        const p=best(s,before);
        const joining=before.filter(b=>b.width>=3&&score(s,b)>.24).length>1;
        const branching=p&&now.filter(b=>b.width>=3&&score(p,b)>.24).length>1;
        if(p&&!joining&&!branching&&score(s,p)>.46&&best(p,now)===s)s.track=p.track;
        else{s.track={ids:[],length:0};tracks.push(s.track);}
        s.track.ids.push(...s.ids);s.track.length++;
      }
    }
    // 一根连续分支也可能由细颈相连的多个大形组成。以截面积谷底分离相邻厚区。
    const separated=[];
    function neckSplit(track){
      const bins=new Map();
      for(const id of track.ids){
        const k=data[id].cell[0];bins.set(k,(bins.get(k)||0)+1);
      }
      const keys=[...bins.keys()].sort((a,b)=>a-b),counts=keys.map(k=>((bins.get(k-1)||bins.get(k))+2*bins.get(k)+(bins.get(k+1)||bins.get(k)))/4);
      let at=-1,contrast=1.22;
      for(let j=3;j<keys.length-3;j++){
        if(counts[j]>counts[j-1]||counts[j]>counts[j+1])continue;
        const ratio=Math.min(Math.max(...counts.slice(0,j-1)),Math.max(...counts.slice(j+2)))/counts[j];
        if(ratio>contrast){contrast=ratio;at=keys[j];}
      }
      if(at<0){separated.push(track);return;}
      for(const side of [-1,1]){
        const ids=track.ids.filter(i=>(data[i].cell[0]<=at?-1:1)===side);
        neckSplit({ids,length:new Set(ids.map(i=>data[i].cell[0])).size});
      }
    }
    tracks.forEach(neckSplit);
    const ordered=separated.sort((a,b)=>b.ids.length-a.ids.length);
    const keep=ordered.filter(t=>t.length>=3&&t.ids.length>=data.length*.012).slice(0,limit);
    if(keep.length<3)return null;
    // 微小分支跟随最近的稳定实体，保留其对外形尺寸的贡献。
    const owner=new Int32Array(data.length).fill(-1),queue=[];
    keep.forEach((t,i)=>{for(const id of t.ids){owner[id]=i;queue.push(id);}});
    for(let i=0;i<queue.length;i++)for(const id of solid.adj[queue[i]])if(owner[id]<0){
      owner[id]=owner[queue[i]];queue.push(id);
    }
    const groups=keep.map(()=>[]),centers=keep.map(t=>mul(t.ids.reduce((p,id)=>add(p,data[id].center),[0,0,0]),1/t.ids.length));
    data.forEach((d,id)=>{
      let k=owner[id];
      if(k<0){k=0;for(let j=1;j<centers.length;j++)if(E.dist(d.center,centers[j])<E.dist(d.center,centers[k]))k=j;}
      groups[k].push(id);
    });
    return groups;
  }

  function fit(source,ctx,limit,progress) {
    limit=blockLimit(limit);
    const t=E.topology(source),visited=new Set(),shells=[];
    // 原本独立的壳体先直接分类，避免体素离散把简单圆柱切成多个短块。
    for(let seed=0;seed<t.data.length;seed++)if(!visited.has(seed)){
      const shell=[seed];visited.add(seed);
      for(let i=0;i<shell.length;i++)for(const f of t.adj[shell[i]])if(!visited.has(f)){visited.add(f);shell.push(f);}
      shells.push(shell);
    }
    if(shells.length>1&&shells.length<=limit){
      const blocks=shells.map(ids=>{
        const map=new Map(),vertices=[];
        const faces=ids.map(i=>source.faces[i].map(id=>{
          if(!map.has(id)){map.set(id,vertices.length);vertices.push(source.vertices[id]);}return map.get(id);
        }));
        const mesh={vertices,faces},frame=E.frame(mesh);
        return surfaceParameters(mesh,{f:frame,s:frame.scale});
      });
      return {type:'assembly',blocks};
    }
    const solid=solidSamples(source,ctx);
    const {data,adj}=solid||E.topology(source),reference=ctx.f.axes,scale=ctx.s;
    const side=new Int8Array(data.length),seen=new Int32Array(data.length);let pass=0;
    const ids=data.map((_,i)=>i);
    function components(region){
      pass++;const result=[];
      for(const seed of region){
        if(seen[seed]===pass)continue;
        const list=[seed];seen[seed]=pass;
        for(let j=0;j<list.length;j++)for(const next of adj[list[j]]){
          if(seen[next]===pass||side[next]!==side[seed])continue;
          seen[next]=pass;list.push(next);
        }
        result.push(list);
      }
      return result;
    }
    if(solid&&limit>=16){
      const charFactory=typeof createContourCharacterVolumes==='function'?createContourCharacterVolumes:require('./character-volumes.js');
      const torso=charFactory(E).partition(source,ctx,solid,limit);
      if(torso){
        const blocks=torso.groups.map((ids,i)=>{
          const part=fitSolid(ids,data,reference,solid.step).p;
          // 躯干及胸前装备沿人物坐标架包覆，避免用一块斜体跨过左右肩和腰窝。
          if(['chest','waist','pelvis','neck','head','crown'].includes(torso.names[i])||torso.names[i].startsWith('front-pouch')){
            part.enclosureAxes=torso.axes;
          }
          return part;
        });
        const p={type:'assembly',blocks,regions:torso.names};
        Object.defineProperty(p,'locate',{value:torso.locate});return p;
      }
    }
    const groups=(solid&&limit>=3?(axialGroups(solid,limit)||medialGroups(data,adj,Math.max(3,Math.ceil(limit*.65)))):null)||components(ids);
    const regionFit=list=>solid?fitSolid(list,data,reference,solid.step):fitRegion(list,source,data,reference,scale);
    const blocks=groups.length<=limit?groups.map(regionFit):[regionFit(ids)];
    const totalArea=blocks.reduce((s,b)=>s+b.area,0),threshold=totalArea*(solid ? .0009 : (scale*.00085)**2);
    function proposals(region){
      const list=[],ids=region.ids;
      if(ids.length<16||region.cost<threshold)return list;
      const directions=reference.slice();
      for(const a of region.axes)if(directions.every(b=>Math.abs(dot(a,b))<.90))directions.push(a);
      for(const axis of directions){
        const values=ids.map(i=>dot(data[i].center,axis));let lo=Infinity,hi=-Infinity;
        for(const v of values){lo=Math.min(lo,v);hi=Math.max(hi,v);}
        if(hi-lo<scale*.045)continue;
        for(const t of [.23,.40,.55,.73]){
          const cut=lo+(hi-lo)*t;
          ids.forEach((id,i)=>side[id]=values[i]<cut?1:2);
          const fragments=components(ids);ids.forEach(id=>side[id]=0);
          const significant=s=>s.length>=4&&s.reduce((sum,i)=>sum+data[i].area,0)>=totalArea*.0015;
          const sets=fragments.filter(significant);
          if(sets.length<2||sets.length>Math.min(8,limit))continue;
          const centers=sets.map(list=>mul(list.reduce((p,id)=>add(p,data[id].center),[0,0,0]),1/list.length));
          for(const fragment of fragments)if(!sets.includes(fragment)){
            const p=data[fragment[0]].center,distances=centers.map(c=>E.dist(p,c));
            const target=sets[distances.indexOf(Math.min(...distances))];
            for(const id of fragment)target.push(id);
          }

          const children=sets.map(regionFit),extra=children.length-1;
          const gain=(region.cost-children.reduce((s,b)=>s+b.cost,0))/extra;
          if(gain>threshold)list.push({children,gain,extra});
        }
      }
      return list.sort((a,b)=>b.gain-a.gain);
    }
    while(blocks.length<limit){
      let best=null,index=-1;
      blocks.forEach((block,i)=>{
        block.choices??=proposals(block);
        const choice=block.choices.find(c=>blocks.length+c.extra<=limit);
        if(choice&&(!best||choice.gain>best.gain)){best=choice;index=i;}
      });
      if(!best)break;
      blocks.splice(index,1,...best.children);
      progress('自动分区及几何体选型 · '+blocks.length+' 个体块');
    }
    const parameters={type:'assembly',blocks:blocks.map(b=>b.p)};
    if(solid){
      // 将完整高模的面送回分区时用的实体格，稀疏格由最近的已占格补全。
      const [nx,ny,nz]=solid.dim,stride=[1,nx,nx*ny],labels=new Int16Array(nx*ny*nz).fill(-1),queue=[];
      blocks.forEach((b,k)=>b.ids.forEach(id=>{
        const [x,y,z]=data[id].cell,cell=x+nx*(y+ny*z);labels[cell]=k;queue.push(cell);
      }));
      for(let i=0;i<queue.length;i++){
        const key=queue[i],coord=[key%nx,Math.floor(key/nx)%ny,Math.floor(key/(nx*ny))];
        for(let j=0;j<3;j++)for(const sign of [-1,1]){
          const next=key+sign*stride[j],v=coord[j]+sign;
          if(v>=0&&v<solid.dim[j]&&labels[next]<0){labels[next]=labels[key];queue.push(next);}
        }
      }
      Object.defineProperty(parameters,'locate',{value:(x,y,z)=>{
        const d=[x-ctx.f.center[0],y-ctx.f.center[1],z-ctx.f.center[2]];
        let key=0;
        for(let j=0;j<3;j++)key+=clamp(Math.floor((dot(d,reference[j])-solid.lo[j])/solid.step),0,solid.dim[j]-1)*stride[j];
        return labels[key];
      }});
    }
    return parameters;
  }
  // 最终约束使用导出网格的三角面平面，包含低分段圆弧的弦边。
  function planesOf(mesh,origin=[0,0,0]) {
    const planes=[];
    for(const f of mesh.faces)for(let i=1;i<f.length-1;i++){
      const a=mesh.vertices[f[0]],b=mesh.vertices[f[i]],c=mesh.vertices[f[i+1]];
      const n=unit(cross(sub(b,a),sub(c,a))),h=dot(n,sub(a,origin));
      if(len(n)>.9)planes.push([n[0],n[1],n[2],h]);
    }
    return planes;
  }

  function coverage(source,meshes,padding) {
    const words=Math.ceil(meshes.length/32),membership=new Uint32Array(source.vertices.length*words);
    meshes.forEach((mesh,k)=>{
      const {lo,hi}=E.bounds(mesh),planes=planesOf(mesh);
      for(let i=0;i<source.vertices.length;i++){
        const [x,y,z]=source.vertices[i];
        if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1]||z<lo[2]||z>hi[2])continue;
        let inside=true;
        for(const [a,b,c,h] of planes)if(a*x+b*y+c*z>h-padding){inside=false;break;}
        if(inside)membership[i*words+(k>>>5)]|=1<<(k%32);
      }
    });
    let uncoveredTriangles=0,sourceTriangles=0,outsideVertices=0;
    for(let i=0;i<membership.length;i+=words)if(!membership[i]&&(words===1||!membership[i+1]))outsideVertices++;
    for(const face of source.faces){
      let covered=false;
      for(let w=0;w<words&&!covered;w++){
        let common=0xffffffff;
        for(const id of face){common&=membership[id*words+w];if(!common)break;}
        covered=common!==0;
      }
      sourceTriangles+=face.length-2;
      if(!covered)uncoveredTriangles+=face.length-2;
    }
    return {sourceTriangles,outsideVertices,uncoveredTriangles,padding};
  }

  // 截面用有限个支撑直线围成凸多边形；两个相似截面生成棱柱或截棱锥。
  function prism(p) {
    const ring=p.outline,axes=p.basisAxes,origin=p.basisOrigin,h=p.radii?.[2],ratio=p.topRatio;
    if(!Array.isArray(ring)||ring.length<3||ring.length>16||!ring.every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite))||
      ![h,ratio].every(x=>Number.isFinite(x)&&x>0)||!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isFinite)||
      !Array.isArray(axes)||axes.length!==3||!axes.every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)&&Math.abs(len(a)-1)<1e-5)||
      dot(cross(axes[0],axes[1]),axes[2])<.99999)throw Error('局部棱柱截面或坐标架无效。');
    const vertices=[],faces=[],center=ring.reduce((s,p)=>[s[0]+p[0]/ring.length,s[1]+p[1]/ring.length],[0,0]);
    function vertex(x,y,z){
      vertices.push(origin.map((v,i)=>v+x*axes[0][i]+y*axes[1][i]+z*axes[2][i]));return vertices.length-1;
    }
    const ends=[0,1].map(end=>{
      const s=end?ratio:1,z=end?h:-h,ids=[];
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];ids.push(vertex(a[0]*s,a[1]*s,z),vertex((a[0]+b[0])*s/2,(a[1]+b[1])*s/2,z));
      }
      const pole=vertex(center[0]*s,center[1]*s,z);
      for(let i=0;i<ids.length;i+=2){
        const face=[ids[(i+ids.length-1)%ids.length],ids[i],ids[i+1],pole];faces.push(end?face:face.reverse());
      }
      return ids;
    });
    for(let i=0;i<ends[0].length;i++){
      const j=(i+1)%ends[0].length;faces.push([ends[0][i],ends[0][j],ends[1][j],ends[1][i]]);
    }
    const mesh={vertices,faces};if(!E.audit(mesh).valid)throw Error('棱柱截面退化。');return mesh;
  }

  function fitPrism(local,half,basis,center,axis,ratio,padding,stride) {
    const order=[(axis+1)%3,(axis+2)%3,axis],a=order[0],b=order[1],h=half[axis];
    const normals=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4),Math.sin(i*Math.PI/4)]);
    const offsets=normals.map(()=>-Infinity);
    for(let i=0;i<local.length;i+=3*stride){
      const s=(1+ratio+(ratio-1)*local[i+axis]/h)/2,x=local[i+a]/s,y=local[i+b]/s;
      for(let j=0;j<8;j++)offsets[j]=Math.max(offsets[j],x*normals[j][0]+y*normals[j][1]);
    }
    const R=Math.max(...half)*10;let polygon=[[-R,-R],[R,-R],[R,R],[-R,R]];
    for(let j=0;j<8;j++){
      const n=normals[j],d=offsets[j]+padding*4/Math.min(1,ratio),next=[];
      for(let i=0;i<polygon.length;i++){
        const p=polygon[i],q=polygon[(i+1)%polygon.length],v=p[0]*n[0]+p[1]*n[1]-d,w=q[0]*n[0]+q[1]*n[1]-d;
        if(v<=0)next.push(p);
        if((v<0)!==(w<0)){const t=v/(v-w);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
      }
      polygon=next;
    }
    polygon=polygon.filter((p,i,arr)=>Math.hypot(p[0]-arr[(i+1)%arr.length][0],p[1]-arr[(i+1)%arr.length][1])>padding*.001);
    const twice=polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0);
    return {p:{type:'profilePrism',basisOrigin:center,basisAxes:order.map(k=>basis[k]),center:[0,0,0],radii:order.map(j=>half[j]),outline:polygon,topRatio:ratio},
      score:twice*h*(1+ratio+ratio**2)/3*1.045};
  }

  // 切角盒以原始数据的支撑平面切去包围盒空角，可同时保留肩斜面和胸廓侧面。
  function boxFaces(){
    const v=Array.from({length:8},(_,i)=>[i&1?1:-1,i&2?1:-1,i&4?1:-1]);
    return [[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]].map(f=>f.map(i=>v[i]));
  }
  function clip(faces,cut){
    const n=cut.slice(0,3),h=cut[3],boundary=new Map(),out=[];
    for(const face of faces){
      const poly=[];
      for(let i=0;i<face.length;i++){
        const a=face[i],b=face[(i+1)%face.length],da=dot(n,a)-h,db=dot(n,b)-h;
        if(da<=0)poly.push(a);
        if((da<0)!==(db<0)){
          const t=da/(da-db),q=add(a,mul(sub(b,a),t));
          poly.push(q);boundary.set(q.map(v=>Math.round(v*1e9)).join(','),q);
        }
      }
      if(poly.length>=3)out.push(poly);
    }
    const cap=[...boundary.values()];
    if(cap.length>=3){
      const c=mul(cap.reduce(add,[0,0,0]),1/cap.length),x=unit(sub(cap[0],c)),y=unit(cross(n,x));
      const angle=p=>Math.atan2(dot(sub(p,c),y),dot(sub(p,c),x));
      out.push(cap.sort((a,b)=>angle(a)-angle(b)));
    }
    return out;
  }
  function volumeOf(faces){
    let volume=0;
    for(const f of faces)for(let i=1;i+1<f.length;i++)volume+=dot(f[0],cross(f[i],f[i+1]))/6;
    return Math.abs(volume);
  }
  // 奇数边面两两配对，在对偶路径的公共边插点。各面随后沿平面拆成四边形，保持原包络平面。
  function planarQuads(mesh){
    const {vertices,faces}=mesh,edges=E.topology(mesh).edges,links=faces.map(()=>[]);
    for(const [key,e] of edges)if(e.faces.length===2){
      const [a,b]=e.faces;links[a].push([b,key]);links[b].push([a,key]);
    }
    const odd=new Set(faces.flatMap((f,i)=>f.length%2?[i]:[])),split=new Set();
    while(odd.size){
      const start=odd.values().next().value;odd.delete(start);
      const paths=new Map([[start,null]]),todo=[start];let end=-1;
      for(let i=0;i<todo.length&&end<0;i++)for(const [next,key] of links[todo[i]]){
        if(paths.has(next))continue;paths.set(next,[todo[i],key]);todo.push(next);
        if(odd.has(next)){end=next;break;}
      }
      if(end<0)return mesh;
      odd.delete(end);
      while(end!==start){const [prev,key]=paths.get(end);if(split.has(key))split.delete(key);else split.add(key);end=prev;}
    }
    const vs=vertices.slice(),fs=[],mid=new Map(),eps=E.bounds(mesh).diagonal**2*1e-12;
    for(const key of split){const {a,b}=edges.get(key);mid.set(key,vs.length);vs.push(mul(add(vs[a],vs[b]),.5));}
    const turn=(a,b,c,n)=>dot(cross(sub(vs[b],vs[a]),sub(vs[c],vs[b])),n)>eps;
    function splitFace(ids,n){
      const m=ids.length;
      for(let i=0;i<m;i++){
        const q=[0,1,2,3].map(j=>ids[(i+j)%m]);
        if(!q.every((id,j)=>turn(id,q[(j+1)%4],q[(j+2)%4],n)))continue;
        if(m===4)return [q];
        const rest=ids.filter((_,j)=>j!==(i+1)%m&&j!==(i+2)%m),pieces=splitFace(rest,n);
        if(pieces)return [q,...pieces];
      }
      return null;
    }
    for(const f of faces){
      const ids=[];
      for(let i=0;i<f.length;i++){
        ids.push(f[i]);const m=mid.get(E.key(f[i],f[(i+1)%f.length]));if(m!==undefined)ids.push(m);
      }
      const quads=splitFace(ids,E.faceData(mesh,f).normal);
      if(quads){fs.push(...quads);continue;}
      // 边上已有共线中点时，局部凸多边形未必能只沿对角线拆成严格凸四边面。
      // 从面内中心每次连接两条边；把中心放在首角，导出三角扇的每个三角形都有面积。
      const center=vs.length;
      vs.push(mul(ids.reduce((sum,id)=>add(sum,vs[id]),[0,0,0]),1/ids.length));
      for(let i=0;i<ids.length;i+=2)fs.push([center,ids[i],ids[i+1],ids[(i+2)%ids.length]]);
    }
    return {vertices:vs,faces:fs};
  }

  function chamferBox(p){
    if(!Array.isArray(p.cuts)||p.cuts.length>(p.type==='sectionBody'?24:8)||!p.cuts.every(c=>Array.isArray(c)&&c.length===4&&c.every(Number.isFinite)))throw Error('切角盒支撑面无效。');
    const polygons=p.cuts.reduce(clip,boxFaces()),vertices=[],faces=[],index=new Map();
    function vertex(q){
      const key=q.map(v=>Math.round(v*1e8)).join(',');
      if(!index.has(key)){
        index.set(key,vertices.length);
        vertices.push(p.basisAxes.reduce((v,a,i)=>add(v,mul(a,q[i]*p.radii[i])),p.basisOrigin));
      }
      return index.get(key);
    }
    for(const polygon of polygons){
      const ids=polygon.map(vertex).filter((id,i,all)=>id!==all[(i+1)%all.length]);
      if(ids.length>=3)faces.push(ids);
    }
    const mesh={vertices,faces};if(!faces.length||!E.audit(mesh).valid)throw Error('切角盒无法形成闭合实体。');
    return planarQuads(mesh);
  }
  function fitChamfers(local,half,basis,center,padding){
    const stride=Math.max(1,Math.ceil(local.length/(3*700))),directions=[];
    for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1]){
      if(Math.abs(x)+Math.abs(y)+Math.abs(z)>=2)directions.push(unit([x,y,z]));
    }
    function support(n,every){
      const a=n[0]/half[0],b=n[1]/half[1],c=n[2]/half[2];let max=-Infinity;
      for(let i=0;i<local.length;i+=3*every)max=Math.max(max,a*local[i]+b*local[i+1]+c*local[i+2]);
      return max+padding*3*Math.hypot(a,b,c);
    }
    const planes=directions.map(n=>[...n,support(n,stride)]);
    const cuts=[];let faces=boxFaces(),volume=8;
    while(cuts.length<7){
      let best=null;
      for(const plane of planes){
        const candidate=clip(faces,plane),v=volumeOf(candidate);
        if(volume-v>.075&&(!best||v<best.v))best={plane,v};
      }
      if(!best)break;
      planes.splice(planes.indexOf(best.plane),1);
      const n=best.plane.slice(0,3),cut=[...n,support(n,1)],actual=clip(faces,cut),v=volumeOf(actual);
      if(volume-v>.065){faces=actual;volume=v;cuts.push(cut);}
    }
    return {p:{type:'chamferBox',basisOrigin:center,basisAxes:basis,center:[0,0,0],radii:half,cuts},score:volume*half[0]*half[1]*half[2]*(1.05+.006*cuts.length)};
  }

  // 同一截面方向可以同时有向上和向下的支撑面，避免头顶、腕口或鞋跟被拉成整高的直壁。
  function sectionEnvelope(local,half,basis,center,padding,maxCuts){
    let planes=[];
    const cuts=[];
    for(let j=0;j<16;j++){
      const theta=Math.PI*j/8,nx=Math.cos(theta),ny=Math.sin(theta);
      for(const slope of [-3,-1.4,-.65,-.27,0,.27,.65,1.4,3]){
        if(slope===0&&j%4===0)continue;
        const n=unit([nx,ny,slope]),[a,b,c]=n.map((v,k)=>v/half[k]);
        let h=-Infinity;
        for(let i=0;i<local.length;i+=3)h=Math.max(h,a*local[i]+b*local[i+1]+c*local[i+2]);
        planes.push([...n,h+3*padding*Math.hypot(a,b,c)]);
      }
    }
    let faces=boxFaces(),volume=8;
    while(cuts.length<maxCuts){
      let best=-1,nextFaces,nextVolume=volume;
      // 被前序切面完全排除的角不会重新出现，后续无需重复裁剪。
      planes=planes.filter(plane=>faces.some(face=>face.some(q=>dot(q,plane)>plane[3]+1e-6)));
      for(let j=0;j<planes.length;j++){
        const trial=clip(faces,planes[j]),v=volumeOf(trial);
        if(v<nextVolume){best=j;nextVolume=v;nextFaces=trial;}
      }
      if(best<0||volume-nextVolume<.004)break;
      cuts.push(planes.splice(best,1)[0]);faces=nextFaces;volume=nextVolume;
    }
    const p={type:'sectionBody',basisOrigin:center,basisAxes:basis,center:[0,0,0],radii:half,cuts};
    return {p,score:volume*half[0]*half[1]*half[2]*(1.015+.002*cuts.length)};
  }

  function enclosingPart(points,initial,buildOne,padding,choose,region){
    const basis=initial.enclosureAxes||initial.basisAxes,origin=points[0];
    const local=new Float64Array(points.length*3),lo=[Infinity,Infinity,Infinity],hi=lo.map(()=>-Infinity);
    for(let i=0;i<points.length;i++){
      const d=sub(points[i],origin);
      for(let j=0;j<3;j++){
        const x=dot(d,basis[j]);local[3*i+j]=x;lo[j]=Math.min(lo[j],x);hi[j]=Math.max(hi[j],x);
      }
    }
    const mid=mul(add(lo,hi),.5),half=hi.map((h,j)=>(h-lo[j])*.5+padding*3);
    const center=add(origin,basis.reduce((p,a,j)=>add(p,mul(a,mid[j])),[0,0,0]));
    for(let i=0;i<local.length;i++)local[i]-=mid[i%3];
    // 先用稀疏点筛选，再用该区全部原始顶点约束入围体，控制百万面输入的拟合耗时。
    const trunk=['chest','waist','pelvis'].includes(region);
    if(trunk||initial.type==='sectionBody')return sectionEnvelope(local,half,basis,center,padding,18).p;
    if(region?.startsWith('front-pouch')){
      // 沿袋体局部轴保留前平面；附加切面仅在原件实际让出空间的位置生效。
      return sectionEnvelope(local,half,basis,center,padding,10).p;
    }
    let candidates=[];
    function candidate(type,axis=2,ratio=1,power=4){
      const order=[(axis+1)%3,(axis+2)%3,axis],radii=order.map(k=>half[k]);
      const p={type,basisOrigin:center,basisAxes:order.map(k=>basis[k]),center:[0,0,0],radii};
      if(type==='roundedBox')p.exponent=power;
      if(type==='sphere')p.radii=Array(3).fill(Math.max(...radii));
      if(type==='frustum'){p.topRatio=ratio;p.radii[0]/=Math.max(1,ratio);p.radii[1]/=Math.max(1,ratio);}
      const mesh=buildOne(p),volume=Math.abs(E.audit(mesh).volume);
      const planes=planesOf(mesh,center).map(([a,b,c,h])=>{
        const n=[a,b,c];return [...basis.map(axis=>dot(n,axis)),h-padding*2];
      });
      return {p,planes,volume,axis,round:type==='frustum'||type==='cylinder'};
    }
    function solve(item,stride){
      let uniform=1,radial=1;const k=item.axis;
      for(const plane of item.planes){
        const [a,b,c,h]=plane;if(h<=0)return {score:Infinity};
        for(let i=0;i<local.length;i+=3*stride){
          const d=a*local[i]+b*local[i+1]+c*local[i+2];
          uniform=Math.max(uniform,d/h);
          if(item.round){
            const axial=plane[k]*local[i+k],rest=d-axial;
            if(h>axial)radial=Math.max(radial,rest/(h-axial));
            else if(rest>1e-14)radial=Infinity;
          }
        }
      }
      const radialOnly=item.round&&radial**2<uniform**3;
      const factors=radialOnly?[radial,radial,1]:[uniform,uniform,uniform];
      const p={...item.p,radii:item.p.radii.map((r,i)=>r*factors[i])};
      return {p,score:item.volume*factors[0]*factors[1]*factors[2]};
    }
    if(choose){
      candidates=['box','ellipsoid','roundedBox'].map(type=>candidate(type));
      if(Math.max(...half)/Math.min(...half)<1.07)candidates.unshift(candidate('sphere'));
      for(let axis=0;axis<3;axis++)for(const ratio of [1,.65,1/.65])candidates.push(candidate(ratio===1?'cylinder':'frustum',axis,ratio));
     }else if(initial.type==='chamferBox')return fitChamfers(local,half,basis,center,padding).p;
    else if(initial.type==='profilePrism')return fitPrism(local,half,basis,center,2,initial.topRatio,padding,1).p;
    else candidates=[candidate(initial.type,2,initial.topRatio,initial.exponent)];
    for(const c of candidates)c.estimate=solve(c,Math.max(1,Math.ceil(points.length/640))).score;
    const shortlist=candidates.sort((a,b)=>a.estimate-b.estimate).slice(0,4);
    const finalists=shortlist.map(c=>solve(c,1));
    if(choose){
      finalists.push(fitChamfers(local,half,basis,center,padding));
      if(region)finalists.push(sectionEnvelope(local,half,basis,center,padding,16));
      const proposals=[];for(let axis=0;axis<3;axis++)for(const ratio of [.73,1,1/.73]){
        const pilot=fitPrism(local,half,basis,center,axis,ratio,padding,Math.max(1,Math.ceil(points.length/640)));
        proposals.push({axis,ratio,score:pilot.score});
      }
      for(const c of proposals.sort((a,b)=>a.score-b.score).slice(0,3))finalists.push(fitPrism(local,half,basis,center,c.axis,c.ratio,padding,1));
    }
    return finalists.sort((a,b)=>a.score-b.score)[0].p;
  }

  function enclose(source,parameters,detail,buildOne,choose=true){
    const padding=E.bounds(source).diagonal*.00012;
    const assemble=p=>build(p,detail,buildOne);
    if(!Array.isArray(parameters.blocks)||!parameters.blocks.length||parameters.blocks.length>MAX_BLOCKS)throw Error('多基本体需要 1～48 组参数。');
    const previous=parameters.blocks.map(p=>{
      if(!p||!labels[p.type]||!Array.isArray(p.basisOrigin)||p.basisOrigin.length!==3||!p.basisOrigin.every(Number.isFinite)||
        !Array.isArray(p.radii)||p.radii.length!==3||!p.radii.every(v=>Number.isFinite(v)&&v>0)||
        !Array.isArray(p.basisAxes)||p.basisAxes.length!==3||!p.basisAxes.every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)&&Math.abs(len(a)-1)<1e-5)||
        dot(cross(p.basisAxes[0],p.basisAxes[1]),p.basisAxes[2])<.99999)throw Error('体块需要有效的局部坐标架和正尺寸。');
      return buildOne(p);
    });
    let audit=coverage(source,previous,padding*.5);
    if(!audit.uncoveredTriangles&&!audit.outsideVertices){
      const mesh=assemble(parameters);mesh.primitive.coverage=audit;return mesh;
    }
    const fields=parameters.blocks.map(p=>{
      const center=p.basisOrigin,r=Math.cbrt(p.radii[0]*p.radii[1]*p.radii[2]);
      return {center,r,half:p.radii,axes:p.basisAxes,ids:new Set()};
    });
    const used=new Uint8Array(source.vertices.length);
    function owner(x,y,z){
      let best=Infinity,id=0;
      for(let j=0;j<fields.length;j++){
        const {center,half,axes,r}=fields[j],dx=x-center[0],dy=y-center[1],dz=z-center[2];
        let max=0,sum=0;
        for(let k=0;k<3;k++){
          const a=axes[k],q=Math.abs(dx*a[0]+dy*a[1]+dz*a[2])/half[k];max=Math.max(max,q);sum+=q*q;
        }
        const score=(max-1)*r+.18*Math.sqrt(sum)*r;
        if(score<best){best=score;id=j;}
      }
      return id;
    }
    const assign=parameters.locate||owner;
    for(const f of source.faces){
      let x=0,y=0,z=0;
      for(const id of f){const p=source.vertices[id];x+=p[0];y+=p[1];z+=p[2];}
      const field=fields[assign(x/f.length,y/f.length,z/f.length)];
      for(const id of f){field.ids.add(id);used[id]=1;}
    }
    source.vertices.forEach((p,i)=>{if(!used[i])fields[assign(...p)].ids.add(i);});
    const blocks=[],regions=[];
    for(let i=0;i<fields.length;i++)if(fields[i].ids.size){
      if(parameters.regions)regions.push(parameters.regions[i]);
      const points=Array.from(fields[i].ids,id=>source.vertices[id]);
      blocks.push(enclosingPart(points,parameters.blocks[i],buildOne,padding,choose,parameters.regions?.[i]));
    }
    const final={...parameters,blocks};
    if(parameters.regions)final.regions=regions;
    const mesh=assemble(final);
    audit=coverage(source,blocks.map(buildOne),padding*.5);
    if(audit.outsideVertices||audit.uncoveredTriangles)throw Error('中远档存在未包住的原始面，已停止输出。');
    mesh.primitive.coverage=audit;return mesh;
  }

  function surfaceParameters(source,ctx) {
    const {data}=E.topology(source);
    return fitRegion(data.map((_,i)=>i),source,data,ctx.f.axes,ctx.s).p;
  }
  return {blockLimit,build,fit,surfaceParameters,enclose,prism,chamferBox};
}
if(typeof module!=='undefined')module.exports=createContourPrimitiveAssembly;
