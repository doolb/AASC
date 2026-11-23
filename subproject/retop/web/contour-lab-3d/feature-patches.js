// 预算尺度下的连通主块面：只拟合源面分区，不修改原模型或读取参考低模。
function createContourFeaturePatches(E){
  'use strict';
  const {add,sub,mul,dot,len,unit,dist}=E;
  class Queue{
    constructor(){this.items=[];}
    less(a,b){return Math.abs(a.cost-b.cost)>1e-12?a.cost<b.cost:a.face!==b.face?a.face<b.face:a.region<b.region;}
    push(item){const a=this.items;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(!this.less(a[i],a[p]))break;[a[i],a[p]]=[a[p],a[i]];i=p;}}
    pop(){const a=this.items,out=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&this.less(a[j+1],a[j]))j++;if(!this.less(a[j],a[i]))break;[a[i],a[j]]=[a[j],a[i]];i=j;}}return out;}
  }
  function planeNormal(matrix,preferred){
    const a=matrix.map(r=>r.slice()),vectors=[[1,0,0],[0,1,0],[0,0,1]],trace=a[0][0]+a[1][1]+a[2][2];
    for(let round=0;round<24;round++){
      let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q]))[p,q]=[i,j];
      if(Math.abs(a[p][q])<Math.max(trace,1e-30)*1e-12)break;
      const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle),pp=a[p][p],qq=a[q][q],pq=a[p][q];
      for(let i=0;i<3;i++)if(i!==p&&i!==q){const ip=a[i][p],iq=a[i][q];a[i][p]=a[p][i]=c*ip-s*iq;a[i][q]=a[q][i]=s*ip+c*iq;}
      a[p][p]=c*c*pp-2*c*s*pq+s*s*qq;a[q][q]=s*s*pp+2*c*s*pq+c*c*qq;a[p][q]=a[q][p]=0;
      for(let i=0;i<3;i++){const ip=vectors[i][p],iq=vectors[i][q];vectors[i][p]=c*ip-s*iq;vectors[i][q]=s*ip+c*iq;}
    }
    const minimum=Math.min(a[0][0],a[1][1],a[2][2]);let normal=[0,0,0];
    for(let i=0;i<3;i++)if(a[i][i]<=minimum+Math.max(trace,1e-30)*1e-9){const v=vectors.map(row=>row[i]);normal=add(normal,mul(v,dot(v,preferred)));}
    if(len(normal)<1e-8){const i=[0,1,2].sort((i,j)=>a[i][i]-a[j][j])[0];normal=vectors.map(row=>row[i]);}
    normal=unit(normal);return dot(normal,preferred)<0?mul(normal,-1):normal;
  }
  function build(source,{triangleBudget=1000,patchCount=null,iterations=8}={},progress=()=>{}){
    if(!Number.isInteger(triangleBudget)||triangleBudget<48||triangleBudget>65536)throw Error('结构块面的预算须为48～65536个三角面。');
    if(!Number.isInteger(iterations)||iterations<1||iterations>40)throw Error('块面拟合迭代次数无效。');
    const signature=E.fingerprint(source),t=E.topology(source),data=t.data,F=source.faces.length,scale=E.bounds(source).diagonal,totalArea=data.reduce((sum,f)=>sum+f.area,0);
    if(!F||!scale||!totalArea||data.some(f=>!Number.isFinite(f.area)||f.area<=0))throw Error('结构分区需要有效的非退化源网格。');
    const maximum=Math.min(F,patchCount??Math.max(8,Math.min(2048,Math.round(triangleBudget/8))));
    if(!Number.isInteger(maximum)||maximum<1)throw Error('主块面数量无效。');
    const adjacent=source.faces.map(()=>[]),seen=new Uint8Array(F),components=[];
    for(const edge of t.edges.values())if(edge.faces.length===2){const [a,b]=edge.faces;adjacent[a].push(b);adjacent[b].push(a);}
    for(let i=0;i<F;i++)if(!seen[i]){const faces=[i];seen[i]=1;for(let j=0;j<faces.length;j++)for(const k of adjacent[faces[j]])if(!seen[k]){seen[k]=1;faces.push(k);}components.push(faces);}
    if(components.length>maximum)throw Error('结构块面数量少于源模型壳体数。');
    const spacing=Math.sqrt(totalArea/Math.max(maximum,6)),seedOf=faces=>faces.reduce((best,i)=>data[i].area>data[best].area+totalArea*1e-12?i:best,faces[0]);
    // 源面的二阶矩让宽平面上的小幅起伏按几何幅度计价，避免仅因导数大而保留细碎纹理。
    const moments=source.faces.map((face,i)=>{
      const matrix=Array.from({length:3},()=>[0,0,0]);
      for(const v of face){const d=sub(source.vertices[v],data[i].center);for(let a=0;a<3;a++)for(let b=0;b<3;b++)matrix[a][b]+=d[a]*d[b]/12;}
      return matrix;
    });
    let proxies=components.map(faces=>{const seed=seedOf(faces);return {seed,normal:data[seed].normal,center:data[seed].center};});
    let labels=new Int32Array(F),passes=0,fixedOwners=new Int32Array(F).fill(-1);
    const loss=(face,p)=>{
      const f=data[face],cosine=dot(f.normal,p.normal),angle=.004*Math.max(0,1-cosine)+.05*Math.max(0,-cosine)**2,offset=dot(sub(f.center,p.center),p.normal);
      const variance=p.normal.reduce((sum,x,a)=>sum+x*p.normal.reduce((v,y,b)=>v+moments[face][a][b]*y,0),0);
      return f.area/totalArea*(angle+(offset*offset+Math.max(0,variance))/(spacing*spacing));
    };
    function partition(){
      const queue=new Queue();labels.fill(-1);
      for(let i=0;i<F;i++)if(fixedOwners[i]>=0)labels[i]=fixedOwners[i];
      for(let i=0;i<F;i++)if(fixedOwners[i]>=0)for(const j of adjacent[i])if(labels[j]<0)queue.push({face:j,region:fixedOwners[i],cost:loss(j,proxies[fixedOwners[i]])});
      proxies.forEach((p,region)=>{if(labels[p.seed]<0)queue.push({face:p.seed,region,cost:-1});});
      while(queue.items.length){const item=queue.pop(),{face,region}=item;if(labels[face]>=0)continue;labels[face]=region;
        for(const j of adjacent[face])if(labels[j]<0)queue.push({face:j,region,cost:loss(j,proxies[region])});
      }
      if(labels.some(g=>g<0))throw Error('主块面分区遗漏源面。');
    }
    function refit(){
      const patches=proxies.map((p,id)=>({id,seed:p.seed,fixedPlane:p.fixedPlane||null,faces:[],area:0,normal:[0,0,0],center:[0,0,0],error:0,normalError:0}));
      for(let i=0;i<F;i++){
        const p=patches[labels[i]],f=data[i];p.faces.push(i);p.area+=f.area;p.normal=add(p.normal,mul(f.normal,f.area));p.center=add(p.center,mul(f.center,f.area));
      }
      for(const p of patches){
        if(!p.faces.length)throw Error('主块面种子发生冲突。');
        const preferred=len(p.normal)>p.area*1e-10?unit(p.normal):proxies[p.id].normal;p.center=mul(p.center,1/p.area);
        const covariance=Array.from({length:3},()=>[0,0,0]);
        for(const i of p.faces){const d=sub(data[i].center,p.center),w=data[i].area;for(let a=0;a<3;a++)for(let b=0;b<3;b++)covariance[a][b]+=w*(moments[i][a][b]+d[a]*d[b]);}
        p.normal=p.fixedPlane?p.fixedPlane.normal:planeNormal(covariance,preferred);if(p.fixedPlane)p.center=p.fixedPlane.center;
        let best=Infinity;
        if(!p.fixedPlane)for(const i of p.faces){const value=loss(i,p)/(data[i].area/totalArea)+.005*(dist(data[i].center,p.center)/spacing)**2;if(value<best-1e-10){best=value;p.seed=i;}}
        for(const i of p.faces){p.error+=loss(i,p)*totalArea;p.normalError+=data[i].area*2*Math.max(0,1-dot(data[i].normal,p.normal));}
      }
      proxies=patches;return patches;
    }
    function relax(rounds){for(let i=0;i<rounds;i++){partition();refit();passes++;}}
    relax(2);
    while(proxies.length<maximum){
      const current=proxies.length,wanted=Math.min(maximum-current,current),totalError=proxies.reduce((sum,p)=>sum+p.error,0);
      if(totalError<totalArea*1e-9)break;
      const additions=[],existing=new Set(proxies.map(p=>p.seed)),ranked=proxies.slice().sort((a,b)=>{const delta=(b.error-a.error)/totalArea;return Math.abs(delta)>1e-12?delta:a.id-b.id;});
      for(const p of ranked){
        const count=Math.min(p.faces.length-1,Math.max(0,Math.round(wanted*p.error/totalError))),chosen=[];
        for(let j=0;j<count&&additions.length<wanted;j++){
          let best=-1,score=-1;
          for(const face of p.faces){if(existing.has(face))continue;
            let separation=1;for(const previous of chosen)separation=Math.min(separation,(dist(data[face].center,data[previous].center)/(spacing*.5))**2);
            const value=loss(face,p)*separation;
            if(value>score+1e-12){score=value;best=face;}
          }
          if(best<0||score<1e-12)break;chosen.push(best);existing.add(best);additions.push(best);
        }
      }
      if(additions.length<wanted){
        const candidates=Array.from({length:F},(_,i)=>i).filter(i=>!existing.has(i)).sort((a,b)=>{const delta=loss(b,proxies[labels[b]])-loss(a,proxies[labels[a]]);return Math.abs(delta)>1e-12?delta:a-b;});
        for(const face of candidates){if(additions.length>=wanted||loss(face,proxies[labels[face]])<1e-12)break;additions.push(face);existing.add(face);}
      }
      if(!additions.length)break;
      for(const seed of additions)proxies.push({seed,normal:data[seed].normal,center:data[seed].center});
      progress('主块面拟合 '+proxies.length+' / '+maximum);relax(3);
    }
    relax(iterations);
    function stablePlanes(){
      const meshStep=Math.sqrt(totalArea/triangleBudget),epsilon=meshStep*.35,minimumArea=totalArea/triangleBudget*1.5,origin=mul(data.reduce((sum,f)=>add(sum,mul(f.center,f.area)),[0,0,0]),1/totalArea);
      const directions=[],pool=[...proxies.slice().sort((a,b)=>b.area-a.area||a.id-b.id).map(p=>p.normal),...data.map((f,i)=>({i,area:f.area})).sort((a,b)=>b.area-a.area||a.i-b.i).slice(0,128).map(f=>data[f.i].normal)];
      for(const n of pool)if(directions.every(v=>dot(v,n)<Math.cos(8*Math.PI/180)))directions.push(n);
      const candidates=[];
      for(const normal of directions){
        const bins=new Map(),offsets=new Float64Array(F),aligned=new Uint8Array(F);
        for(let i=0;i<F;i++)if(dot(data[i].normal,normal)>.6){const d=dot(sub(data[i].center,origin),normal),bin=Math.floor(d/epsilon);offsets[i]=d;aligned[i]=1;
          if(!bins.has(bin))bins.set(bin,{area:0,moment:0});const item=bins.get(bin);item.area+=data[i].area;item.moment+=data[i].area*d;
        }
        const ranked=[...bins].map(([bin])=>{let area=0,moment=0;for(let j=bin-1;j<=bin+1;j++){const item=bins.get(j);if(item){area+=item.area;moment+=item.moment;}}return {bin,area,offset:moment/(area||1)};}).sort((a,b)=>Math.abs(a.area-b.area)>totalArea*1e-12?b.area-a.area:a.bin-b.bin),peaks=[];
        for(const peak of ranked){if(peaks.some(p=>Math.abs(p.bin-peak.bin)<3))continue;peaks.push(peak);if(peaks.length===5)break;}
        for(const peak of peaks){
          const eligible=new Uint8Array(F),visited=new Uint8Array(F);
          for(let i=0;i<F;i++)if(aligned[i]&&Math.abs(offsets[i]-peak.offset)<epsilon*1.2)eligible[i]=1;
          for(let i=0;i<F;i++)if(eligible[i]&&!visited[i]){
            const faces=[i];visited[i]=1;let area=0,center=[0,0,0];
            for(let j=0;j<faces.length;j++){const f=faces[j];area+=data[f].area;center=add(center,mul(data[f].center,data[f].area));for(const k of adjacent[f])if(eligible[k]&&!visited[k]){visited[k]=1;faces.push(k);}}
            if(area<minimumArea)continue;center=mul(center,1/area);const covariance=Array.from({length:3},()=>[0,0,0]);
            for(const f of faces){const d=sub(data[f].center,center);for(let a=0;a<3;a++)for(let b=0;b<3;b++)covariance[a][b]+=data[f].area*(moments[f][a][b]+d[a]*d[b]);}
            const n=planeNormal(covariance,normal),variance=n.reduce((sum,x,a)=>sum+x*n.reduce((v,y,b)=>v+covariance[a][b]*y,0),0)/area,rms=Math.sqrt(Math.max(0,variance));
            if(dot(n,normal)<.9||rms>epsilon*.7)continue;
            candidates.push({faces,area,normal:n,center,rms,score:area/(1+4*(rms/epsilon)**2)});
          }
        }
      }
      candidates.sort((a,b)=>Math.abs(a.score-b.score)>totalArea*1e-12?b.score-a.score:a.faces[0]-b.faces[0]);
      const planes=[],owned=new Uint8Array(F),maximumPlanes=Math.max(1,Math.floor(maximum*.5));
      for(const candidate of candidates){
        const remaining=candidate.faces.filter(i=>!owned[i]),area=remaining.reduce((sum,i)=>sum+data[i].area,0);
        if(area<minimumArea||area<candidate.area*.75)continue;
        const available=new Set(remaining),visited=new Set();
        for(const start of remaining)if(!visited.has(start)){
          const faces=[start];visited.add(start);for(let j=0;j<faces.length;j++)for(const k of adjacent[faces[j]])if(available.has(k)&&!visited.has(k)){visited.add(k);faces.push(k);}
          const size=faces.reduce((sum,i)=>sum+data[i].area,0);if(size<minimumArea||planes.length>=maximumPlanes)continue;
          faces.forEach(i=>owned[i]=1);planes.push({...candidate,faces,area:size});
        }
        if(planes.length>=maximumPlanes)break;
      }
      return planes;
    }
    const protectedPlanes=stablePlanes();
    if(protectedPlanes.length){
      const next=protectedPlanes.map(p=>({seed:p.faces[0],normal:p.normal,center:p.center,fixedPlane:{normal:p.normal,center:p.center,supportFaces:p.faces.length}}));
      protectedPlanes.forEach((p,g)=>p.faces.forEach(i=>fixedOwners[i]=g));
      const existing=new Set(next.map(p=>p.seed)),minimumArea=totalArea/triangleBudget*.75;
      for(const p of proxies.slice().sort((a,b)=>b.error-a.error||a.id-b.id)){
        if(next.length>=maximum)break;const faces=p.faces.filter(i=>fixedOwners[i]<0);
        if(!faces.length||faces.reduce((sum,i)=>sum+data[i].area,0)<minimumArea)continue;
        const seed=faces.includes(p.seed)?p.seed:seedOf(faces);if(existing.has(seed))continue;existing.add(seed);next.push({seed,normal:p.normal,center:p.center});
      }
      for(const component of components)if(!component.some(i=>fixedOwners[i]>=0||existing.has(i))){const seed=seedOf(component);next.push({seed,normal:data[seed].normal,center:data[seed].center});existing.add(seed);}
      proxies=next;progress('保护主平面 '+protectedPlanes.length+' 个，拟合其余曲面');relax(iterations);
    }
    // 小区域按预算的空间尺度合并；共面区域合并只发生在真实相邻面之间。
    let merges=0;
    for(let round=0;round<4;round++){
      const parent=Int32Array.from({length:proxies.length},(_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},pairs=new Map();
      for(const edge of t.edges.values())if(edge.faces.length===2){let a=labels[edge.faces[0]],b=labels[edge.faces[1]];if(a===b)continue;if(a>b)[a,b]=[b,a];const k=a+':'+b;if(!pairs.has(k))pairs.set(k,[a,b]);}
      const small=totalArea/triangleBudget*.75,candidates=[];
      for(const [a,b]of pairs.values()){
        const A=proxies[a],B=proxies[b],cosine=dot(A.normal,B.normal),offset=Math.max(Math.abs(dot(sub(A.center,B.center),A.normal)),Math.abs(dot(sub(A.center,B.center),B.normal)));
        if(A.fixedPlane&&B.fixedPlane)continue;
        const coplanar=cosine>.999&&offset<scale*.0015;
        if(coplanar||Math.min(A.area,B.area)<small)candidates.push({a,b,coplanar,cost:1-cosine+offset/spacing});
      }
      let changed=0;
      for(const c of candidates.sort((a,b)=>Math.abs(a.cost-b.cost)>1e-10?a.cost-b.cost:a.a-b.a||a.b-b.b)){
        const a=find(c.a),b=find(c.b);if(a===b||a!==c.a||b!==c.b)continue;
        const keep=proxies[a].fixedPlane?a:proxies[b].fixedPlane?b:proxies[a].area>=proxies[b].area?a:b,drop=keep===a?b:a;parent[drop]=keep;changed++;
      }
      if(!changed)break;merges+=changed;
      const ids=new Map(),next=[];
      for(let i=0;i<F;i++){const root=find(labels[i]);if(!ids.has(root)){ids.set(root,next.length);next.push(proxies[root]);}labels[i]=ids.get(root);}
      proxies=next;refit();
    }
    // 每个区域记录平面误差，供后续区分平整块面和曲面预算。
    for(const p of proxies){
      p.rms=Math.sqrt(p.faces.reduce((sum,i)=>sum+data[i].area*dot(sub(data[i].center,p.center),p.normal)**2,0)/p.area);
      p.planarity=p.rms/Math.sqrt(p.area);
    }
    if(E.fingerprint(source)!==signature)throw Error('主块面提取意外改变源模型。');
    return {version:1,sourceFingerprint:signature,scale,patchGroups:Array.from(labels),patches:proxies,
      report:{method:'protected stable source planes and connected variational curved regions',requestedPatches:maximum,patches:proxies.length,protectedPlanes:proxies.filter(p=>p.fixedPlane).length,passes,mergedRegions:merges,normalError:proxies.reduce((sum,p)=>sum+p.normalError,0)/totalArea,planeError:proxies.reduce((sum,p)=>sum+p.error,0)/totalArea,triangleBudget,sourceUnmodified:true}};
  }
  return {build};
}
if(typeof module!=='undefined')module.exports=createContourFeaturePatches;
if(typeof window!=='undefined')window.createContourFeaturePatches=createContourFeaturePatches;
