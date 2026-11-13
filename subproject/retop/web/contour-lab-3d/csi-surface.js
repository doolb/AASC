/* CSI curves, incidence and optional boundary frames -> shared quad surfaces.
 * Source coordinates and guide definitions are read-only. No model-specific axes.
 */
function createContourCSISurface(E){
  'use strict';
  const {add,sub,mul,dist,key}=E,lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
  const cubic=(c,t)=>{const s=1-t;return add(add(mul(c.p0,s*s*s),mul(c.p1,3*s*s*t)),add(mul(c.p2,3*s*t*t),mul(c.p3,t*t*t)));};
function untangle(mesh,progress){const m=structuredClone(mesh),D=E.bounds(m).diagonal,epsilon=D**3*1e-12;
 function ray(p,q,a,b,c){const d=E.sub(q,p),e1=E.sub(b,a),e2=E.sub(c,a),h=E.cross(d,e2),det=E.dot(e1,h);if(Math.abs(det)<epsilon)return false;const inv=1/det,s=E.sub(p,a),u=inv*E.dot(s,h);if(u<-1e-7||u>1+1e-7)return false;const v=inv*E.dot(d,E.cross(s,e1));if(v<-1e-7||u+v>1+1e-7)return false;const t=inv*E.dot(e2,E.cross(s,e1));return t>1e-7&&t<1-1e-7;}
 const tris=f=>[[f[0],f[1],f[2]],[f[0],f[2],f[3]]].map(f=>({f,p:f.map(i=>m.vertices[i]),lo:[0,1,2].map(k=>Math.min(...f.map(i=>m.vertices[i][k]))),hi:[0,1,2].map(k=>Math.max(...f.map(i=>m.vertices[i][k])))}));
 function intersect(a,b){return !a.f.some(v=>b.f.includes(v))&&!a.lo.some((v,k)=>v>b.hi[k]+D*1e-8||b.lo[k]>a.hi[k]+D*1e-8)&&(a.p.some((p,k)=>ray(p,a.p[(k+1)%3],...b.p))||b.p.some((p,k)=>ray(p,b.p[(k+1)%3],...a.p)));}
 const valid=f=>{const p=f.map(i=>m.vertices[i]),n=E.faceData(m,f).normal,a=E.cross(E.sub(p[1],p[0]),E.sub(p[2],p[0])),b=E.cross(E.sub(p[2],p[0]),E.sub(p[3],p[0]));if(E.len(a)<D*D*2e-12||E.len(b)<D*D*2e-12||p.some((v,j)=>E.dist(v,p[(j+1)%4])<D*1e-7))return false;return p.every((v,j)=>E.dot(E.unit(E.cross(E.sub(p[(j+1)%4],v),E.sub(p[(j+2)%4],p[(j+1)%4]))),n)>.005)&&E.dot(E.unit(E.cross(E.sub(p[1],p[0]),E.sub(p[2],p[0]))),E.unit(E.cross(E.sub(p[2],p[0]),E.sub(p[3],p[0]))))>.005;};
 const fixed=new Set([...m.csiEdges.flatMap(e=>e.vertices),...(m.csiReport.centeredRimVertices||[])]);let moved=0;let flips=0,initial=0;let remaining=0;for(let pass=0;pass<100;pass++){const ts=m.faces.map(tris),bad=new Set(),pairs=[],box=triangles=>({lo:[0,1,2].map(k=>Math.min(...triangles.map(t=>t.lo[k]))),hi:[0,1,2].map(k=>Math.max(...triangles.map(t=>t.hi[k])))}),boxes=ts.map(box),ordered=boxes.map((_,i)=>i).sort((a,b)=>boxes[a].lo[0]-boxes[b].lo[0]),query=triangles=>{const b=box(triangles),hits=[];for(const i of ordered){const a=boxes[i];if(a.lo[0]>b.hi[0]+D*1e-8)break;if(!a.lo.some((v,k)=>v>b.hi[k]+D*1e-8||b.lo[k]>a.hi[k]+D*1e-8))hits.push(i);}return hits.sort((a,b)=>a-b);};for(let i=0;i<ts.length;i++)for(const j of query(ts[i]))if(j>i&&ts[i].some(a=>ts[j].some(b=>intersect(a,b)))){pairs.push([i,j]);bad.add(i);bad.add(j);}pairs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);remaining=pairs.length;if(pass===0)initial=pairs.length;if(!pairs.length)break;const t=E.topology(m);let best=null;
  for(const [k,e]of t.edges){if(m.csiReport?.structured||e.faces.length!==2||!e.faces.some(fi=>bad.has(fi)))continue;const [a,b]=e.faces;if(m.csiPatchGroups[a]!==m.csiPatchGroups[b])continue;const next=new Map();for(const fi of [a,b])m.faces[fi].forEach((v,i)=>{const w=m.faces[fi][(i+1)%4];if(E.key(v,w)!==k)next.set(v,w);});if(next.size!==6)continue;const ring=[next.keys().next().value];while(ring.length<6)ring.push(next.get(ring.at(-1)));if(new Set(ring).size!==6)continue;const old=pairs.filter(p=>p.includes(a)||p.includes(b)).length;
   for(let start=0;start<3;start++){const p=Array.from({length:6},(_,i)=>ring[(i+start)%6]);if(E.key(p[0],p[3])===k||t.edges.has(E.key(p[0],p[3])))continue;const fa=p.slice(0,4),fb=[p[3],p[4],p[5],p[0]];if(!valid(fa)||!valid(fb))continue;const ats=tris(fa),bts=tris(fb);let count=0;for(const i of query([...ats,...bts]))if(i!==a&&i!==b){if(ats.some(a=>ts[i].some(b=>intersect(a,b))))count++;if(bts.some(a=>ts[i].some(b=>intersect(a,b))))count++;}const gain=old-count;if(gain>0&&(!best||gain>best.gain))best={a,b,fa,fb,gain};}
  }
  if(!best){let move=null;const ids=[...new Set([...bad].flatMap(fi=>m.faces[fi]))].filter(id=>!fixed.has(id));for(const id of ids){const incident=t.incident[id],set=new Set(incident),old=pairs.filter(p=>p.some(fi=>set.has(fi))).length,p=m.vertices[id],ns=[...new Set(incident.flatMap(fi=>m.faces[fi]).filter(v=>v!==id))],mean=E.mul(ns.reduce((s,j)=>E.add(s,m.vertices[j]),[0,0,0]),1/ns.length),targets=[mean,...ns.map(j=>E.mul(E.add(p,m.vertices[j]),.5))],normal=E.unit(incident.reduce((sum,fi)=>E.add(sum,E.faceData(m,m.faces[fi]).normal),[0,0,0]));for(const d of [-.01,-.005,-.002,.002,.005,.01])targets.push(E.add(p,E.mul(normal,D*d)));for(const target of targets)for(const f of [1,.5,.25,.125]){m.vertices[id]=E.add(p,E.mul(E.sub(target,p),f));if(incident.every(fi=>valid(m.faces[fi]))){const candidates=incident.map(fi=>tris(m.faces[fi]));let count=0;for(const j of query(candidates.flat()))if(!set.has(j))for(const c of candidates)if(c.some(a=>ts[j].some(b=>intersect(a,b))))count++;for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)if(candidates[i].some(a=>candidates[j].some(b=>intersect(a,b))))count++;const gain=old-count;if(gain>0&&(!move||gain>move.gain))move={id,p:m.vertices[id],gain};}m.vertices[id]=p;}}if(move){m.vertices[move.id]=move.p;moved++;progress('低模：调整内部点 · 剩余 '+Math.max(0,pairs.length-move.gain));continue;}throw Error('CSI低模仍有'+pairs.length+'处穿插，保留旧结果；请先细化CSI。');}m.faces[best.a]=best.fa;m.faces[best.b]=best.fb;flips++;progress('低模：修复内部连接穿插 · 剩余 '+Math.max(0,pairs.length-best.gain));
 }
 if(remaining)throw Error('CSI穿插修复达到计算预算，保留旧结果。');m.csiReport.intersectionAudit={initialFacePairs:initial,remainingNonadjacentTrianglePairs:0,edgeRotations:flips,vertexMoves:moved,method:m.csiReport.structured?'proper nonadjacent triangle intersections; structured connectivity locked; interior-only moves; coplanar and shared-vertex contacts excluded':'proper nonadjacent triangle intersections; convex local rotations and interior-only moves; coplanar and shared-vertex contacts excluded'};return m;}
  function harmonic(adjacency,fixed,weights){
    const free=[...adjacency.keys()].filter(v=>!fixed.has(v)),indices=new Map(free.map((v,i)=>[v,i])),n=free.length,neighbors=free.map(v=>[...adjacency.get(v)]),diagonal=neighbors.map((ns,i)=>ns.reduce((sum,v)=>sum+(weights?.get(key(free[i],v))??1),0)),values=new Map(fixed);let maximumResidual=0,iterations=0;
    function apply(x){return Float64Array.from(neighbors,(ns,i)=>diagonal[i]*x[i]-ns.reduce((s,v)=>s+(indices.has(v)?x[indices.get(v)]*(weights?.get(key(free[i],v))??1):0),0));}
    for(let axis=0;axis<(fixed.values().next().value?.length||2);axis++){
      const b=Float64Array.from(neighbors,(ns,i)=>ns.reduce((s,v)=>s+(fixed.get(v)?.[axis]||0)*(weights?.get(key(free[i],v))??1),0)),x=new Float64Array(n),r=b.slice(),z=Float64Array.from(r,(v,i)=>v/diagonal[i]);let p=z.slice(),rz=r.reduce((s,v,i)=>s+v*z[i],0),iteration=0;
      while(rz>1e-24&&iteration<Math.max(32,Math.min(3000,n*2))){const ap=apply(p),den=p.reduce((s,v,i)=>s+v*ap[i],0);if(den<=0)break;const alpha=rz/den;for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/diagonal[i];}const next=r.reduce((s,v,i)=>s+v*z[i],0),beta=next/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=next;iteration++;}
      const ax=apply(x),residual=ax.reduce((s,v,i)=>Math.max(s,Math.abs(v-b[i])),0);maximumResidual=Math.max(maximumResidual,residual);iterations=Math.max(iterations,iteration);if(residual>1e-7)throw Error('CSI补片参数化未收敛，保留旧结果。');free.forEach((v,i)=>{if(!values.has(v))values.set(v,Array(fixed.values().next().value.length).fill(0));values.get(v)[axis]=x[i];});
    }
    return {values,maximumResidual,iterations};
  }
  // The integer solver decides counts; this second step distributes those
  // samples WITHIN an edge. Curvature is measured in 3D CSI arc length, never
  // from the high mesh or a camera. A baseline density protects straight parts.
  function edgeParameters(edge){
    const N=Math.min(1024,Math.max(128,edge.divisions*8)),points=Array.from({length:N+1},(_,i)=>edge.sample(i/N).point),turn=new Float64Array(N+1);
    for(let i=1;i<N;i++){
      const s=i/N,radius=.08,a=E.unit(sub(points[i],points[i-1])),b=E.unit(sub(points[i+1],points[i])),
        angle=Math.atan2(E.len(E.cross(a,b)),E.dot(a,b));
      // acos(dot) amplifies floating noise near straight tangents; a tiny
      // spurious turn then grows again under the density square root.
      turn[i]=(angle>1e-8?angle:0)
        +.75*((edge.startTurn||0)*Math.exp(-s/radius)+(edge.endTurn||0)*Math.exp(-(1-s)/radius))/(N*radius);
    }
    const total=turn.reduce((s,v)=>s+v,0);
    if(total<1e-3)return Array.from({length:edge.divisions+1},(_,i)=>i/edge.divisions);
    turn[0]=turn[1];turn[N]=turn[N-1];
    const mean=total/(N-1),weight=Array.from(turn,(_,i)=>{
      let sum=0,count=0;for(let j=Math.max(0,i-2);j<=Math.min(N,i+2);j++){const w=3-Math.abs(i-j);sum+=turn[j]*w;count+=w;}
      return 1+2*Math.sqrt(Math.min(9,sum/(count*mean)));
    }),cdf=[0];for(let i=1;i<=N;i++)cdf.push(cdf.at(-1)+(weight[i-1]+weight[i])*.5/N);
    const adaptive=Array.from({length:edge.divisions+1},(_,i)=>{
      if(!i)return 0;if(i===edge.divisions)return 1;const target=i/edge.divisions*cdf[N];let a=0,b=N;
      while(b-a>1){const j=(a+b)>>1;if(cdf[j]<target)a=j;else b=j;}
      return (a+(target-cdf[a])/(cdf[b]-cdf[a]))/N;
    });
    // Retain part of the uniform arc distribution to limit displacement/skew
    // between opposite rails whose curvature peaks do not coincide.
    return adaptive.map((t,i)=>.65*t+.35*i/edge.divisions);
  }
  // A rim remains one width family through its end patches. A tiny logical
  // corner is a required knot, not a 50% width sample. Plan a separate, shared
  // midpoint lane and retain all corner knots on their original CSI curves.
  function rimWidthFamilies(plans){
    const axes=plans.map(p=>{const a=(p.lengths[0]+p.lengths[2])/2,b=(p.lengths[1]+p.lengths[3])/2;return a<b*.12?0:b<a*.12?1:null;}),marked=new Set();
    const mark=(p,axis)=>{for(const side of [axis,axis+2])for(const s of p.sides[side])marked.add(s.edge);};
    plans.forEach((p,i)=>{if(axes[i]!==null)mark(p,axes[i]);});
    for(let pass=0;pass<plans.length;pass++){let changed=false;plans.forEach((p,i)=>{if(axes[i]!==null)return;const matches=[0,1,2,3].filter(k=>p.sides[k].every(s=>marked.has(s.edge)));if(!matches.length||matches.some(k=>k%2!==matches[0]%2))return;axes[i]=matches[0]%2;mark(p,axes[i]);changed=true;});if(!changed)break;}
    return axes;
  }
  function midpointSlot(sides,countFor=e=>e.divisions){
    const total=sides.reduce((sum,s)=>sum+s.edge.length,0),T=sides.reduce((sum,s)=>sum+countFor(s.edge),0),target=total/2;let used=0,count=0;
    for(const side of sides){const e=side.edge,n=countFor(e);
      if(target<=used+e.length+total*1e-8){const t=E.clamp((target-used)/e.length,0,1),index=T/2-count;return {side,t,index,valid:T%2===0&&((t<1e-8&&index===0)||(t>1-1e-8&&index===n)||(t>1e-8&&t<1-1e-8&&index>0&&index<n))};}
      used+=e.length;count+=n;
    }throw Error('CSI包边中点定位失败。');
  }
  function centerWidthSamples(patches){
    const anchors=new Map(),report=[];
    for(const patch of patches){const axis=patch.widthFamilyAxis;if(axis===null)continue;for(const k of [axis,axis+2]){
      const sides=patch.plan.sides[k],slot=midpointSlot(sides);if(!slot.valid)throw Error('CSI包边需要独立中点采样，请提高面数预算。');const {edge,forward}=slot.side,index=forward?slot.index:edge.divisions-slot.index,t=forward?slot.t:1-slot.t;
      if(!anchors.has(edge))anchors.set(edge,new Map([[0,0],[edge.divisions,1]]));const pins=anchors.get(edge);
      if(pins.has(index)){if(Math.abs(pins.get(index)-t)>1e-8)throw Error('CSI共享包边中点约束冲突。');continue;}pins.set(index,t);
      report.push({patch:patch.id,side:k,edge:edge.id,index,parameter:t,widthFraction:.5});
    }}
    // Apply all pins on an edge together so a second chart cannot move a
    // midpoint already fixed by its neighbor. Keep the density within spans.
    for(const [edge,pins]of anchors){const sorted=[...pins].sort((a,b)=>a[0]-b[0]),q=edge.parameters.slice();
      for(let j=1;j<sorted.length;j++){const [a,ta]=sorted[j-1],[b,tb]=sorted[j];if(!(tb>ta))throw Error('CSI包边中点顺序冲突。');for(let i=a;i<=b;i++)edge.parameters[i]=ta+(q[i]-q[a])/(q[b]-q[a])*(tb-ta);edge.parameters[a]=ta;edge.parameters[b]=tb;}
    }return report;
  }
  function pairedRimLandmarks(chart){
    const lengths=[(chart.lengths[0]+chart.lengths[2])/2,(chart.lengths[1]+chart.lengths[3])/2],axis=chart.annular?1:lengths[0]<lengths[1]*.12?0:lengths[1]<lengths[0]*.12?1:null;if(axis===null)return [];
    const reverse=ss=>ss.slice().reverse().map(s=>({...s,forward:!s.forward})),A=axis===0?reverse(chart.sides[3]):chart.sides[0],B=axis===0?chart.sides[1]:reverse(chart.sides[2]);
    function landmarks(sides){const out=[],total=sides.reduce((s,r)=>s+r.edge.length,0);let used=0;for(let i=0;i<sides.length-1;i++){
      const r=sides[i],next=sides[i+1];used+=r.edge.length;
      // Separate logical edges within one interface denote an explicit CSI
      // corner. Closed-loop support parts of the SAME logical edge do not.
      if(!chart.annular&&(r.edge.interfaceId!==next.edge.interfaceId||r.edge.logicalEdge===next.edge.logicalEdge))continue;
      out.push({node:r.forward?r.edge.ids.at(-1):r.edge.ids[0],point:r.edge.sample(r.forward?1:0).point,progress:used/total,prefix:sides.slice(0,i+1).map(s=>s.edge)});
    }return out;}
    const a=landmarks(A),b=landmarks(B),nearest=(p,xs)=>xs.reduce((best,q)=>!best||dist(p.point,q.point)<dist(p.point,best.point)?q:best,null),width=Math.max(chart.lengths[axis===0?0:1],chart.lengths[axis===0?2:3],chart.annular?Math.max(...chart.lengths)*.05:0);
    return a.flatMap(p=>{const q=nearest(p,b);return q&&nearest(q,a)===p&&dist(p.point,q.point)<width*2&&Math.abs(p.progress-q.progress)<.2?[{a:p,b:q}]:[];});
  }
  // Match the two CSI rails of a narrow chart before creating any mesh points.
  // Independent arc-density samples can have the same ordinal but represent
  // different cross-sections. Move only their arc parameters, retaining all
  // logical corners, source endpoints, sample order and shared-edge identity.
  function alignRimSamples(edges,patches,scale,square=false,guard=false){
    const pairs=[],rims=[];
    function refs(sides){const out=[];for(const side of sides)for(let j=0;j<=side.edge.divisions;j++){
      if(out.length&&!j)continue;out.push({edge:side.edge,i:side.forward?j:side.edge.divisions-j,sign:side.forward?1:-1});
    }return out;}
    const point=r=>r.edge.sample(r.edge.parameters[r.i]).point,
      free=r=>r.i>0&&r.i<r.edge.divisions,
      shift=r=>(r.edge.parameters[r.i]-r.edge.initialParameters[r.i])*r.edge.length*r.sign,
      tangent=r=>{const t=r.edge.parameters[r.i],h=1e-4;return mul(E.unit(sub(r.edge.sample(Math.min(1,t+h)).point,r.edge.sample(Math.max(0,t-h)).point)),r.sign);};
    for(const e of edges)e.initialParameters=e.parameters.slice();
    for(const patch of patches){const c=patch.plan,s=[(c.lengths[0]+c.lengths[2])/2,(c.lengths[1]+c.lengths[3])/2],axis=c.annular?1:s[0]<s[1]*.12?0:s[1]<s[0]*.12?1:null;if(axis===null)continue;
      const A=axis===0?refs(c.sides[3]).reverse():refs(c.sides[0]),B=axis===0?refs(c.sides[1]):refs(c.sides[2]).reverse();
      if(A.length!==B.length)throw Error('CSI包边两侧的横截面数量不匹配。');
      // Reversing a chart side must also reverse its oriented tangent.
      for(const r of axis===0?A:B)r.sign*=-1;
      const rim={id:patch.id,A,B,annular:!!c.annular};rims.push(rim);
      for(let i=1;i<A.length-1;i++)pairs.push({a:A[i],b:B[i]});
    }
    function metrics(rim){const angles=[];for(let i=1;i<rim.A.length-1;i++){
      const t=E.unit(add(E.unit(sub(point(rim.A[i+1]),point(rim.A[i-1]))),E.unit(sub(point(rim.B[i+1]),point(rim.B[i-1]))))),across=E.unit(sub(point(rim.B[i]),point(rim.A[i])));
      angles.push(Math.asin(E.clamp(Math.abs(E.dot(t,across)),0,1))*180/Math.PI);
    }return {meanSkewDegrees:angles.reduce((s,v)=>s+v,0)/(angles.length||1),maxSkewDegrees:Math.max(0,...angles)};}
    const originalParameters=new Map(edges.map(e=>[e,e.parameters.slice()])),before=rims.map(metrics),prior=.02;let iterations=0,moves=0;
    function energy(a,b){const d=sub(point(b),point(a)),sa=shift(a),sb=shift(b),station=free(a)&&free(b)?2:0;return E.dot(d,d)+station*(sa+sb)**2+prior*(sa*sa+sb*sb);}
    function candidate(r,ds){if(!free(r))return r.edge.parameters[r.i];const e=r.edge,i=r.i,initial=e.initialParameters,
      lo=e.parameters[i-1]+Math.max(.25*(initial[i]-initial[i-1]),square?.3/e.divisions:0),hi=e.parameters[i+1]-Math.max(.25*(initial[i+1]-initial[i]),square?.3/e.divisions:0);
      return E.clamp(e.parameters[i]+ds*r.sign/e.length,lo,hi);
    }
    function relax(){for(let sweep=0;sweep<64;sweep++){let largest=0;iterations++;
      for(const {a,b}of pairs){const fa=free(a),fb=free(b);if(!fa&&!fb)continue;
        const d=sub(point(b),point(a)),ta=tangent(a),tb=tangent(b),sa=shift(a),sb=shift(b),station=fa&&fb?2:0,
          aa=1+station+prior,bb=aa,ab=-E.dot(ta,tb)+station,
          ga=-E.dot(ta,d)+station*(sa+sb)+prior*sa,gb=E.dot(tb,d)+station*(sa+sb)+prior*sb,det=aa*bb-ab*ab,
          da=fa?(fb?(-ga*bb+gb*ab)/det:-ga/aa):0,db=fb?(fa?(-gb*aa+ga*ab)/det:-gb/bb):0,
          oldA=a.edge.parameters[a.i],oldB=b.edge.parameters[b.i],old=energy(a,b);
        for(const fraction of [1,.5,.25,.125]){
          const pa=candidate(a,da*fraction),pb=candidate(b,db*fraction);a.edge.parameters[a.i]=pa;b.edge.parameters[b.i]=pb;
          if(energy(a,b)<old-scale*scale*1e-12){largest=Math.max(largest,Math.abs(pa-oldA)*a.edge.length,Math.abs(pb-oldB)*b.edge.length);moves++;break;}
          a.edge.parameters[a.i]=oldA;b.edge.parameters[b.i]=oldB;
        }
      }
      if(largest<scale*1e-7)break;
    }}
    relax();
    // The two rails now share cross-sections. Re-space them jointly using the
    // stronger of their original curvature/corner density demands, with every
    // logical landmark fixed. Both sides use the SAME common station fraction.
    function demand(edge,t){const q=edge.initialParameters;let lo=0,hi=q.length-1;while(hi-lo>1){const j=(lo+hi)>>1;if(q[j]<t)lo=j;else hi=j;}return 1/(edge.divisions*(q[hi]-q[lo]));}
    const cornerTurn=r=>r.i===0?r.edge.startTurn||0:r.i===r.edge.divisions?r.edge.endTurn||0:0;
    for(const rim of rims){const {A,B}=rim,anchors=[0];for(let i=1;i<A.length-1;i++)if(!free(A[i])||!free(B[i]))anchors.push(i);anchors.push(A.length-1);
      for(let k=1;k<anchors.length;k++){const start=anchors[k-1],end=anchors[k],count=end-start;if(count<2)continue;
        function interval(rail){const r=rail[start+1],edge=r.edge,a=rail[start],b=rail[end];return {edge,t0:a.edge===edge?edge.parameters[a.i]:r.sign>0?0:1,t1:b.edge===edge?edge.parameters[b.i]:r.sign>0?1:0};}
        const a=interval(A),b=interval(B),N=Math.min(1024,Math.max(128,count*8)),wa=[],wb=[];
        for(let i=0;i<=N;i++){const t=i/N;wa.push(Math.abs(a.t1-a.t0)*demand(a.edge,a.t0+(a.t1-a.t0)*t));wb.push(Math.abs(b.t1-b.t0)*demand(b.edge,b.t0+(b.t1-b.t0)*t));}
        const integral=q=>q.reduce((sum,v,i)=>sum+v*(i===0||i===N?.5:1),0)/N,ma=integral(wa),mb=integral(wb),cdf=[0],
          pa=Array.from({length:N+1},(_,i)=>a.edge.sample(a.t0+(a.t1-a.t0)*i/N).point),pb=Array.from({length:N+1},(_,i)=>b.edge.sample(b.t0+(b.t1-b.t0)*i/N).point),bend=Array(N+1).fill(0);
        const normals=side=>Array.from({length:N+1},(_,i)=>side.edge.normalAt?.(rim.id,side.t0+(side.t1-side.t0)*i/N)||null),na=square&&rim.annular?normals(a):[],nb=square&&rim.annular?normals(b):[],normalWindow=Math.max(1,Math.ceil(N*.04));
        for(let i=1;i<N;i++){
          let demand=Math.max(E.len(sub(add(pa[i-1],pa[i+1]),mul(pa[i],2))),E.len(sub(add(pb[i-1],pb[i+1]),mul(pb[i],2))));
          // Surface turning ALONG the rails asks for more cross-sections.
          // Turning ACROSS the band is deliberately absent from this demand.
          const lo=Math.max(0,i-normalWindow),hi=Math.min(N,i+normalWindow);
          for(const [ps,ns]of [[pa,na],[pb,nb]])if(ns[lo]&&ns[hi]){
            const turn=Math.acos(E.clamp(E.dot(ns[lo],ns[hi]),-1,1)),step=(dist(ps[i-1],ps[i])+dist(ps[i],ps[i+1]))*.5;
            demand=Math.max(demand,step*turn/(hi-lo));
          }bend[i]=Math.sqrt(demand);
        }
        bend[0]=bend[1];bend[N]=bend[N-1];const meanBend=integral(bend),startTurn=Math.max(cornerTurn(A[start]),cornerTurn(B[start])),endTurn=Math.max(cornerTurn(A[end]),cornerTurn(B[end])),widths=pa.map((p,j)=>dist(p,pb[j])),meanWidth=widths.reduce((s,w)=>s+w,0)/widths.length,weights=wa.map((v,i)=>{
          const t=i/N,radius=.06,corner=(square?.5:.25)*(startTurn*Math.exp(-t/radius)+endTurn*Math.exp(-(1-t)/radius))/(Math.PI/2*radius);
          // Short cells belong at a narrow or turning section, rather than
          // adding another full row across the width of the whole band.
          if(!square)return .1+.25*Math.max(v/ma,wb[i]/mb)+.75*(meanBend>Math.sqrt(scale)*1e-6?bend[i]/meanBend:1)+corner;
          return Math.sqrt(meanWidth/Math.max(widths[i],meanWidth*.15))*(.6+.4*(meanBend>Math.sqrt(scale)*1e-6?bend[i]/meanBend:1)+corner);
        });
        for(let i=1;i<=N;i++)cdf.push(cdf.at(-1)+(weights[i-1]+weights[i])*.5/N);
        for(let j=1;j<count;j++){const target=j/count*cdf[N];let lo=0,hi=N;while(hi-lo>1){const i=(lo+hi)>>1;if(cdf[i]<target)lo=i;else hi=i;}const t=(lo+(target-cdf[lo])/(cdf[hi]-cdf[lo]))/N;
          A[start+j].edge.parameters[A[start+j].i]=a.t0+(a.t1-a.t0)*t;B[start+j].edge.parameters[B[start+j].i]=b.t0+(b.t1-b.t0)*t;
        }
      }
    }
    // Density and perpendicularity must not collapse support points next to
    // a corner into near-zero edges. Retain a physical arc-spacing floor.
    if(square)for(const e of edges)e.parameters=e.parameters.map((t,i)=>.4*i/e.divisions+.6*t);
    for(const e of edges)e.initialParameters=e.parameters.slice();
    relax();
    // A shared rail participates in more than one smooth group. Improving the
    // closed side wall must not shear a neighboring open rim into diagonal ribs.
    // Keep the original curvature-weighted CSI samples when the joint solve
    // worsens BOTH its average and its worst cross-section angle. Only sample
    // parameters change; all original CSI curves and logical corners stay fixed.
    const rejected=[];
    for(let i=0;i<rims.length;i++){const r=rims[i],after=metrics(r);if(!guard||r.annular||after.meanSkewDegrees<=before[i].meanSkewDegrees*1.05||after.maxSkewDegrees<=before[i].maxSkewDegrees+5)continue;
      rejected.push({patch:r.id,reason:'shared-rail optimization increased both average and maximum rib skew',attempted:after});for(const e of new Set([...r.A,...r.B].map(x=>x.edge)))e.parameters=originalParameters.get(e).slice();
    }
    return {method:'joint 3D CSI rail correspondence; common width-and-turn stations; monotone arc parameters; fixed logical corners; open-rim skew regression guard',iterations,moves,guardActive:guard,rejected,rims:rims.map((r,i)=>({id:r.id,before:before[i],after:metrics(r)}))};
  }
  // Minimize thin-plate bending in the CSI chart, keeping every shared boundary
  // sample fixed. Coons alone extends a side's corner/parameter-speed jump right
  // across the patch. Solving for a smooth interior localizes that disturbance.
  function fairChart(vertices,grid,U,V,lengths,{fidelityRadius=.085}={}){
    if(U<2||V<2)return {method:'fixed boundary',iterations:0,relativeResidual:0};
    const origin=vertices[grid[0][0]],normalizer=Math.sqrt(lengths[0]*lengths[1]),
      free=[],index=new Map(),rows=[];
    for(let y=1;y<V;y++)for(let x=1;x<U;x++){
      const id=grid[y][x];index.set(id,free.length);free.push(id);
    }
    // Average opposite-boundary arc coordinates. A short logical CSI edge is
    // still represented by its own segment, but no longer consumes a uniformly
    // large interval of the interior chart merely because it needs one vertex.
    function arc(ids){const a=[0];for(let i=1;i<ids.length;i++)a.push(a.at(-1)+dist(vertices[ids[i-1]],vertices[ids[i]]));return a.map(v=>v/a.at(-1));}
    const bottom=arc(grid[0]),top=arc(grid[V]),left=arc(grid.map(r=>r[0])),right=arc(grid.map(r=>r[U])),
      us=bottom.map((v,i)=>(v+top[i])*.5*lengths[0]/normalizer),
      vs=left.map((v,i)=>(v+right[i])*.5*lengths[1]/normalizer);
    function row(ids,coefficients,weight){
      const terms=ids.map((id,i)=>({id,i:index.get(id),c:coefficients[i]*Math.sqrt(weight)}));
      if(terms.some(t=>t.i!==undefined))rows.push(terms);
    }
    for(let y=0;y<=V;y++)for(let x=1;x<U;x++){
      const a=us[x]-us[x-1],b=us[x+1]-us[x],h=(a+b)/2,
        dy=y===0?(vs[1]-vs[0])/2:y===V?(vs[V]-vs[V-1])/2:(vs[y+1]-vs[y-1])/2;
      row([grid[y][x-1],grid[y][x],grid[y][x+1]],[1/(a*h),-(1/a+1/b)/h,1/(b*h)],h*dy);
    }
    for(let y=1;y<V;y++)for(let x=0;x<=U;x++){
      const a=vs[y]-vs[y-1],b=vs[y+1]-vs[y],h=(a+b)/2,
        dx=x===0?(us[1]-us[0])/2:x===U?(us[U]-us[U-1])/2:(us[x+1]-us[x-1])/2;
      row([grid[y-1][x],grid[y][x],grid[y+1][x]],[1/(a*h),-(1/a+1/b)/h,1/(b*h)],h*dx);
    }
    for(let y=0;y<V;y++)for(let x=0;x<U;x++){
      const dx=us[x+1]-us[x],dy=vs[y+1]-vs[y],k=1/(dx*dy);
      row([grid[y][x],grid[y][x+1],grid[y+1][x],grid[y+1][x+1]],[k,-k,-k,k],2*dx*dy);
    }
    // A fixed physical smoothing radius in normalized chart coordinates; the
    // positional fidelity term scales with cell area, rather than face count.
    const diagonal=new Float64Array(free.length),anchor=1/(U*V*fidelityRadius**4);
    for(const terms of rows)for(const t of terms)if(t.i!==undefined)diagonal[t.i]+=t.c*t.c;
    function apply(v){const out=Float64Array.from(v,x=>anchor*x);for(const terms of rows){let sum=0;for(const t of terms)if(t.i!==undefined)sum+=t.c*v[t.i];for(const t of terms)if(t.i!==undefined)out[t.i]+=t.c*sum;}return out;}
    let iterations=0,relativeResidual=0,energyBefore=0,energyAfter=0;
    for(let axis=0;axis<3;axis++){
      const b=new Float64Array(free.length);
      for(const terms of rows){const s=terms.reduce((sum,t)=>sum+t.c*(vertices[t.id][axis]-origin[axis])/normalizer,0);energyBefore+=s*s;for(const t of terms)if(t.i!==undefined)b[t.i]-=t.c*s;}
      const n=b.length,x=new Float64Array(n),r=b.slice(),z=Float64Array.from(r,(v,i)=>v/(diagonal[i]+anchor)),initial=Math.sqrt(b.reduce((s,v)=>s+v*v,0));
      let p=z.slice(),rz=r.reduce((s,v,i)=>s+v*z[i],0),step=0;
      while(Math.sqrt(r.reduce((s,v)=>s+v*v,0))>Math.max(1e-10,initial*1e-9)&&step<Math.min(4000,n*6+40)){
        const ap=apply(p),den=p.reduce((s,v,i)=>s+v*ap[i],0);if(!(den>0))break;
        const a=rz/den;for(let i=0;i<n;i++){x[i]+=a*p[i];r[i]-=a*ap[i];z[i]=r[i]/(diagonal[i]+anchor);}
        const next=r.reduce((s,v,i)=>s+v*z[i],0),beta=next/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=next;step++;
      }
      // Use the same mixed absolute/relative tolerance as the PCG stopping
      // rule. An almost-zero planar RHS must not fail on a large relative
      // ratio of two roundoff-sized quantities.
      const absoluteResidual=Math.sqrt(r.reduce((s,v)=>s+v*v,0)),residual=initial<1e-10?0:absoluteResidual/initial;if(absoluteResidual>Math.max(1e-10,initial*1e-6))throw Error('CSI曲面平顺求解未收敛，保留旧结果。');
      relativeResidual=Math.max(relativeResidual,residual);iterations=Math.max(iterations,step);
      free.forEach((id,i)=>{vertices[id]=vertices[id].slice();vertices[id][axis]+=x[i]*normalizer;});
      for(const terms of rows){const s=terms.reduce((sum,t)=>sum+t.c*(vertices[t.id][axis]-origin[axis])/normalizer,0);energyAfter+=s*s;}
    }
    return {method:'CSI-only thin-plate interior; arc-weighted chart; all shared boundary samples fixed',fidelityRadius,iterations,relativeResidual,energyBefore,energyAfter};
  }
  // Redistribute each smooth group's interior on its own CSI surface. Shared
  // boundary vertices stay fixed, while internal rows can slide independently.
  function optimizeProfileGrid(vertices,grid,U,V,surface,square=false){
    const cells=[];for(let y=0;y<V;y++)for(let x=0;x<U;x++)cells.push([grid[y][x],grid[y][x+1],grid[y+1][x+1],grid[y+1][x]]);
    const incident=new Map(),parameters=new Map();cells.forEach((f,i)=>f.forEach(id=>{if(!incident.has(id))incident.set(id,[]);incident.get(id).push(i);}));for(let y=0;y<=V;y++)for(let x=0;x<=U;x++)parameters.set(grid[y][x],[x/U,y/V]);
    function quality(f){const ps=f.map(i=>vertices[i]),normal=E.faceData({vertices:ps},[0,1,2,3]).normal;let skew=0,minSin=1,aspect=0;for(let i=0;i<4;i++){const a=sub(ps[(i+1)%4],ps[i]),b=sub(ps[(i+3)%4],ps[i]),la=E.len(a),lb=E.len(b),d=E.dot(a,b)/(la*lb||1);skew+=d*d/4;aspect+=Math.log(Math.max(1e-12,la)/Math.max(1e-12,lb))**2/4;minSin=Math.min(minSin,E.dot(E.cross(a,b),normal)/(la*lb||1));}const warp=1-E.dot(E.unit(E.cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),E.unit(E.cross(sub(ps[2],ps[0]),sub(ps[3],ps[0]))));return {skew,aspect,minSin,warp,energy:skew+(square?.5:.035)*aspect+2*warp*warp+100*Math.max(0,.35-minSin)**2};}
    const measure=()=>{const qs=cells.map(quality);return {meanSquaredSkew:qs.reduce((s,q)=>s+q.skew,0)/qs.length,meanSquaredLogAspect:qs.reduce((s,q)=>s+q.aspect,0)/qs.length,maxWarp:Math.max(...qs.map(q=>q.warp)),minimumCornerSine:Math.min(...qs.map(q=>q.minSin)),energy:qs.reduce((s,q)=>s+q.energy,0)};},before=measure();let moves=0,iterations=0;
    for(let round=0;round<18;round++){let changed=0;for(let yy=1;yy<V;yy++)for(let xx=1;xx<U;xx++){
      const y=round%2?V-yy:yy,x=round%2?U-xx:xx,id=grid[y][x],p=vertices[id],uv=parameters.get(id),fs=incident.get(id),oldQualities=fs.map(i=>quality(cells[i])),old=oldQualities.reduce((s,q)=>s+q.energy,0),eps=1e-5,
        lo=[(x===1?0:parameters.get(grid[y][x-1])[0])+eps,(y===1?0:parameters.get(grid[y-1][x])[1])+eps],hi=[(x===U-1?1:parameters.get(grid[y][x+1])[0])-eps,(y===V-1?1:parameters.get(grid[y+1][x])[1])-eps];let best=null;
      for(const factor of [1,.5])for(const [a,b]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const q=[E.clamp(uv[0]+a*factor*.22/U,lo[0],hi[0]),E.clamp(uv[1]+b*factor*.22/V,lo[1],hi[1])];vertices[id]=surface(...q);const qs=fs.map(i=>quality(cells[i])),energy=qs.reduce((s,q)=>s+q.energy,0);if(qs.every((q,i)=>q.minSin>=Math.min(.35,oldQualities[i].minSin)-1e-10&&q.warp<=Math.max(.15,oldQualities[i].warp)+1e-10)&&energy<old-1e-9&&(!best||energy<best.energy))best={uv:q,point:vertices[id],energy};}
      vertices[id]=best?best.point:p;if(best){parameters.set(id,best.uv);changed++;moves++;}
    }iterations++;if(!changed)break;}
    return {method:'independent interior CSI-surface parameter relaxation; fixed shared boundary; square-cell angle, length and warpage energy',iterations,moves,before,after:measure(),parameters:square?grid.map((row,y)=>row.map((id,x)=>!x||!y||x===U||y===V?[x/U,y/V]:parameters.get(id))):null};
  }
  // Interpolate the CSI-only fair surface before redistributing its interior.
  // This is a frozen parameter surface, never a projection onto the source.
  function chartSurface(vertices,grid,U,V){
    const ps=grid.map(row=>row.map(id=>vertices[id].slice())),at=(x,y)=>{
      if(y<0)return sub(mul(at(x,0),2),at(x,1));if(y>V)return sub(mul(at(x,V),2),at(x,V-1));
      if(x<0)return sub(mul(at(0,y),2),at(1,y));if(x>U)return sub(mul(at(U,y),2),at(U-1,y));return ps[y][x];
    },blend=(p,t)=>[0,1,2].map(k=>.5*(2*p[1][k]+(-p[0][k]+p[2][k])*t+(2*p[0][k]-5*p[1][k]+4*p[2][k]-p[3][k])*t*t+(-p[0][k]+3*p[1][k]-3*p[2][k]+p[3][k])*t*t*t));
    return (u,v)=>{const x=E.clamp(u,0,1)*U,y=E.clamp(v,0,1)*V,a=Math.min(U-1,Math.floor(x)),b=Math.min(V-1,Math.floor(y));return blend([-1,0,1,2].map(dy=>blend([-1,0,1,2].map(dx=>at(a+dx,b+dy)),x-a)),y-b);};
  }
  // Four-sided logical charts share integer edge counts globally. Corners are
  // chosen jointly: independently attractive charts can require a zero-width side.
  function structuredPlan(edges,patches,limit,square=false){
    const totalArea=patches.reduce((sum,p)=>sum+p.boundaryArea,0),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),sidePoint=(s,t)=>s.edge.sample(s.forward?t:1-t).point;
    const lists=patches.map(p=>{if(p.annularPlan)return [p.annularPlan];const n=p.sides.length,out=[],turns=p.sides.map((s,i)=>{const prev=p.sides[(i+n-1)%n],a=sidePoint(prev,.96),b=sidePoint(s,0),c=sidePoint(s,.04);return Math.acos(E.clamp(E.dot(E.unit(sub(b,a)),E.unit(sub(c,b))),-1,1));});
      const convex=p.sides.map((s,i)=>{const prev=p.sides[(i+n-1)%n],a=sidePoint(prev,.96),b=sidePoint(s,0),c=sidePoint(s,.04);const cross=E.cross(E.unit(sub(b,a)),E.unit(sub(c,b))),normal=s.edge.normalAt?.(p.id,s.forward?0:1);return normal?(E.dot(cross,normal)>1e-7?E.len(cross):-E.len(cross)):E.dot(cross,p.boundaryNormal);});
      for(let a=0;a<n-3;a++)for(let b=a+1;b<n-2;b++)for(let c=b+1;c<n-1;c++)for(let d=c+1;d<n;d++){const corners=[a,b,c,d];if(corners.some(i=>convex[i]<.005))continue;const sides=corners.map((j,i)=>{const end=corners[(i+1)%4],xs=[];do{xs.push(p.sides[j]);j=(j+1)%n;}while(j!==end);return xs;}),lengths=sides.map(xs=>xs.reduce((sum,s)=>sum+s.edge.length,0)),score=corners.reduce((sum,k)=>sum+(turns[k]-Math.PI/2)**2,0)+1.5*(Math.log(lengths[0]/lengths[2])**2+Math.log(lengths[1]/lengths[3])**2);out.push({corners,sides,lengths,score});}return out.sort((a,b)=>a.score-b.score).slice(0,24);});
    if(lists.some(l=>!l.length))throw Error('CSI分区需要至少四个可规划侧点；请先细化CSI补片。');
    const edgeIndex=new Map(edges.map((e,i)=>[e,i])),dimensions=(p,x)=>p.sides.slice(0,2).map(xs=>xs.reduce((sum,s)=>sum+x[edgeIndex.get(s.edge)],0)),faceCount=(plans,x)=>plans.reduce((sum,p)=>{const [u,v]=dimensions(p,x);return sum+u*v;},0);
    function basis(plans){const rows=[];for(const p of plans)for(const [a,b]of [[0,2],[1,3]]){const row=edges.map(()=>0);for(const s of p.sides[a])row[edgeIndex.get(s.edge)]++;for(const s of p.sides[b])row[edgeIndex.get(s.edge)]--;rows.push(row);}for(const p of plans)for(const match of pairedRimLandmarks(p)){const row=edges.map(()=>0);for(const e of match.a.prefix)row[edgeIndex.get(e)]++;for(const e of match.b.prefix)row[edgeIndex.get(e)]--;rows.push(row);}let rank=0;const columns=[];for(let c=0;c<edges.length;c++){const k=rows.findIndex((row,j)=>j>=rank&&Math.abs(row[c])>1e-8);if(k<0)continue;[rows[k],rows[rank]]=[rows[rank],rows[k]];const v=rows[rank][c];rows[rank]=rows[rank].map(x=>x/v);for(let j=0;j<rows.length;j++)if(j!==rank){const v=rows[j][c];rows[j]=rows[j].map((x,i)=>x-v*rows[rank][i]);}columns.push(c);rank++;}const free=edges.map((_,i)=>i).filter(i=>!columns.includes(i)),M=edges.map((_,i)=>free.map(j=>i===j?1:0));for(let r=0;r<rank;r++)M[columns[r]]=free.map(j=>-rows[r][j]);return {M,free,rows};}
    function widthCountsValid(plans,x){
      const axes=rimWidthFamilies(plans),countFor=e=>x[edgeIndex.get(e)];
      return plans.every((p,i)=>axes[i]===null||[axes[i],axes[i]+2].every(k=>midpointSlot(p.sides[k],countFor).valid));
    }
    function solve(plans){const {M,free,rows}=basis(plans);if(!free.length||M.some(row=>row.every(v=>v<=1e-9)))return null;let z=free.map(i=>Math.max(1,edges[i].length/(Math.sqrt(totalArea)*.1)));for(let round=0;round<300;round++){let gap=0;for(const row of M){const v=dot(row,z),q=dot(row,row);if(v<1){const e=1-v;gap=Math.max(gap,e);z=z.map((v,i)=>v+row[i]*e/q);}}if(gap<1e-8)break;if(round===299)return null;}
      for(const factor of [1,1.1,1.5,2,3,.5,.25,.125]){
        const zz=z.map(v=>Math.max(1,Math.round(v*factor))),candidates=[zz];
        // Midpoint lanes impose parity and a free sample beside mandatory tiny
        // corner edges. Repair the integer seed locally before changing charts.
        for(let a=0;a<free.length;a++)for(const da of [-2,-1,1,2]){const q=zz.slice();q[a]+=da;candidates.push(q);for(let b=a+1;b<free.length;b++)for(const db of [-2,-1,1,2]){const r=q.slice();r[b]+=db;candidates.push(r);}}
        for(const q of candidates){const x=M.map(row=>Math.round(dot(row,q)));if(x.every(v=>v>=1)&&rows.every(row=>Math.abs(dot(row,x))<1e-7)&&faceCount(plans,x)<=limit&&widthCountsValid(plans,x))return {x,M,free};}
      }return null;
    }
    let queue=[lists.map(()=>0)],seen=new Set(),found=null,attempts=0;for(;attempts<1000&&queue.length;attempts++){queue.sort((a,b)=>a.reduce((sum,v,i)=>sum+lists[i][v].score,0)-b.reduce((sum,v,i)=>sum+lists[i][v].score,0));const index=queue.shift(),plans=lists.map((l,i)=>l[index[i]]),solution=solve(plans);if(solution){found={plans,...solution};break;}for(let i=0;i<index.length;i++)if(index[i]+1<lists[i].length){const next=index.slice();next[i]++;const k=next.join(':');if(!seen.has(k)){seen.add(k);queue.push(next);}}}
    if(!found)throw Error('当前CSI分区不能在面数上限内协调纵横面带，请提高上限或调整分区。');
    const {plans,M,free}=found,seed=found.x,baseFaces=faceCount(plans,seed);let x=seed.slice(),steps=0;
    // Density is allocated to entire strip families, weighting actual patch
    // area, accumulated CSI turning, and cell aspect. It must not oversample long rims at the expense of
    // a broad curved face whose end boundary happens to be short.
    const importance=edges.map(e=>{const ps=Array.from({length:33},(_,i)=>e.sample(i/32).point),angle=ps.slice(1,-1).reduce((sum,p,i)=>sum+Math.acos(E.clamp(E.dot(E.unit(sub(p,ps[i])),E.unit(sub(ps[i+2],p))),-1,1)),0);return .001*e.length**2/totalArea+angle**2+(square?0:(e.surfaceTurn||0)**2);}),metrics=patches.map((p,i)=>{const A=p.boundaryArea,l=plans[i].lengths,u=(l[0]+l[2])/2,v=(l[1]+l[3])/2;return {area:A/totalArea,u:u>=v?u:Math.max(u,A/v),v:v>=u?v:Math.max(v,A/u)};}),cost=counts=>plans.reduce((sum,p,i)=>{const [u,v]=dimensions(p,counts),m=metrics[i],ratio=u*m.v/(v*m.u);return sum+m.area*m.area/(u*v)+(square?.03:.003)*m.area*(ratio+1/ratio-2);},0)+counts.reduce((sum,n,i)=>sum+.06*importance[i]/n**2,0);
    const directions=[];for(let j=0;j<free.length;j++)for(const sign of [-2,-1,1,2])directions.push(M.map(row=>sign*row[j]));for(let a=0;a<free.length;a++)for(let b=a+1;b<free.length;b++)for(const sa of [-1,1])for(const sb of [-1,1])directions.push(M.map(row=>sa*row[a]+sb*row[b]));
    for(;steps<1024;steps++){const old=cost(x);let best=null;for(const d of directions){const y=x.map((v,i)=>v+d[i]);if(y.some(v=>v<1||Math.abs(v-Math.round(v))>1e-7)||faceCount(plans,y)>limit||!widthCountsValid(plans,y))continue;const score=cost(y);if(score<old-1e-10&&(!best||score<best.score))best={x:y,score};}if(!best)break;x=best.x.map(Math.round);}
    edges.forEach((e,i)=>{e.divisions=x[i];});const widthAxes=rimWidthFamilies(plans);patches.forEach((p,i)=>{p.plan=plans[i];p.gridSize=dimensions(plans[i],x);p.widthFamilyAxis=widthAxes[i];});return {baseFaces,faces:faceCount(plans,x),stripSteps:steps,cornerPlansTried:attempts+1,pairedLandmarks:plans.flatMap((p,i)=>pairedRimLandmarks(p).map(m=>({patch:patches[i].id,nodeA:m.a.node,nodeB:m.b.node,station:m.a.prefix.reduce((sum,e)=>sum+e.divisions,0)}))),method:'joint four-side chart planning; globally constrained integer CSI edge samples; accumulated-CSI-turn weighted strip-family density allocation; shared even-width midpoint lanes retaining CSI corner knots'};
  }
  function generate(source,proposal,options={},progress=()=>{}){
    if(options.lowTriangleBudget!==undefined){if(!Number.isInteger(options.lowTriangleBudget)||options.lowTriangleBudget<48||options.lowTriangleBudget>65536)throw Error('低模上限须为48～65536个三角面。');options={...options,lowFaceBudget:Math.floor(options.lowTriangleBudget/2)};}
    const limit=options.lowFaceBudget??500;if(!Number.isInteger(limit)||limit<24||limit>32768)throw Error('低模面数上限为24～32768个四边面。');
    const result=baseGenerate(source,proposal,{...options,lowSubdivisions:1},progress);
    if(result.supported&&proposal.surfaceFitting?.mode==='structural-region-face'){
      const fitter=(typeof createContourSurfaceFit==='function'?createContourSurfaceFit:require('./surface-fit.js'))(E);
      result.mesh=untangle(fitter.apply(result.mesh,proposal.surfaceFitting),progress);
      result.mesh.method='结构CSI面带 / 同区高模面形约束';result.mesh.csiReport.method='shared CSI topology with captured same-region high-surface offsets; replay without source correspondence queries';result.mesh.csiReport.sourceGeometryUsedDuringFitting=true;result.mesh.csiReport.guideSignature=guideSignature(proposal);
    }
    if(result.supported&&proposal.surfaceMatching?.mode==='fixed-partitions-final'&&proposal.surfaceMatching.coefficients?.length){
      const matcher=(typeof createContourSilhouetteMatch==='function'?createContourSilhouetteMatch:require('./silhouette-match.js'))(E),matched=matcher.apply(result.mesh,proposal.surfaceMatching);
      if(!matcher.valid(matched))throw Error('最终轮廓匹配产生无效四边面，保留旧结果。');
      result.mesh=untangle(matched,progress);result.mesh.method='结构CSI补面 / 最终轮廓匹配';result.mesh.csiReport.surfaceMatching=proposal.surfaceMatching.report;result.mesh.csiReport.guideSignature=guideSignature(proposal);
    }if(result.supported&&proposal.curvatureNetwork){result.mesh.csiCurveNetwork=structuredClone(proposal.curvatureNetwork);result.mesh.csiReport.curvatureNetwork=proposal.curvatureNetwork.report;result.mesh=(typeof createContourCurvatureNetwork==='function'?createContourCurvatureNetwork:require('./curvature-network.js'))(E).applyStripNetworks(result.mesh,proposal.curvatureNetwork);}if(result.supported&&proposal.structureGrid){const remesher=(typeof createContourStructureGrid==='function'?createContourStructureGrid:require('./structure-grid.js'))(E);result.mesh=remesher.generate(result.mesh,proposal.structureGrid,options);result.mesh.csiReport.guideSignature=guideSignature(proposal);}if(result.supported&&options.lowTriangleBudget!==undefined){const used=E.audit(result.mesh).triangles;if(used>options.lowTriangleBudget)throw Error('低模三角面数超过完整模型预算。');result.mesh.csiReport.budget={...result.mesh.csiReport.budget,limit:options.lowTriangleBudget,used,unit:'triangles',polygonFaces:result.mesh.faces.length};}return result;
  }
  function baseGenerate(source,proposal,options={},progress=()=>{}){
    if(!proposal?.interfaces?.length||!proposal.patchGroups||proposal.patchGroups.length!==source.faces.length)return {supported:false,reason:'中档没有可闭合的CSI分区网络'};
    const square=proposal.surfaceLayout?.version===1&&proposal.surfaceLayout.objective==='square-directional',frames=new Map((proposal.surfaceFrames||[]).map(f=>[f.patch,new Map(f.normals.map(n=>[n.vertex,n.normal]))]));
    const signature=E.fingerprint(source),scale=E.bounds({vertices:proposal.curves.flatMap(c=>[c.p0,c.p1,c.p2,c.p3])}).diagonal,curves=new Map(proposal.curves.map(c=>[c.id,c])),chains=new Map(proposal.chains.map(c=>[c.interfaceId,c])),edges=[],rawEdges=new Map(),patches=[],groups=proposal.patchGroups;
    for(const intf of proposal.interfaces){const chain=chains.get(intf.id);if(!chain)throw Error('CSI接口缺少连接索引。');
      for(const logical of intf.edges.flatMap(logical=>{const runs=[];for(const id of logical.curves){const c=curves.get(id),last=runs.at(-1);if(!last||curves.get(last.at(-1)).endIndex!==c.startIndex)runs.push([id]);else last.push(id);}return runs.length===1?[logical]:runs.map((run,i)=>({...logical,id:logical.id+'/run'+i,parentLogical:logical.id,curves:run}));})){const cs=logical.curves.map(id=>curves.get(id));if(!cs.length||cs.some(c=>!c))throw Error('CSI逻辑边引用无效。');const start=cs[0].startIndex,end=cs.at(-1).endIndex,closed=chain.vertices[start]===chain.vertices[end],breaks=closed?Array.from({length:Math.min(4,end-start)+1},(_,i)=>start+Math.floor((end-start)*i/Math.min(4,end-start))):[start,end];
        for(let part=0;part<breaks.length-1;part++){const a=breaks[part],b=breaks[part+1],ids=chain.vertices.slice(a,b+1),table=[];let length=0;
          for(const c of cs){const lo=Math.max(a,c.startIndex),hi=Math.min(b,c.endIndex);if(hi<=lo)continue;const t0=(lo-c.startIndex)/(c.endIndex-c.startIndex),t1=(hi-c.startIndex)/(c.endIndex-c.startIndex);for(let j=0;j<=64;j++){const t=t0+(t1-t0)*j/64,point=cubic(c,t);if(table.length)length+=dist(table.at(-1).point,point);table.push({c,t,point,arc:length,index:c.startIndex+(c.endIndex-c.startIndex)*t});}}
          if(!length||ids.length<2)throw Error('CSI边退化。');
          function sample(u){if(u<=0)return {point:table[0].point.slice()};if(u>=1)return {point:table.at(-1).point.slice()};const target=u*length;let lo=0,hi=table.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(table[m].arc<target)lo=m;else hi=m;}const x=table[lo],y=table[hi],f=(target-x.arc)/(y.arc-x.arc||1);return {point:x.c===y.c?cubic(x.c,x.t+(y.t-x.t)*f):lerp(x.point,y.point,f)};}
          function normalAt(patch,u){const ns=frames.get(patch);if(!ns)return null;let lo=0,hi=table.length-1;const target=E.clamp(u,0,1)*length;while(hi-lo>1){const mid=(lo+hi)>>1;if(table[mid].arc<target)lo=mid;else hi=mid;}const x=table[lo],y=table[hi],f=(target-x.arc)/(y.arc-x.arc||1),index=x.index+(y.index-x.index)*E.clamp(f,0,1),k=Math.min(ids.length-2,Math.max(0,Math.floor(index-a))),v=E.clamp(index-a-k,0,1),n=ns.get(ids[k]),m=ns.get(ids[k+1]);return n&&m?E.unit(lerp(n,m,v)):null;}
          const e={length,id:logical.id+'/'+part,interfaceId:intf.id,logicalEdge:logical.parentLogical||logical.id,ids,sample,normalAt,curves:cs.map(c=>c.id),types:[...new Set(cs.map(c=>c.type))]};edges.push(e);for(let j=0;j<ids.length-1;j++){const k=key(ids[j],ids[j+1]);if(rawEdges.has(k))throw Error('CSI共享边被重复定义。');rawEdges.set(k,e);}
        }
      }
    }
    // A verified corner is a density landmark on its two incident logical
    // edges. Branch junctions alone do not imply a hard turn.
    const corners=new Set((proposal.sourceCorners||[]).flatMap(c=>c.nodes)),starts=new Map(edges.map(e=>[e.interfaceId+':'+e.ids[0],e]));
    for(const a of edges){
      const node=a.ids.at(-1),b=starts.get(a.interfaceId+':'+node);
      if(!b||a===b||!corners.has(node))continue;
      const incoming=E.unit(sub(a.sample(1).point,a.sample(.98).point)),outgoing=E.unit(sub(b.sample(.02).point,b.sample(0).point)),angle=Math.acos(E.clamp(E.dot(incoming,outgoing),-1,1));
      a.endTurn=angle;b.startTurn=angle;
    }
    // A disk uses the usual chart. An annular smooth group uses a periodic
    // strip with one welded parameter seam; that seam is NOT a CSI boundary.
    for(const patch of proposal.patches){const faces=source.faces.map((_,i)=>i).filter(i=>groups[i]===patch.id),counts=new Map(),vertices=new Set(),directed=new Map();for(const fi of faces){const f=source.faces[fi];f.forEach((a,j)=>{const b=f[(j+1)%f.length],k=key(a,b);vertices.add(a);counts.set(k,(counts.get(k)||0)+1);directed.set(k,[a,b]);});}
      if(!faces.length)continue;const boundary=[...counts].filter(([,n])=>n===1).map(([k])=>directed.get(k)),next=new Map(),euler=vertices.size-counts.size+faces.length;if(![0,1].includes(euler)||!boundary.length)return {supported:false,reason:'CSI分区含多个孔、把手或封闭区域，需要先建立补片切缝'};
      for(const [a,b]of boundary){if(next.has(a))return {supported:false,reason:'CSI分区边界存在分叉，暂不能作为单个补片'};next.set(a,b);if(!rawEdges.has(key(a,b)))return {supported:false,reason:'CSI结构网络未覆盖整个分区边界'};}
      const seen=new Set(),loops=[];while(seen.size<boundary.length){const start=boundary.find(([a,b])=>!seen.has(a)&&[rawEdges.get(key(a,b)).ids[0],rawEdges.get(key(a,b)).ids.at(-1)].includes(a))?.[0];if(start===undefined)return {supported:false,reason:'CSI补片缺少可连接的逻辑角点'};const loop=[];let v=start;while(!seen.has(v)&&next.has(v)){seen.add(v);loop.push(v);v=next.get(v);}if(v!==start)return {supported:false,reason:'CSI分区边界圈不闭合'};const sides=[];let consumed=0;while(consumed<loop.length){const a=loop[consumed],b=loop[(consumed+1)%loop.length],edge=rawEdges.get(key(a,b)),forward=a===edge.ids[0],ids=forward?edge.ids:edge.ids.slice().reverse();if(a!==ids[0]||ids.some((vi,j)=>loop[(consumed+j)%loop.length]!==vi))throw Error('CSI逻辑边与分区环不一致。');sides.push({edge,forward,ids});consumed+=ids.length-1;}loops.push(sides);}
      if(loops.length!==2-euler)return {supported:false,reason:'CSI分区不是盘状或单孔环带'};
      if(loops.length===1){const sides=loops[0];if(sides.length<4)return {supported:false,reason:'CSI分区少于四个可规划侧点，需要先细化补片'};patches.push({id:patch.id,faces,vertices,sides});continue;}
      const point=s=>s.edge.sample(s.forward?0:1).point;let best=null;for(let a=0;a<loops[0].length;a++)for(let b=0;b<loops[1].length;b++){const distance=dist(point(loops[0][a]),point(loops[1][b]));if(!best||distance<best.distance)best={a,b,distance};}
      const rotate=(a,n)=>a.slice(n).concat(a.slice(0,n)),a=rotate(loops[0],best.a),b=rotate(loops[1],best.b),p0=point(a[0]),p1=point(b[0]),cut={id:'annular-seam-'+patch.id,interfaceId:null,logicalEdge:null,ids:[a[0].ids[0],b[0].ids[0]],length:dist(p0,p1),curves:[],types:['I'],virtual:true,sample:t=>({point:lerp(p0,p1,t)})};edges.push(cut);const right={edge:cut,forward:true,ids:cut.ids},left={edge:cut,forward:false,ids:cut.ids.slice().reverse()},sides=a.concat([right],b,[left]),chartSides=[a,[right],b,[left]],annularPlan={annular:true,corners:[0,a.length,a.length+1,a.length+1+b.length],sides:chartSides,lengths:chartSides.map(xs=>xs.reduce((s,x)=>s+x.edge.length,0)),score:0};patches.push({id:patch.id,faces,vertices,sides,annularPlan});
    }
    for(const p of patches){const points=p.sides.flatMap(s=>Array.from({length:16},(_,i)=>s.edge.sample(s.forward?i/16:1-i/16).point)),center=mul(points.reduce((sum,x)=>add(sum,x),[0,0,0]),1/points.length),normal=points.reduce((sum,x,i)=>add(sum,E.cross(sub(x,center),sub(points[(i+1)%points.length],center))),[0,0,0]);p.boundaryNormal=E.unit(normal);p.boundaryArea=Math.max(E.len(normal)/2,scale*scale*1e-10);p.planar=points.every(x=>Math.abs(E.dot(sub(x,center),p.boundaryNormal))<scale*1e-6);}
    const planarBox=edges.every(e=>e.types.length===1&&e.types[0]==='I')&&patches.every(p=>p.sides.length===4&&p.planar);
    // Width subdivision follows cell dimensions. Cross-width normal change
    // must not allocate an extra full longitudinal loop around the band.
    if(!square){
      const normalAt=(xs,patch,t)=>{const total=xs.reduce((s,x)=>s+x.edge.length,0);let used=0;for(const side of xs){if(t*total<=used+side.edge.length||side===xs.at(-1)){const u=E.clamp((t*total-used)/side.edge.length,0,1);return side.edge.normalAt?.(patch,side.forward?u:1-u)||null;}used+=side.edge.length;}return null;};
      for(const p of patches)if(p.annularPlan&&frames.has(p.id)){const turns=[],s=p.annularPlan.sides;for(let i=0;i<=32;i++){const t=i/32,na=normalAt(s[0],p.id,t),nb=normalAt(s[2],p.id,1-t);if(na&&nb)turns.push(Math.acos(E.clamp(E.dot(na,nb),-1,1)));}turns.sort((a,b)=>a-b);if(turns.length)s[1][0].edge.surfaceTurn=turns[Math.floor((turns.length-1)*.9)];}
    }
    const planReport=structuredPlan(edges,patches,planarBox?Math.min(options.lowFaceBudget??500,patches.length*4):options.lowFaceBudget??500,square);

    if(planarBox&&patches.length*4<=(options.lowFaceBudget??500)){edges.forEach(e=>e.divisions=2);patches.forEach(p=>p.gridSize=[2,2]);planReport.faces=patches.length*4;planReport.stripSteps=0;}
    const vertices=[],faces=[],faceSources=[],csiPatchGroups=[],registry=new Map(),reports=[],charts=[],centeredRimVertices=[];
    function vertex(id,p){if(registry.has(id)){const i=registry.get(id);if(dist(vertices[i],p)>scale*1e-6)throw Error('CSI补片共享节点位置不一致。');return i;}const i=vertices.length;vertices.push(p.slice());registry.set(id,i);return i;}
    for(const e of edges)e.parameters=edgeParameters(e);
    const structureFlow=alignRimSamples(edges,patches,scale,square,proposal.surfaceLayout?.rimSamplingVersion===2),widthMidpoints=centerWidthSamples(patches);
    for(const e of edges){const T=e.divisions;e.meshVertices=[];for(let i=0;i<=T;i++){const endpoint=i===0?e.ids[0]:i===T?e.ids.at(-1):null;e.meshVertices.push(vertex(endpoint===null?'edge:'+e.id+':'+i:'node:'+endpoint,e.sample(e.parameters[i]).point));}}
    const sideVertex=(side,i)=>side.edge.meshVertices[side.forward?i:side.edge.divisions-i];
    for(const patch of patches){progress('低模：只沿CSI补四边面 · 分区 '+(reports.length+1)+' / '+patches.length);const chart=patch.plan,[U,V]=patch.gridSize,sides=chart.sides,grid=[],adjGrid=new Map(),fixed=new Map();
      function chartSide(xs,index){let used=0;for(let j=0;j<xs.length;j++){const side=xs[j],T=side.edge.divisions;if(index<=used+T||j===xs.length-1)return sideVertex(side,index-used);used+=T;}throw Error('CSI面带边界采样缺失。');}
      for(let y=0;y<=V;y++){const row=[];for(let x=0;x<=U;x++){let id;if(!y)id=chartSide(sides[0],x);else if(x===U)id=chartSide(sides[1],y);else if(y===V)id=chartSide(sides[2],U-x);else if(!x)id=chartSide(sides[3],V-y);else id=vertex('patch:'+patch.id+':grid:'+x+':'+y,[0,0,0]);if(!x||!y||x===U||y===V)fixed.set(id,vertices[id]);adjGrid.set(id,new Set());row.push(id);}grid.push(row);}
      for(let y=0;y<=V;y++)for(let x=0;x<=U;x++)for(const [dx,dy]of [[1,0],[0,1]])if(x+dx<=U&&y+dy<=V){const a=grid[y][x],b=grid[y+dy][x+dx];adjGrid.get(a).add(b);adjGrid.get(b).add(a);}
      const seed=new Map();for(let y=1;y<V;y++)for(let x=1;x<U;x++){const u=x/U,v=y/V,p=sub(add(add(mul(vertices[grid[0][x]],1-v),mul(vertices[grid[V][x]],v)),add(mul(vertices[grid[y][0]],1-u),mul(vertices[grid[y][U]],u))),add(add(mul(vertices[grid[0][0]],(1-u)*(1-v)),mul(vertices[grid[0][U]],u*(1-v))),add(mul(vertices[grid[V][U]],u*v),mul(vertices[grid[V][0]],(1-u)*v))));vertices[grid[y][x]]=p;seed.set(grid[y][x],p);}
      let profileSamples=0,profileSurface=null;
      if(patch.annularPlan&&frames.has(patch.id)){
        const rail=(xs,index)=>{let used=0;for(let j=0;j<xs.length;j++){const side=xs[j],T=side.edge.divisions;if(index<=used+T||j===xs.length-1){const q=E.clamp(index-used,0,T),k=Math.min(T-1,Math.floor(q)),f=q-k,at=side.forward?k:T-k,bt=side.forward?k+1:T-k-1,t=side.edge.parameters[at]*(1-f)+side.edge.parameters[bt]*f;return {point:side.edge.sample(t).point,normal:side.edge.normalAt?.(patch.id,t)||null};}used+=T;}return null;};
        profileSurface=(u,v)=>{const A=rail(sides[0],u*U),B=rail(sides[2],(1-u)*U),a=A.point,b=B.point,d=sub(b,a),w=E.len(d),na=A.normal,nb=B.normal;if(!na||!nb||!w)return lerp(a,b,v);const angle=Math.acos(E.clamp(E.dot(na,nb),-1,1)),arcFactor=2/(1+Math.cos(angle/2)),tangent=n=>{const p=sub(d,mul(n,E.dot(n,d)));return E.len(p)>w*.2?mul(E.unit(p),w*arcFactor):d;},ta=tangent(na),tb=tangent(nb),q=1-v;return add(add(mul(a,(1+2*v)*q*q),mul(ta,v*q*q)),add(mul(b,v*v*(3-2*v)),mul(tb,-v*v*q)));};
        for(let x=0;x<U;x++)for(let y=1;y<V;y++){const point=profileSurface(x/U,y/V),id=grid[y][x];vertices[id]=point;seed.set(id,point);if(x===0)fixed.set(id,point);profileSamples++;}
      }
      // Only strongly elongated charts use width constraints; a broad curved
      // sheet must keep its smooth interior rather than become a ruled strip.
      const spans=[(chart.lengths[0]+chart.lengths[2])/2,(chart.lengths[1]+chart.lengths[3])/2],widthAxis=spans[0]<spans[1]*.12?0:spans[1]<spans[0]*.12?1:null;
      let fairing;
      if(patch.widthFamilyAxis!==null&&!patch.annularPlan){
        const axis=patch.widthFamilyAxis,u=axis===0,T=u?U:V,N=u?V:U,
          at=(i,j)=>vertices[u?grid[j][i]:grid[i][j]],
          arc=[0];for(let j=1;j<=N;j++)arc.push(arc.at(-1)+(dist(at(0,j-1),at(0,j))+dist(at(T,j-1),at(T,j)))/2);
        const widths=Array.from({length:N+1},(_,j)=>dist(at(0,j),at(T,j))),
          deviations=[0,N].map(j=>Array.from({length:T+1},(_,i)=>sub(at(i,j),lerp(at(0,j),at(T,j),i/T)))),
          blend=s=>{const t=E.clamp(s,0,1);return (1-t)**2*(1+2*t);};
        // CSI cap curves can be non-straight. Their exact knot/midpoint profiles
        // are extended only two local widths into the strip, with zero slope at
        // each end of the blend. No corner is moved or mistaken for the center.
        for(let j=1;j<N;j++)for(let i=1;i<T;i++){
          const id=u?grid[j][i]:grid[i][j],a=blend(arc[j]/(2*widths[0])),b=blend((arc[N]-arc[j])/(2*widths[N])),
            norm=Math.max(1,a+b),offset=add(mul(deviations[0][i],a/norm),mul(deviations[1][i],b/norm));
          vertices[id]=add(lerp(at(0,j),at(T,j),i/T),offset);
          fixed.set(id,vertices[id]);seed.set(id,vertices[id]);centeredRimVertices.push(id);
        }
        fairing={method:'CSI rim width family; independent 50% lane; exact CSI cap profiles with local smooth blend',...(widthAxis!==null?{widthAxis:axis===0?'u':'v'}:{}),rimFamilyAxis:axis===0?'u':'v',iterations:0,relativeResidual:0};
      }else if(profileSurface)fairing=optimizeProfileGrid(vertices,grid,U,V,profileSurface,square);
      else{fairing=fairChart(vertices,grid,U,V,spans);if(square&&U>1&&V>1)fairing.quality=optimizeProfileGrid(vertices,grid,U,V,chartSurface(vertices,grid,U,V),true);}
      const cells=[];for(let y=0;y<V;y++)for(let x=0;x<U;x++)cells.push([grid[y][x],grid[y][x+1],grid[y+1][x+1],grid[y+1][x]]);
      const quality=ps=>{const normal=E.faceData({vertices:ps},[0,1,2,3]).normal;let minCorner=1;for(let i=0;i<4;i++){const a=sub(ps[(i+1)%4],ps[i]),b=sub(ps[(i+3)%4],ps[i]);minCorner=Math.min(minCorner,E.dot(E.cross(a,b),normal)/(E.len(a)*E.len(b)||1));}const diagonal=E.dot(E.unit(E.cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),E.unit(E.cross(sub(ps[2],ps[0]),sub(ps[3],ps[0]))));return {valid:minCorner>1e-7&&diagonal>.005,minCorner:Math.min(minCorner,diagonal-.005)};};
      const incident=new Map();cells.forEach((f,fi)=>f.forEach(id=>{if(!incident.has(id))incident.set(id,[]);incident.get(id).push(fi);}));let regularizationMoves=0;
      // Fair only invalid cells; both the initial surface and all repair targets
      // come from the CSI boundary and its quad adjacency, never the high mesh.
      const membrane=harmonic(adjGrid,fixed).values;
      for(let pass=0;pass<48;pass++){const bad=cells.map((f,i)=>quality(f.map(v=>vertices[v])).valid?-1:i).filter(i=>i>=0);if(!bad.length)break;let changed=false;const candidates=[...new Set(bad.flatMap(fi=>cells[fi]))].filter(id=>!fixed.has(id));for(const id of candidates){const fs=incident.get(id),p=vertices[id],ns=[...adjGrid.get(id)],mean=mul(ns.reduce((sum,v)=>add(sum,vertices[v]),[0,0,0]),1/ns.length),energy=()=>fs.reduce((sum,fi)=>sum+Math.min(0,quality(cells[fi].map(v=>vertices[v])).minCorner-.025)**2,0),old=energy();let best=null;for(const target of [mean,membrane.get(id),seed.get(id),...ns.map(v=>lerp(p,vertices[v],.3))])for(const t of [1,.5,.25,.125]){vertices[id]=lerp(p,target,t);const value=energy();if(value<old-1e-12&&(!best||value<best.value))best={point:vertices[id],value};}vertices[id]=best?best.point:p;if(best){changed=true;regularizationMoves++;}}if(!changed)break;}
      if(cells.some(f=>!quality(f.map(id=>vertices[id])).valid))throw Error('CSI分区'+(patch.id+1)+'的'+U+'×'+V+'面带存在凹折，请调整CSI分区或预算。');
      for(const f of cells){faces.push(f);faceSources.push(patch.faces[0]);csiPatchGroups.push(patch.id);}
      charts.push({patch:patch.id,grid: grid.map(row=>row.slice()),parameters:fairing.parameters||fairing.quality?.parameters||null,U,V,rim:patch.widthFamilyAxis!==null&&!patch.annularPlan||profileSamples>0,annular:!!patch.annularPlan,surfaceProfile:profileSamples?'CSI boundary-normal Hermite':null});reports.push({id:patch.id,sides:patch.sides.length,faces:cells.length,layout:patch.annularPlan?'CSI-only periodic annular quad strip':'CSI-only fair quad grid',grid:[U,V],corners:chart.corners,highSurfaceQueries:0,profileSamples,regularizationMoves,fairing});
    }
    const csiEdges=edges.map(e=>({id:e.id,logicalEdge:e.logicalEdge,interfaceId:e.interfaceId,virtual:!!e.virtual,curves:e.curves,types:e.types,vertices:e.meshVertices,parameters:e.parameters,sampling:'curvature-weighted CSI arclength'})),csiBoundaryKeys=[...new Set(csiEdges.filter(e=>!e.virtual).flatMap(e=>e.vertices.slice(1).map((v,i)=>key(e.vertices[i],v))))],mesh={vertices,faces,faceSources,csiPatchGroups,csiBoundaryKeys,csiEdges,csiCharts:charts,method:'仅CSI边界 / 平顺曲面四边面带',hierarchy:{parentLevel:'middle-csi',sourceFingerprint:signature,refinements:options.lowSubdivisions??1,allQuads:true},csiReport:{method:'CSI-only shared curves; Coons seed and fidelity-constrained thin-plate interior; no high-poly surface correspondence',structured:true,csiOnly:true,highSurfaceQueries:0,sourceGeometryUsed:false,provenance:'representative source face per CSI region; no closest-face projection',budget:{limit:options.lowFaceBudget??500,used:faces.length,...planReport},fallback:false,patches:reports,structureFlow,widthMidpoints,centeredRimVertices,annularGroups:patches.filter(p=>p.annularPlan).map(p=>p.id),parameterSeams:edges.filter(e=>e.virtual).length,logicalSides:edges.filter(e=>!e.virtual).length,sharedBoundaryEdges:csiBoundaryKeys.length,samplesPerSide:edges.map(e=>e.divisions),sourceFingerprint:signature,guideSignature:guideSignature(proposal),sourceUnmodified:true}};
    const health=E.audit(mesh),sourceHealth=E.audit(source);if(!health.valid||health.components!==sourceHealth.components||JSON.stringify(health.euler)!==JSON.stringify(sourceHealth.euler)||health.boundaryLoops!==sourceHealth.boundaryLoops)throw Error('CSI补面未通过共享连接与拓扑检查，保留旧结果。');if(E.fingerprint(source)!==signature)throw Error('CSI补面意外修改了原高模。');const completed=untangle(mesh,progress);if(!E.audit(completed).valid||completed.faces.length>(options.lowFaceBudget??500))throw Error('CSI补面未通过最终检查。');let maximum=0,samples=0;for(const edge of edges.filter(e=>!e.virtual))for(let i=0;i<edge.divisions;i++){const a=completed.vertices[edge.meshVertices[i]],b=completed.vertices[edge.meshVertices[i+1]],d=sub(b,a);for(const t of [.25,.5,.75]){const q=edge.sample(edge.parameters[i]*(1-t)+edge.parameters[i+1]*t).point,k=E.clamp(E.dot(sub(q,a),d)/(E.dot(d,d)||1),0,1);maximum=Math.max(maximum,dist(q,add(a,mul(d,k))));samples++;}}completed.csiReport.boundaryError={maximum,maxRelative:maximum/scale,sampleCount:samples,target:'CSI',method:'sampled analytic CSI to its corresponding straight boundary chord; not a strict upper bound'};return {supported:true,mesh:completed};
  }
  function guideSignature(p){let h=2166136261;const text=JSON.stringify({...(p.surfaceLayout?{surfaceLayout:p.surfaceLayout}:{}),...(p.structureGrid?{structureGrid:p.structureGrid}:{}),...(p.curvatureNetwork?{curvatureNetwork:p.curvatureNetwork}:{}),groups:p.patchGroups,curves:p.curves.map(c=>[c.id,c.p0,c.p1,c.p2,c.p3]),interfaces:p.interfaces,...(p.surfaceFrames?.length?{surfaceFrames:p.surfaceFrames}:{}),...(p.surfaceFitting?{surfaceFitting:p.surfaceFitting}:{}),...(p.surfaceMatching?.coefficients?.length?{surfaceMatching:p.surfaceMatching}: {})});for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
  return {generate,guideSignature};
}
if(typeof module!=='undefined')module.exports=createContourCSISurface;
if(typeof window!=='undefined')window.createContourCSISurface=createContourCSISurface;
