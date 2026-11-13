// Region-restricted high-surface fitting. Saved offsets replay without source queries.
function createContourSurfaceFit(E){
  'use strict';
  const {add,sub,mul,dot,unit,dist,cross}=E;
  function smoothTarget(source,proposal,selected,strength=0){
    if(!Number.isFinite(strength)||strength<0||strength>1)throw Error('高模细节过滤须为0～100%。');
    const mesh={...source,vertices:source.vertices.map(p=>p.slice())},D=E.bounds(source).diagonal,t=E.topology(source),groups=new Set(selected),fixed=new Set(),neighbors=source.vertices.map(()=>new Map()),active=[];
    for(let v=0;v<t.incident.length;v++)if(!t.incident[v].length||!t.incident[v].every(fi=>groups.has(proposal.patchGroups[fi])&&proposal.patchGroups[fi]===proposal.patchGroups[t.incident[v][0]]))fixed.add(v);
    for(const e of t.edges.values()){if(e.faces.length!==2){fixed.add(e.a);fixed.add(e.b);}const weight=1;neighbors[e.a].set(e.b,weight);neighbors[e.b].set(e.a,weight);}
    for(let v=0;v<source.vertices.length;v++)if(!fixed.has(v))active.push(v);
    const step=(points,factor)=>{const next=points.slice();for(const v of active){let average=[0,0,0],total=0;for(const [w,weight]of neighbors[v]){average=add(average,mul(points[w],weight));total+=weight;}if(total)next[v]=add(points[v],mul(sub(mul(average,1/total),points[v]),factor));}return next;},rounds=Math.round(strength*180),changedFaces=source.faces.map((f,i)=>f.some(v=>!fixed.has(v))?i:-1).filter(i=>i>=0);let accepted=0,backoffs=0;
    for(let i=0;i<rounds&&active.length;i++){const before=mesh.vertices,prior=changedFaces.map(fi=>E.faceData(mesh,source.faces[fi]).normal);let advanced=false;for(const fraction of [1,.5,.25,.125,.0625]){mesh.vertices=step(step(before,.5*fraction),-.5*fraction);if(changedFaces.every((fi,j)=>{const d=E.faceData(mesh,source.faces[fi]);return d.area>t.data[fi].area*1e-6&&dot(d.normal,prior[j])>.05;})){accepted++;advanced=true;break;}backoffs++;mesh.vertices=before;}if(!advanced)break;}
    let moved=0,maximum=0;for(const v of active){const d=dist(mesh.vertices[v],source.vertices[v]);if(d>D*1e-12)moved++;maximum=Math.max(maximum,d);}
    return {mesh,report:{strength,iterations:accepted,requestedIterations:rounds,selectedPatches:[...groups],verticesMoved:moved,pinnedVertices:fixed.size,maximumDisplacementRelative:maximum/D,safetyBackoffs:backoffs,sourceChanged:false,method:'same-region Taubin target filtering; fixed region boundaries and open borders; face orientation safeguards'}};
  }
  function closest(p,a,b,c){const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,mul(ab,d1/(d1-d3)));const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,mul(ac,d2/(d2-d6)));const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,mul(sub(c,b),(d4-d3)/(d4-d3+d5-d6)));const inv=1/(va+vb+vc);return add(a,add(mul(ab,vb*inv),mul(ac,vc*inv)));}
  function quality(mesh,f){const ps=f.map(i=>mesh.vertices[i]),n=E.faceData(mesh,f).normal;let corner=1;for(let j=0;j<4;j++)corner=Math.min(corner,dot(unit(cross(sub(ps[(j+1)%4],ps[j]),sub(ps[(j+3)%4],ps[j]))),n));return {corner,diagonal:dot(unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),unit(cross(sub(ps[2],ps[0]),sub(ps[3],ps[0]))))};}
  function valid(m,reference=null,faceIds=null){const D=E.bounds(m).diagonal;return (faceIds||m.faces.map((_,i)=>i)).every(i=>{const f=m.faces[i],q=quality(m,f),before=reference?quality(reference,reference.faces[i]):{corner:.015,diagonal:.05};return f.every((v,j)=>dist(m.vertices[v],m.vertices[f[(j+1)%4]])>D*1e-7)&&q.corner>1e-7&&q.diagonal>.005&&q.corner>=Math.min(.015,before.corner)-1e-10&&q.diagonal>=Math.min(.05,before.diagonal)-1e-10;});}
  function apply(base,definition){
    if(!definition||definition.version!==1||definition.mode!=='structural-region-face'||!Array.isArray(definition.offsets))throw Error('高模面形参数格式不正确。');
    if(definition.baseFingerprint!==E.fingerprint(base))throw Error('高模面形约束与当前CSI基础不一致，请重新拟合。');
    const m=structuredClone(base),fixed=new Set((m.csiEdges||[]).filter(e=>!e.virtual).flatMap(e=>e.vertices)),seen=new Set(),owners=new Map((m.csiCharts||[]).map(c=>[c.patch,new Set(c.grid.flat())]));
    for(const c of definition.offsets){if(!c||!Number.isInteger(c.vertex)||!m.vertices[c.vertex]||!owners.get(c.patch)?.has(c.vertex)||fixed.has(c.vertex)||seen.has(c.vertex)||!Array.isArray(c.delta)||c.delta.length!==3||!c.delta.every(Number.isFinite))throw Error('高模面形参数包含无效分区、顶点或共享边顶点。');seen.add(c.vertex);m.vertices[c.vertex]=add(base.vertices[c.vertex],c.delta);}
    if(!valid(m,base))throw Error('高模面形参数产生无效四边面。');m.csiReport.surfaceFitting=definition.report;return m;
  }
  function tree(triangles){
    const box=xs=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const t of xs)for(const p of t.points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return {lo,hi};},build=xs=>{const b=box(xs);if(xs.length<=10)return {...b,triangles:xs};const axis=[0,1,2].sort((a,c)=>(b.hi[c]-b.lo[c])-(b.hi[a]-b.lo[a]))[0];xs.sort((a,b)=>a.points.reduce((s,p)=>s+p[axis],0)-b.points.reduce((s,p)=>s+p[axis],0));const mid=xs.length>>1;return {...b,left:build(xs.slice(0,mid)),right:build(xs.slice(mid))};};return triangles.length?build(triangles):null;
  }
  function query(root,p,normal,counter){
    const boxDistance=b=>b.lo.reduce((s,x,k)=>s+Math.max(x-p[k],0,p[k]-b.hi[k])**2,0);let best=null;const visit=b=>{if(!b||best&&boxDistance(b)>best.distance**2)return;if(b.triangles){for(const t of b.triangles){if(dot(t.normal,normal)<.05)continue;counter.count++;const q=closest(p,...t.points),d=dist(p,q);if(!best||d<best.distance)best={point:q,normal:t.normal,distance:d};}return;}const a=boxDistance(b.left),c=boxDistance(b.right);if(a<c){visit(b.left);visit(b.right);}else{visit(b.right);visit(b.left);}};visit(root);return best;
  }
  function solve(rows,count,anchor){
    const b=new Float64Array(count),diagonal=new Float64Array(count).fill(anchor);
    for(const row of rows)for(const [i,c]of row.terms){b[i]+=c*row.target;diagonal[i]+=c*c;}
    const apply=x=>{const out=Float64Array.from(x,v=>v*anchor);for(const row of rows){const q=row.terms.reduce((s,[i,c])=>s+c*x[i],0);for(const [i,c]of row.terms)out[i]+=c*q;}return out;},x=new Float64Array(count),r=b.slice(),z=Float64Array.from(r,(v,i)=>v/diagonal[i]);let p=z.slice(),rz=r.reduce((s,v,i)=>s+v*z[i],0),start=Math.sqrt(b.reduce((s,v)=>s+v*v,0));
    for(let k=0;k<Math.min(500,count*3)&&Math.sqrt(r.reduce((s,v)=>s+v*v,0))>Math.max(1e-10,start*1e-7);k++){const a=apply(p),den=p.reduce((s,v,i)=>s+v*a[i],0);if(den<=0)break;const step=rz/den;for(let i=0;i<count;i++){x[i]+=step*p[i];r[i]-=step*a[i];z[i]=r[i]/diagonal[i];}const next=r.reduce((s,v,i)=>s+v*z[i],0),beta=next/rz;for(let i=0;i<count;i++)p[i]=z[i]+beta*p[i];rz=next;}return x;
  }
  function fit(source,base,proposal,{smoothing=0,flowWeight=20,fitBroad=true}={}){
    if(!Number.isFinite(flowWeight)||flowWeight<0||flowWeight>100)throw Error('布线连续性权重须为0～100。');
    const baseTopology=E.topology(base),signature=E.fingerprint(source),D=E.bounds(source).diagonal,t=E.topology(source),tr=E.triangulate(source),byPatch=new Map(),fixed=new Set((base.csiEdges||[]).filter(e=>!e.virtual).flatMap(e=>e.vertices)),patches=(base.csiCharts||[]).filter(c=>fitBroad&&!c.rim||c.annular),selected=new Set(patches.map(c=>c.patch)),counter={count:0},charts=[];
    const target=smoothTarget(source,proposal,(base.csiCharts||[]).filter(c=>!c.rim).map(c=>c.patch),smoothing),targetTopology=smoothing?E.topology(target.mesh):t;
    tr.faces.forEach((f,i)=>{const fi=tr.source[i],patch=proposal.patchGroups[fi];if(!selected.has(patch))return;if(!byPatch.has(patch))byPatch.set(patch,[]);byPatch.get(patch).push({points:f.map(v=>target.mesh.vertices[v]),normal:targetTopology.data[fi].normal});});
    for(const c of patches){const free=[...new Set(c.grid.flat())].filter(id=>!fixed.has(id)),index=new Map(free.map((v,i)=>[v,i])),faces=base.faces.filter((_,i)=>base.csiPatchGroups[i]===c.patch),edges=new Set(),bends=[];for(const f of faces)f.forEach((a,j)=>{const b=f[(j+1)%4];if(index.has(a)&&index.has(b))edges.add(E.key(a,b));});for(let v=0;v<=c.V;v++)for(let u=0;u<=c.U;u++){if(!index.has(c.grid[v][u]))continue;if(u>0&&u<c.U)bends.push([[c.grid[v][u],1],[c.grid[v][u-1],-.5],[c.grid[v][u+1],-.5]]);if(v>0&&v<c.V)bends.push([[c.grid[v][u],1],[c.grid[v-1][u],-.5],[c.grid[v+1][u],-.5]]);}charts.push({patch:c.patch,annular:!!c.annular,free,index,faces,edges,bends,tree:tree(byPatch.get(c.patch)||[])});}
    const weights=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[1/3,1/3,1/3,0],[1/3,0,1/3,1/3],[.5,.5,0,0],[0,.5,.5,0],[0,0,.5,.5],[.5,0,0,.5],[.5,0,.5,0]],samples=[];
    for(const chart of charts)for(const f of chart.faces){const area=E.faceData(base,f).area/weights.length;for(const w of weights)samples.push({chart,f,w,area});}
    // Penalize row/column bending in the tangent plane, not the normal curvature
    // needed to follow the surface. Span weights preserve adaptive spacing.
    // Coupled solves keep neighboring lanes coherent; true CSI vertices stay fixed.
    const pointTotal=cs=>cs.reduce((s,c)=>s+c.area*c.q.distance**2,0),flowRows=(mesh,chart)=>{if(chart.annular||!flowWeight)return [];const t=E.topology(mesh);return chart.bends.map(b=>{const id=b[0][0],n=unit(t.incident[id].reduce((s,fi)=>add(s,mul(t.data[fi].normal,t.data[fi].area)),[0,0,0])),a=dist(mesh.vertices[id],mesh.vertices[b[1][0]]),c=dist(mesh.vertices[id],mesh.vertices[b[2][0]]);return {terms:[[id,-1],[b[1][0],c/(a+c)],[b[2][0],a/(a+c)]],normal:n};});},flowTotal=(mesh,rows)=>rows.reduce((sum,r)=>{const d=r.terms.reduce((p,[id,c])=>add(p,mul(mesh.vertices[id],c)),[0,0,0]),q=sub(d,mul(r.normal,dot(d,r.normal)));return sum+dot(q,q);},0),cost=(mesh,chart,cs,rows)=>pointTotal(cs)/chart.area+flowWeight*flowTotal(mesh,rows)/(chart.flow.length||1);
    for(const chart of charts)chart.area=chart.faces.reduce((s,f)=>s+E.faceData(base,f).area,0);
    const constraints=(mesh,subset=samples)=>subset.flatMap(s=>{const p=s.f.reduce((a,id,i)=>add(a,mul(mesh.vertices[id],s.w[i])),[0,0,0]),n=E.faceData(mesh,s.f).normal,q=query(s.chart.tree,p,n,counter);return q?[{...s,p,q}]:[];}),score=cs=>cs.reduce((s,c)=>s+c.area*c.q.distance**2,0)/(cs.reduce((s,c)=>s+c.area,0)||1),mean=cs=>cs.reduce((s,c)=>s+c.area*c.q.distance,0)/(cs.reduce((s,c)=>s+c.area,0)||1);
    let current=structuredClone(base),cs=constraints(current),initial=score(cs),initialMean=mean(cs),iterations=0;const steps=[];
    for(;iterations<6;iterations++){
      const changes=new Map();for(const chart of charts)chart.flow=flowRows(current,chart);
      for(const chart of charts){const rows=[],local=cs.filter(c=>c.chart===chart),area=chart.faces.reduce((s,f)=>s+E.faceData(base,f).area,0)/(chart.free.length||1);
        for(const c of local){const terms=[];c.f.forEach((id,j)=>{if(chart.index.has(id))for(let k=0;k<3;k++)terms.push([chart.index.get(id)*3+k,c.w[j]*c.q.normal[k]*Math.sqrt(c.area)]);});if(terms.length){rows.push({terms,target:dot(sub(c.q.point,c.p),c.q.normal)*Math.sqrt(c.area)});for(let axis=0;axis<3;axis++){const ts=[];c.f.forEach((id,j)=>{if(chart.index.has(id))ts.push([chart.index.get(id)*3+axis,c.w[j]*Math.sqrt(c.area*.1)]);});rows.push({terms:ts,target:(c.q.point[axis]-c.p[axis])*Math.sqrt(c.area*.1)});}}}
        for(const edge of chart.edges){const [a,b]=edge.split(':').map(Number);for(let k=0;k<3;k++)rows.push({terms:[[chart.index.get(a)*3+k,Math.sqrt(area*.015)],[chart.index.get(b)*3+k,-Math.sqrt(area*.015)]],target:0});}
        for(const bend of chart.bends)for(let k=0;k<3;k++){const weight=Math.sqrt(area*(chart.annular?0:.15));if(!weight)continue;rows.push({terms:bend.filter(([id])=>chart.index.has(id)).map(([id,w])=>[chart.index.get(id)*3+k,w*weight]),target:-bend.reduce((s,[id,w])=>s+w*current.vertices[id][k],0)*weight});}
        for(const flow of chart.flow)for(let axis=0;axis<3;axis++){const direction=[0,1,2].map(k=>(k===axis?1:0)-flow.normal[k]*flow.normal[axis]),weight=Math.sqrt(area*flowWeight*.5),terms=[];for(const [id,c]of flow.terms)if(chart.index.has(id))for(let k=0;k<3;k++)terms.push([chart.index.get(id)*3+k,c*direction[k]*weight]);const lap=flow.terms.reduce((p,[id,c])=>add(p,mul(current.vertices[id],c)),[0,0,0]);rows.push({terms,target:-dot(lap,direction)*weight});}
        const x=solve(rows,chart.free.length*3,area*.005);chart.free.forEach((id,i)=>changes.set(id,Array.from(x.slice(i*3,i*3+3))));
      }
      let changed=false;
      for(const chart of charts){const localRows=cs.filter(c=>c.chart===chart),localScore=cost(current,chart,localRows,chart.flow),pointLimit=Math.max(pointTotal(localRows)/chart.area*1.05,(D*.0015)**2),largest=Math.max(0,...chart.free.map(id=>E.len(changes.get(id)))),clip=largest>D*.04?D*.04/largest:1;let best=null;
        for(const fraction of [1,.5,.25,.125,.0625]){const m=structuredClone(current);for(const id of chart.free)m.vertices[id]=add(current.vertices[id],mul(changes.get(id),fraction*clip));if(!valid(m,base))continue;const next=constraints(m),local=next.filter(c=>c.chart===chart),value=cost(m,chart,local,chart.flow);if(pointTotal(local)/chart.area<=pointLimit&&next.length===cs.length&&value<localScore*.999&&(!best||value<best.score))best={mesh:m,constraints:next,score:value,fraction:fraction*clip};}
        if(best){current=best.mesh;cs=best.constraints;steps.push({round:iterations,patch:chart.patch,fraction:best.fraction,score:score(cs),localScore:best.score});changed=true;}
        else{
          let moved=0,chartPointTotal=pointTotal(cs.filter(c=>c.chart===chart));const order=iterations%2?chart.free.slice().reverse():chart.free;
          for(const id of order){const localSamples=samples.filter(s=>s.chart===chart&&s.f.includes(id)&&s.w[s.f.indexOf(id)]>0),oldRows=constraints(current,localSamples),localFlows=chart.flow.filter(r=>r.terms.some(([v])=>v===id)),oldPointTotal=pointTotal(oldRows),oldScore=cost(current,chart,oldRows,localFlows),p=current.vertices[id],d=changes.get(id),length=E.len(d),bound=length>D*.025?D*.025/length:1;let point=null,value=oldScore,nextPointTotal=oldPointTotal;
            for(const fraction of [1,.5,.25,.125,.0625]){current.vertices[id]=add(p,mul(d,bound*fraction));if(!valid(current,base,baseTopology.incident[id]))continue;const rows=constraints(current,localSamples),total=pointTotal(rows),q=cost(current,chart,rows,localFlows);if((chartPointTotal+total-oldPointTotal)/chart.area<=pointLimit&&rows.length===oldRows.length&&q<value*.999){point=current.vertices[id];value=q;nextPointTotal=total;}}
            current.vertices[id]=point||p;if(point){moved++;chartPointTotal+=nextPointTotal-oldPointTotal;}
          }
          if(moved){cs=constraints(current);steps.push({round:iterations,patch:chart.patch,coordinateMoves:moved,score:score(cs)});changed=true;}
        }
      }
      if(!changed)break;
    }
    const offsets=charts.flatMap(c=>c.free.map(vertex=>({vertex,patch:c.patch,delta:sub(current.vertices[vertex],base.vertices[vertex])}))),report={mode:'structural-region-face',regions:[...selected],vertices:offsets.length,iterations,acceptedUpdates:steps.length,sampleCount:samples.length,matchedSamples:cs.length,meanSurfaceDistanceBefore:initialMean,meanSurfaceDistanceAfter:mean(cs),squaredDistanceBefore:initial,squaredDistanceAfter:score(cs),sourceTriangleQueries:counter.count,sourceUsedDuringFitting:true,sharedCSIBoundariesChanged:false,sourceFingerprint:signature,steps,method:'region-restricted original face constraints at quad vertices, edge midpoints and triangle interiors; regularized point-to-plane solve; fixed real CSI; saved offsets'},definition={version:1,mode:report.mode,baseFingerprint:E.fingerprint(base),sourceFingerprint:signature,offsets,report};
    const laneStatistics=mesh=>charts.filter(c=>!c.annular).map(chart=>{const rows=flowRows(mesh,chart);let total=0;for(const r of rows){const p=mesh.vertices[r.terms[0][0]],a=mesh.vertices[r.terms[1][0]],b=mesh.vertices[r.terms[2][0]],d=sub(unit(sub(b,p)),unit(sub(p,a))),q=sub(d,mul(r.normal,dot(d,r.normal)));total+=dot(q,q);}return {patch:chart.patch,samples:rows.length,tangentialTurnRMS:Math.sqrt(total/(rows.length||1))};});
    report.broadSurfaceFitted=fitBroad;report.detailSmoothing=target.report;report.flowRegularization={weight:flowWeight,method:'coupled row and column tangential bending; fixed shared CSI; normal curvature free',surfaceRMSAllowanceRelative:.0015,before:laneStatistics(base),after:laneStatistics(current)};
    if(E.fingerprint(source)!==signature)throw Error('高模面形拟合修改了原模型。');return {definition,mesh:apply(base,definition),report,target:target.mesh};
  }
  return {fit,apply,valid,smoothTarget};
}
if(typeof module!=='undefined')module.exports=createContourSurfaceFit;
if(typeof window!=='undefined')window.createContourSurfaceFit=createContourSurfaceFit;
