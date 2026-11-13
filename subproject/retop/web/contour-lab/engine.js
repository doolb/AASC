/* Pure geometry and mask processing. No DOM, dependencies, trained weights or reference templates. */
function makeContourEngine() {
  'use strict';
  const FAR_MID_EDGE_LIMIT=5;
  const PART_EDGE_LIMIT=6, STANDARD_PART_EDGE_LIMIT=5, PARALLEL_DEGREES=30, MIDDLE_PART_LIMIT=5, NEAR_PART_LIMIT=12;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], mul=(a,s)=>[a[0]*s,a[1]*s];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1], cross=(a,b)=>a[0]*b[1]-a[1]*b[0], norm=a=>Math.hypot(a[0],a[1]), dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const unit=a=>{const n=norm(a);return n>1e-12?mul(a,1/n):[1,0];}, mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
  const area=p=>p.reduce((v,a,i)=>v+cross(a,p[(i+1)%p.length]),0)/2;
  function components(mask,w,h) {
    const seen=new Uint8Array(w*h), queue=new Int32Array(w*h), groups=[];
    for(let seed=0;seed<mask.length;seed++) if(mask[seed]&&!seen[seed]) {
      let head=0,tail=1;queue[0]=seed;seen[seed]=1;
      while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&mask[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}}
      groups.push(queue.slice(0,tail));
    }
    groups.sort((a,b)=>b.length-a.length);return groups;
  }
  function fillHoles(mask,w,h) {
    const outside=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
    const put=i=>{if(!mask[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
    for(let x=0;x<w;x++){put(x);put((h-1)*w+x);}for(let y=0;y<h;y++){put(y*w);put(y*w+w-1);}
    while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;if(x)put(i-1);if(x<w-1)put(i+1);if(y)put(i-w);if(y<h-1)put(i+w);}
    return Uint8Array.from(mask,(_,i)=>outside[i]?0:1);
  }
  function prepare(input,w,h) {
    const groups=components(input,w,h);if(!groups.length||groups[0].length<30)throw Error('请画出有面积的闭合轮廓。');
    const mask=new Uint8Array(w*h);for(const i of groups[0])mask[i]=1;
    return {mask,discarded:groups.slice(1).reduce((n,g)=>n+g.length,0),components:groups.length};
  }
  function maskInfo(input,w,h){const groups=components(input,w,h),loops=[];let holes=0;for(const group of groups){const local=new Uint8Array(input.length);for(const i of group)local[i]=1;const r=traceAll(local,w,h);holes+=r.length-1;loops.push(...r);}return {loops,holes,components:groups.length,area:count(input)};}
  function edt(mask,w,h,target) {
    const tmp=new Float64Array(w*h),out=new Float64Array(w*h),n=Math.max(w,h),f=new Float64Array(n),d=new Float64Array(n),v=new Int32Array(n),z=new Float64Array(n+1);
    function transform(len){let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;for(let q=1;q<len;q++){let s;do{s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));if(s<=z[k])k--;else break;}while(k>=0);k++;v[k]=q;z[k]=s;z[k+1]=Infinity;}k=0;for(let q=0;q<len;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}}
    for(let y=0;y<h;y++){for(let x=0;x<w;x++)f[x]=mask[y*w+x]===target?0:1e12;transform(w);for(let x=0;x<w;x++)tmp[y*w+x]=d[x];}
    for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=tmp[y*w+x];transform(h);for(let y=0;y<h;y++)out[y*w+x]=d[y];}return out;
  }
  const count=m=>m.reduce((s,v)=>s+(v?1:0),0);
  function robustBody(mask,w,h,radius) {
    const total=count(mask);let r=Math.max(0,Math.round(radius));
    for(;r>0;r--){const bg=edt(mask,w,h,0),eroded=Uint8Array.from(bg,d=>d>r*r?1:0);if(!count(eroded))continue;
      const fg=edt(eroded,w,h,1),opened=Uint8Array.from(fg,(d,i)=>d<=r*r&&mask[i]?1:0),parts=components(opened,w,h);
      if(!parts.length||parts[0].length<total*.68||(parts[1]&&parts[1].length>total*.08))continue;
      const body=new Uint8Array(mask.length);for(const i of parts[0])body[i]=1;
      return {mask:body,radius:r,removed:total-parts[0].length};}
    return {mask:mask.slice(),radius:0,removed:0};
  }
  function gaussian(mask,w,h,sigma) {
    if(sigma<.2)return mask.slice();const r=Math.ceil(3*sigma),kernel=[],tmp=new Float32Array(w*h),out=new Uint8Array(w*h);let sum=0;
    for(let i=-r;i<=r;i++){const k=Math.exp(-i*i/(2*sigma*sigma));kernel.push(k);sum+=k;}for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let j=-r;j<=r;j++){const xx=x+j;if(xx>=0&&xx<w)v+=mask[y*w+xx]*kernel[j+r];}tmp[y*w+x]=v;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let j=-r;j<=r;j++){const yy=y+j;if(yy>=0&&yy<h)v+=tmp[yy*w+x]*kernel[j+r];}out[y*w+x]=v>=.5?1:0;}return out;
  }
  function stableBlur(mask,w,h,sigma) {
    const total=count(mask);let s=sigma;
    for(let attempt=0;attempt<5;attempt++,s*=.5){const m=gaussian(mask,w,h,s),groups=components(m,w,h);if(!groups.length||groups[0].length<total*.68||(groups[1]&&groups[1].length>total*.08))continue;
      const out=new Uint8Array(mask.length);for(const i of groups[0])out[i]=1;return {mask:fillHoles(out,w,h),sigma:s};}
    return {mask:mask.slice(),sigma:0};
  }
  function traceAll(mask,w,h) {
    const graph=new Map(),pts=new Map();
    const key=p=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`;
    const edge=(a,b)=>{const ka=key(a),kb=key(b);pts.set(ka,a);pts.set(kb,b);if(!graph.has(ka))graph.set(ka,[]);if(!graph.has(kb))graph.set(kb,[]);graph.get(ka).push(kb);graph.get(kb).push(ka);};
    const at=(x,y)=>x>=0&&y>=0&&x<w&&y<h?mask[y*w+x]:0;
    const cases=[[],[[3,0]],[[0,1]],[[3,1]],[[1,2]],[[3,0],[1,2]],[[0,2]],[[3,2]],[[2,3]],[[0,2]],[[0,1],[2,3]],[[1,2]],[[3,1]],[[0,1]],[[3,0]],[]];
    for(let y=-1;y<h;y++)for(let x=-1;x<w;x++){const code=at(x,y)+2*at(x+1,y)+4*at(x+1,y+1)+8*at(x,y+1);if(code===0||code===15)continue;const p=[[x+1,y+.5],[x+1.5,y+1],[x+1,y+1.5],[x+.5,y+1]];for(const [a,b]of cases[code])edge(p[a],p[b]);}
    for(const n of graph.values())if(n.length!==2)throw Error('轮廓图有非流形节点，无法闭合。');
    const seen=new Set(),loops=[];for(const start of graph.keys())if(!seen.has(start)){const loop=[];let prev=null,cur=start;do{seen.add(cur);loop.push(pts.get(cur));const next=graph.get(cur).find(k=>k!==prev);prev=cur;cur=next;}while(cur!==start&&loop.length<=graph.size);if(cur!==start)throw Error('轮廓未闭合。');loops.push(loop);}
    loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));if(!loops.length)throw Error('未找到轮廓。');return loops.map((p,i)=>(area(p)>0)===(i===0)?p:p.slice().reverse());
  }
  function trace(mask,w,h){return traceAll(mask,w,h)[0];}

  function resample(points,step=1) {
    const lengths=[0];for(let i=0;i<points.length;i++)lengths.push(lengths[i]+dist(points[i],points[(i+1)%points.length]));
    const n=Math.max(16,Math.min(4096,Math.ceil(lengths.at(-1)/step))),out=[];let j=0;
    for(let i=0;i<n;i++){const s=i*lengths.at(-1)/n;while(lengths[j+1]<s)j++;out.push(mix(points[j],points[(j+1)%points.length],(s-lengths[j])/(lengths[j+1]-lengths[j])));}return out;
  }
  function smoothPoints(p,sigma=.65) {
    const r=Math.ceil(3*sigma),k=[];let sum=0;for(let j=-r;j<=r;j++){const v=Math.exp(-j*j/(2*sigma*sigma));k.push(v);sum+=v;}
    return p.map((_,i)=>{let a=[0,0];for(let j=-r;j<=r;j++)a=add(a,mul(p[(i+j+p.length)%p.length],k[j+r]/sum));return a;});
  }
  function hull(points) {const p=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const half=arr=>{const o=[];for(const v of arr){while(o.length>=2&&cross(sub(o.at(-1),o.at(-2)),sub(v,o.at(-1)))<=0)o.pop();o.push(v);}return o;};const a=half(p),b=half(p.slice().reverse());return a.slice(0,-1).concat(b.slice(0,-1));}
  function rectangle(points) {
    const h=hull(points);let best=null;
    for(let i=0;i<h.length;i++){const u=unit(sub(h[(i+1)%h.length],h[i])),v=[-u[1],u[0]];let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const p of h){const x=dot(p,u),y=dot(p,v);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}const a=(x1-x0)*(y1-y0);
      if(!best||a<best.area)best={area:a,points:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>add(mul(u,x),mul(v,y)))};}
    return best;
  }
  // A circumscribed convex polygon. Deleting a supporting line expands the
  // envelope; unlike simplifying contour vertices, it cannot cut into the body.
  function enclosingPolygon(points,budget=FAR_MID_EDGE_LIMIT) {
    const boundary=hull(points);
    if(boundary.length<=budget)return {points:boundary,area:Math.abs(area(boundary)),method:'convex-hull'};
    const support=n=>Math.max(...boundary.map(p=>dot(n,p)));
    let planes=boundary.map((p,i)=>{const d=unit(sub(boundary[(i+1)%boundary.length],p)),n=[d[1],-d[0]];return {n,h:support(n)};});
    const intersection=(a,b)=>{const det=cross(a.n,b.n);return [(a.h*b.n[1]-a.n[1]*b.h)/det,(a.n[0]*b.h-a.h*b.n[0])/det];};
    const vertices=lines=>lines.map((p,i)=>intersection(lines[(i+lines.length-1)%lines.length],p));
    while(planes.length>budget){
      let best=-1,cost=Infinity;const n=planes.length;
      for(let i=0;i<n;i++){
        const prev=planes[(i+n-1)%n],cur=planes[i],next=planes[(i+1)%n];
        if(cross(prev.n,next.n)<=1e-10)continue;
        const a=intersection(prev,cur),b=intersection(cur,next),c=intersection(prev,next);
        const added=Math.abs(cross(sub(a,c),sub(b,c)))/2;
        if(added<cost){cost=added;best=i;}
      }
      if(best<0)throw Error('外包直线无法保持有界，请检查输入轮廓。');
      planes.splice(best,1);
    }
    // Local support-direction refinement reduces empty area without giving up
    // enclosure. This is an approximation, not an exact minimum-area n-gon.
    let bestArea=Math.abs(area(vertices(planes)));
    for(const step of [.04,.01,.0025])for(let round=0;round<3;round++)for(let i=0;i<planes.length;i++){
      const original=planes[i],angle=Math.atan2(original.n[1],original.n[0]);let chosen=original;
      for(const sign of [-1,1]){
        const n=[Math.cos(angle+sign*step),Math.sin(angle+sign*step)];
        if(cross(planes[(i+planes.length-1)%planes.length].n,n)<=1e-10||cross(n,planes[(i+1)%planes.length].n)<=1e-10)continue;
        planes[i]={n,h:support(n)};const candidateArea=Math.abs(area(vertices(planes)));
        if(candidateArea<bestArea-1e-8){bestArea=candidateArea;chosen=planes[i];}
      }
      planes[i]=chosen;
    }
    return {points:vertices(planes),area:bestArea,method:'greedy-support-removal/local-direction-refinement'};
  }
  function bez(s,t){const q=1-t;return add(add(mul(s.p0,q*q*q),mul(s.p1,3*q*q*t)),add(mul(s.p2,3*q*t*t),mul(s.p3,t*t*t)));}
  function derivatives(s,t){return [mul(add(add(mul(sub(s.p1,s.p0),(1-t)**2),mul(sub(s.p2,s.p1),2*(1-t)*t)),mul(sub(s.p3,s.p2),t*t)),3),mul(add(mul(add(sub(s.p2,mul(s.p1,2)),s.p0),1-t),mul(add(sub(s.p3,mul(s.p2,2)),s.p1),t)),6)];}
  function inflections(s) {
    const a=add(sub(s.p3,mul(s.p2,3)),sub(mul(s.p1,3),s.p0)),b=mul(add(sub(s.p2,mul(s.p1,2)),s.p0),3),c=mul(sub(s.p1,s.p0),3);
    const A=-6*cross(a,b),B=6*cross(c,a),C=2*cross(c,b),scale=Math.max(1,Math.abs(A),Math.abs(B),Math.abs(C)),eps=1e-10*scale,roots=[];
    if(Math.abs(A)<eps){if(Math.abs(B)>eps)roots.push(-C/B);}else{const d=B*B-4*A*C;if(d>eps*scale){const sq=Math.sqrt(d),q=-.5*(B+Math.sign(B||1)*sq);roots.push(q/A,C/q);}}
    return roots.filter(t=>t>1e-7&&t<1-1e-7&&((A*(t-1e-6)+B)*(t-1e-6)+C)*((A*(t+1e-6)+B)*(t+1e-6)+C)<0).sort((a,b)=>a-b).filter((t,i,a)=>i===0||t-a[i-1]>1e-6);
  }
  // One C is one cubic with two endpoint handles, a single-sided bow and
  // monotone progress along its chord. Zero inflections alone permits loops.
  function simpleC(s){
    const dx=s.p3[0]-s.p0[0],dy=s.p3[1]-s.p0[1],length2=dx*dx+dy*dy;if(length2<1e-18)return false;
    const x1=((s.p1[0]-s.p0[0])*dx+(s.p1[1]-s.p0[1])*dy)/length2,x2=((s.p2[0]-s.p0[0])*dx+(s.p2[1]-s.p0[1])*dy)/length2;
    const y1=(dx*(s.p1[1]-s.p0[1])-dy*(s.p1[0]-s.p0[0]))/length2,y2=(dx*(s.p2[1]-s.p0[1])-dy*(s.p2[0]-s.p0[0]))/length2,eps=1e-10;
    if(!((y1>=-eps&&y2>=-eps)||(y1<=eps&&y2<=eps)))return false;
    const v0=x1,v1=x2-x1,v2=1-x2,A=v0-2*v1+v2,B=2*(v1-v0),t=A>0?-B/(2*A):-1;
    if(Math.min(v0,v2,t>0&&t<1?(A*t+B)*t+v0:Infinity)<-eps)return false;
    if(x1*x1+y1*y1<1e-24||(1-x2)**2+y2*y2<1e-24)return false;
    if(t>0&&t<1){const forward=(A*t+B)*t+v0,lateral=(1-t)**2*y1+2*(1-t)*t*(y2-y1)-t*t*y2;if(Math.hypot(forward,lateral)<1e-12)return false;}
    return true;
  }
  function kind(s){if(!['p0','p1','p2','p3'].every(k=>s[k]?.length===2&&s[k].every(Number.isFinite)))return 'INVALID';const chord=sub(s.p3,s.p0),l=norm(chord);if(l>1e-9&&Math.abs(cross(sub(s.p1,s.p0),chord))/l<1e-7&&Math.abs(cross(sub(s.p2,s.p0),chord))/l<1e-7){return dot(sub(s.p1,s.p0),chord)>=0&&dot(sub(s.p3,s.p2),chord)>=0&&dot(sub(s.p2,s.p1),chord)>=0?'I':'INVALID';}const n=inflections(s).length;return n===0?(simpleC(s)?'C':'INVALID'):n===1?'S':'MULTI';}
  function split(s,t){const a=mix(s.p0,s.p1,t),b=mix(s.p1,s.p2,t),c=mix(s.p2,s.p3,t),d=mix(a,b,t),e=mix(b,c,t),p=mix(d,e,t);return [{p0:s.p0,p1:a,p2:d,p3:p},{p0:p,p1:e,p2:c,p3:s.p3}];}
  function validSegments(segments){const out=[];function visit(s,depth){const roots=inflections(s),k=kind(s),curved=Math.abs(cross(sub(s.p1,s.p0),sub(s.p3,s.p0)))>1e-12||Math.abs(cross(sub(s.p2,s.p0),sub(s.p3,s.p0)))>1e-12;if(depth<12&&(roots.length>1||k==='INVALID'&&curved)){for(const part of split(s,roots.length>1?roots[0]:.5))visit(part,depth+1);}else out.push(s);}for(const s of segments)visit(s,0);return out;}
  function fitSpan(points,tangents,a,b,iterations=0) {
    const n=points.length,p0=points[a%n],p3=points[b%n],t0=tangents[a%n],t1=tangents[b%n],params=[0];
    for(let i=a+1;i<=b;i++)params.push(params.at(-1)+dist(points[(i-1)%n],points[i%n]));const length=params.at(-1);for(let i=1;i<params.length;i++)params[i]/=length||1;
    let best=null;
    for(let round=0;round<=iterations;round++){
      let aa=0,ab=0,bb=0,ra=0,rb=0;
      for(let i=a;i<=b;i++){const t=params[i-a],q=1-t,b0=q*q*q,b1=3*q*q*t,b2=3*q*t*t,b3=t*t*t,A=mul(t0,b1),B=mul(t1,-b2),r=sub(points[i%n],add(mul(p0,b0+b1),mul(p3,b2+b3)));aa+=dot(A,A);ab+=dot(A,B);bb+=dot(B,B);ra+=dot(A,r);rb+=dot(B,r);}
      const det=aa*bb-ab*ab;let h0=det>1e-12?(ra*bb-rb*ab)/det:length/3,h1=det>1e-12?(aa*rb-ab*ra)/det:length/3;
      if(h0<length*.015||h1<length*.015){h0=h1=Math.min(dist(p0,p3)/3,length/3);}h0=Math.max(.001,Math.min(h0,length*.75));h1=Math.max(.001,Math.min(h1,length*.75));
      const chord=sub(p3,p0),chordLength=norm(chord);if(chordLength>1e-8&&dot(t0,unit(chord))>1-1e-12&&dot(t1,unit(chord))>1-1e-12){h0=Math.min(h0,chordLength*.49);h1=Math.min(h1,chordLength*.49);}
      const s={p0:p0.slice(),p1:add(p0,mul(t0,h0)),p2:sub(p3,mul(t1,h1)),p3:p3.slice()};let error=0,index=(a+b)>>1;
      for(let i=a+1;i<b;i++){const d=dist(bez(s,params[i-a]),points[i%n]);if(d>error){error=d;index=i;}}
      if(!best||error<best.error)best={s,error,index,a,b};
      if(round===iterations)break;
      // Newton projection removes chord-length parameter bias on long bends.
      const next=params.slice();for(let j=1;j<params.length-1;j++){const t=params[j],q=bez(s,t),[d,dd]=derivatives(s,t),r=sub(q,points[(a+j)%n]),den=dot(d,d)+dot(r,dd);if(Math.abs(den)>1e-10)next[j]=Math.max(params[j-1]+1e-8,Math.min(params[j+1]-1e-8,t-dot(r,d)/den));}
      for(let j=1;j<params.length-1;j++)params[j]=Math.max(params[j-1]+1e-8,Math.min(1-(params.length-1-j)*1e-8,next[j]));
    }
    return best;
  }
  function fit(points,tolerance,budget=256) {
    const n=points.length,k=2,tangents=points.map((_,i)=>unit(sub(points[(i+k)%n],points[(i-k+n)%n]))),anchors=[0,Math.floor(n/4),Math.floor(n/2),Math.floor(3*n/4),n];
    let spans=anchors.slice(0,-1).map((a,i)=>fitSpan(points,tangents,a,anchors[i+1],4));
    while(spans.length<budget){let index=-1,max=tolerance;for(let i=0;i<spans.length;i++)if(spans[i].error>max&&spans[i].b-spans[i].a>2){max=spans[i].error;index=i;}if(index<0)break;const s=spans[index],m=Math.max(s.a+1,Math.min(s.b-1,s.index));spans.splice(index,1,fitSpan(points,tangents,s.a,m,4),fitSpan(points,tangents,m,s.b,4));}
    // Only long, demonstrably straight spans lock a shared tangent. Neighbours are refitted to the same direction.
    const locks=new Map();for(const s of spans){const chord=sub(s.s.p3,s.s.p0),len=norm(chord),u=unit(chord);if(len<12)continue;let e=0;for(let i=s.a;i<=s.b;i++)e=Math.max(e,Math.abs(cross(sub(points[i%n],s.s.p0),u)));if(e<.16&&dot(u,tangents[s.a%n])>.9995&&dot(u,tangents[s.b%n])>.9995){if([s.a%n,s.b%n].every(i=>!locks.has(i)||dot(locks.get(i),u)>.99999)){locks.set(s.a%n,u);locks.set(s.b%n,u);}}}
    for(const [i,t]of locks)tangents[i]=t;spans=spans.map(s=>fitSpan(points,tangents,s.a,s.b,4));
    return {segments:validSegments(spans.map(s=>s.s)),fittingResidual:Math.max(...spans.map(s=>s.error)),budgetHit:spans.length>=budget};
  }
  // Closed Douglas–Peucker simplification, seeded by two far-apart source nodes.
  // The polygon follows concavities; it is not a convex hull or a curve relabelled I.
  function polygonKnots(points,tolerance,budget) {
    const n=points.length;
    const farthest=i=>points.reduce((best,p,j)=>dist(p,points[i])>dist(points[best],points[i])?j:best,0);
    const start=farthest(0),opposite=farthest(start),end=(opposite-start+n)%n;
    const at=i=>points[(start+i)%n];
    const span=(a,b)=>{let error=0,index=-1;for(let i=a+1;i<b;i++){const d=pointSegment(at(i),at(a),at(b));if(d>error){error=d;index=i;}}return {a,b,error,index};};
    const spans=[span(0,end),span(end,n)];
    while(spans.length<budget){let worst=-1;for(let i=0;i<spans.length;i++)if(spans[i].index>=0&&(spans[i].error>tolerance||spans.length<3)&&(worst<0||spans[i].error>spans[worst].error))worst=i;
      if(worst<0)break;const s=spans[worst];spans.splice(worst,1,span(s.a,s.index),span(s.index,s.b));}
    return {knots:spans.map(s=>({point:at(s.a).slice(),sourceIndex:(start+s.a)%n})),error:Math.max(...spans.map(s=>s.error)),budgetHit:spans.some(s=>s.error>tolerance)};
  }
  function fitLinearStage(points,tolerance,budget,allowC=false,polygonFactor=.85,curveAllowance=0,phase=0,memo=new Map()) {
    if(budget<3)throw Error('闭合轮廓至少需要3条线段。');
    const cacheKey=phase+':'+polygonFactor+':'+(allowC?'C':budget);if(memo.has(cacheKey)){const cached=memo.get(cacheKey);return cached.segments.length<=budget?cached:fitLinearStage(points,tolerance,budget,allowC,polygonFactor*1.15,curveAllowance,phase,memo);}
    const polygon=polygonKnots(points,tolerance*(allowC?polygonFactor:1),allowC?128:budget),rawKnots=polygon.knots,shift=Math.floor(rawKnots.length*phase),knots=[...rawKnots.slice(shift),...rawKnots.slice(0,shift)],n=knots.length;
    const lines=knots.map((k,i)=>segmentFromLine(k.point,knots[(i+1)%n].point));
    if(!allowC)return {segments:lines,fittingResidual:polygon.error,budgetHit:polygon.budgetHit,representation:'I-only'};
    const candidates=[],sampleCount=points.length;
    // Replace several polygon edges by one broad C only when endpoint tangents
    // agree with the neighbouring I segments and the source residual is bounded.
    for(let start=0;start<n;start++)for(let span=1;span<=Math.min(16,n-2)&&start+span<n;span++){
      const end=start+span,a=knots[start].sourceIndex,b0=knots[end].sourceIndex,b=b0<=a?b0+sampleCount:b0;
      const before=lines[(start+n-1)%n],after=lines[end],tangents={};
      tangents[a]=unit(sub(before.p3,before.p0));tangents[b%sampleCount]=unit(sub(after.p3,after.p0));
      const candidate=fitSpan(points,tangents,a,b,2);
      // Every source sample is within polygon.error of its own polygon edge.
      // Reject impossible replacements before the expensive nearest-edge pass.
      if(kind(candidate.s)!=='C'||candidate.error>=Math.max(polygon.error*.95,span>1?tolerance*.9:0))continue;
      let lineError=0;
      for(let j=a+1;j<b;j++){let nearest=Infinity;for(let edge=start;edge<end;edge++)nearest=Math.min(nearest,pointSegment(points[j%sampleCount],lines[edge].p0,lines[edge].p3));lineError=Math.max(lineError,nearest);}
      if(kind(candidate.s)!=='C'||!(candidate.error<lineError*.95||span>1&&candidate.error<tolerance*.9))continue;
      candidates.push({start,end,span,s:candidate.s,error:candidate.error,gain:lineError-candidate.error});
    }
    candidates.sort((a,b)=>b.span-a.span||b.gain-a.gain||a.error-b.error);
    const used=new Set(),protectedEdges=new Set(),starts=new Map();
    let lineCount=n,curves=0,residual=polygon.error;
    for(const c of candidates){
      let conflict=false;for(let i=c.start;i<c.end;i++)if(used.has(i)||protectedEdges.has(i))conflict=true;
      if(conflict||used.has((c.start+n-1)%n)||used.has(c.end)||lineCount-c.span+curveAllowance<curves+1)continue;
      for(let i=c.start;i<c.end;i++)used.add(i);
      protectedEdges.add((c.start+n-1)%n);protectedEdges.add(c.end);starts.set(c.start,c);
      lineCount-=c.span;curves++;
    }
    const segments=[];for(let i=0;i<n;i++){if(starts.has(i))segments.push(starts.get(i).s);else if(!used.has(i))segments.push(lines[i]);}
    residual=0;for(let i=0;i<n;i++){if(starts.has(i))residual=Math.max(residual,starts.get(i).error);else if(!used.has(i)){const a=knots[i].sourceIndex,b0=knots[(i+1)%n].sourceIndex,b=b0<=a?b0+sampleCount:b0;for(let j=a+1;j<b;j++)residual=Math.max(residual,pointSegment(points[j%sampleCount],lines[i].p0,lines[i].p3));}}
    const result={segments,fittingResidual:residual,budgetHit:residual>tolerance,representation:'I/C-balanced-no-S'};memo.set(cacheKey,result);return segments.length<=budget?result:fitLinearStage(points,tolerance,budget,allowC,polygonFactor*1.15,curveAllowance,phase,memo);
  }
  const TYPE_KEYS=['I','C','S'];
  function stageSettings(value={},defaults) {
    const maxParts=Number(value.maxParts??defaults.maxParts);
    if(!Number.isInteger(maxParts)||maxParts<1||maxParts>300)throw Error('子轮廓上限须为 1～300 的整数。');
    const weights=Object.fromEntries(TYPE_KEYS.map(k=>[k,Number(value.ratios?.[k]??defaults.ratios[k])]));
    if(TYPE_KEYS.some(k=>!Number.isFinite(weights[k])||weights[k]<0)||!TYPE_KEYS.some(k=>weights[k]>0))throw Error('I/C/S 权重须非负，且至少一项大于零。');
    const sum=TYPE_KEYS.reduce((a,k)=>a+weights[k],0),ratios=Object.fromEntries(TYPE_KEYS.map(k=>[k,weights[k]*100/sum]));
    return {maxParts,ratios};
  }
  function ratioAudit(counts,ratios) {
    const total=TYPE_KEYS.reduce((a,k)=>a+(counts[k]||0),0),actual=Object.fromEntries(TYPE_KEYS.map(k=>[k,total?100*(counts[k]||0)/total:0]));
    const deviation=TYPE_KEYS.reduce((a,k)=>a+Math.abs(actual[k]-ratios[k]),0)/2;
    return {target:ratios,actual,deviation,close:deviation<=12.5,counting:'part-sides/shared-twice',softTarget:true};
  }
  const countKinds=segments=>{const counts={I:0,C:0,S:0};for(const s of segments){const k=kind(s);if(k in counts)counts[k]++;}return counts;};
  const halfPolicy=(preferShort,policy)=>preferShort&&!policy?.ratios;
  // Preference operates on genuine geometry: exact S splits and bounded straightening.
  // Fixed endpoints and neighbouring tangents retain a closed G1 outline.
  function outerTypeTargets(ratios,outerCount,partCount,interiorNodes=0,fixedShared={C:0,S:0}) {
    const shared=2*Math.max(0,partCount+interiorNodes-1),total=outerCount+shared,weights={I:Math.max(0,ratios.I*total/100-(shared-fixedShared.C-fixedShared.S)),C:Math.max(0,ratios.C*total/100-fixedShared.C),S:Math.max(0,ratios.S*total/100-fixedShared.S)},sum=weights.I+weights.C+weights.S;
    return Object.fromEntries(TYPE_KEYS.map(k=>[k,sum?weights[k]*100/sum:ratios[k]]));
  }
  function curvePoint(s,t){return bez(s.curveDefinition,t);}
  function sameC(a,b){return kind(a)==='C'&&kind(b)==='C'&&a.curveId!==undefined&&a.curveId===b.curveId&&a.curveDefinition&&b.curveDefinition&&kind(a.curveDefinition)==='C'&&Math.abs(a.curveT1-b.curveT0)<1e-9&&['p0','p1','p2','p3'].every(k=>dist(a.curveDefinition[k],b.curveDefinition[k])<1e-9)&&[a,b].every(s=>[0,.25,.5,.75,1].every(t=>dist(bez(s,t),curvePoint(s,s.curveT0+(s.curveT1-s.curveT0)*t))<1e-7));}
  function hasAdjacentC(segments){return segments.some((s,i)=>kind(s)==='C'&&kind(segments[(i+1)%segments.length])==='C'&&!sameC(s,segments[(i+1)%segments.length]));}
  function splitDeclared(s,t){const mid=s.curveT0+(s.curveT1-s.curveT0)*t;return split(s,t).map((p,i)=>({...s,...p,curveT0:i?mid:s.curveT0,curveT1:i?s.curveT1:mid}));}
  function curveInterval(root,a,b){const low=Math.min(a,b),high=Math.max(a,b);let s=high<1?split(root,high)[0]:root;if(low>0)s=split(s,low/high)[1];return a>b?reversedSegment(s):s;}
  function logicalOutline(segments){const groups=[];for(const s of segments){const prev=groups.at(-1);if(prev&&sameC(prev.at(-1),s))prev.push(s);else groups.push([s]);}
    if(groups.length>1&&sameC(groups.at(-1).at(-1),groups[0][0])){groups[0]=[...groups.pop(),...groups[0]];}
    const items=groups.map(g=>{const first=g[0],last=g.at(-1);return g.length>1?{...first,...curveInterval(first.curveDefinition,first.curveT0,last.curveT1),curveT1:last.curveT1,endNode:last.endNode,edgeParts:g.map(s=>s.id??s.edge??null)}:first;});
    return decorate(items).map((s,i)=>({...s,startNode:items[i].startNode,endNode:items[i].endNode}));
  }
  function hasAdjacentS(segments){return segments.some((s,i)=>kind(s)==='S'&&kind(segments[(i+1)%segments.length])==='S');}
  function limitS(segments,fraction,maxParts,interiorNodes=0,reservedS=0) {
    let out=separateS(segments);
    while((countKinds(out).S+reservedS)/(out.length+2*Math.max(0,maxParts+interiorNodes-1))>fraction+1e-10){
      const candidates=out.map((s,i)=>({i,s,length:dist(s.p0,s.p1)+dist(s.p1,s.p2)+dist(s.p2,s.p3)})).filter(x=>kind(x.s)==='S').sort((a,b)=>a.length-b.length);
      if(!candidates.length)break;const {i,s}=candidates[0],root=inflections(s)[0],pieces=split(s,root).map((p,j)=>({...s,...p,...(s.baseT0!==undefined?{baseT0:j?s.baseT0+(s.baseT1-s.baseT0)*root:s.baseT0,baseT1:j?s.baseT1:s.baseT0+(s.baseT1-s.baseT0)*root}:{})}));out.splice(i,1,...pieces);
    }
    return out;
  }
  function separateS(segments) {
    const out=[];for(const s of segments){if(kind(s)==='S'&&out.length&&kind(out.at(-1))==='S')out.push(...split(s,inflections(s)[0]).map(p=>({...s,...p})));else out.push(s);}
    if(out.length>1&&kind(out[0])==='S'&&kind(out.at(-1))==='S'){const last=out.pop();out.push(...split(last,inflections(last)[0]).map(p=>({...last,...p})));}return out;
  }
  function typedPreference(segments,ratios,tolerance) {
    let current=segments.flatMap(s=>ratios.S===0&&kind(s)==='S'?split(s,inflections(s)[0]).map(p=>({...s,...p})):[s]);
    if(ratios.I===0)return current;
    const candidates=current.map((s,i)=>({i,error:Math.max(...Array.from({length:17},(_,j)=>pointSegment(bez(s,j/16),s.p0,s.p3)))})).filter(c=>kind(current[c.i])!=='I').sort((a,b)=>a.error-b.error);
    for(const c of candidates){
      const beforeScore=ratioAudit(countKinds(current),ratios).deviation;if(beforeScore<1)break;
      if(c.error>tolerance*(.4+2.6*ratios.I/100))continue;
      const trial=current.map(s=>({...s})),i=c.i,n=trial.length,prev=trial[(i+n-1)%n],next=trial[(i+1)%n],s=trial[i],direction=unit(sub(s.p3,s.p0));trial[i]={...s,...segmentFromLine(s.p0,s.p3)};
      if(kind(prev)!=='I')prev.p2=sub(prev.p3,mul(direction,dist(prev.p2,prev.p3)));
      if(kind(next)!=='I')next.p1=add(next.p0,mul(direction,dist(next.p1,next.p0)));
      if([prev,next].some((s,j)=>dist(s[j?'p1':'p2'],current[(i+(j?1:n-1))%n][j?'p1':'p2'])>tolerance*2))continue;
      const decorated=decorate(trial);if(!audit(decorated,true).valid||ratios.S===0&&trial.some(s=>kind(s)==='S'))continue;
      if(ratioAudit(countKinds(trial),ratios).deviation<beforeScore)current=trial;
    }
    return current;
  }
  // Fit broad bends before partitioning. A seam may later split one logical
  // curve, but no new bend or fake edge is introduced to satisfy a side quota.
  function mergeCurves(segments,tolerance=.8) {
    let out=segments.slice(),merges=0;
    for(let pass=0;pass<segments.length;pass++){
      let found=false;
      for(let i=0;i<out.length;i++){
        const j=(i+1)%out.length,a=out[i],b=out[j];if(out.length<=3||kind(a)!=='C'||kind(b)!=='C'||Math.sign(curvature(a,.5))!==Math.sign(curvature(b,.5)))continue;
        if(dot(unit(sub(a.p3,a.p2)),unit(sub(b.p1,b.p0)))<1-1e-8)continue;
        const points=[...Array.from({length:33},(_,k)=>bez(a,k/32)),...Array.from({length:32},(_,k)=>bez(b,(k+1)/32))],tangents={0:unit(sub(a.p1,a.p0)),64:unit(sub(b.p3,b.p2))};
        const fitted=fitSpan(points,tangents,0,64,8).s;if(kind(fitted)!=='C')continue;
        const error=deviation(points,Array.from({length:65},(_,k)=>bez(fitted,k/64)));if(error>tolerance)continue;
        const trial=j===0?[fitted,...out.slice(1,i)]:[...out.slice(0,i),fitted,...out.slice(j+1)];
        if(!audit(decorate(trial),true).valid)continue;out=trial;merges++;found=true;break;
      }
      if(!found)break;
    }
    return {segments:out,merges};
  }
  function fittingVariants(points,tolerance,budget,ratios,curveAllowance,cache={}) {
    const out=[];
    for(const phase of (ratios.C>0?[0,.25,.5,.75]:[0])){const key='linear'+phase,f=cache[key]?.segments.length<=budget?cache[key]:fitLinearStage(points,tolerance,budget,ratios.C>0,.85,curveAllowance,phase,cache.linearMemo||(cache.linearMemo=new Map()));cache[key]=f;out.push(f);}
    if(ratios.S>0){
      const f=cache.curved?.segments.length<=budget?cache.curved:fit(points,tolerance,budget);cache.curved=f;const typed=typedPreference(f.segments,ratios,tolerance),merged=mergeCurves(typed,Math.min(.8,tolerance*.25));
      if(merged.segments.length<=budget&&!(ratios.S===0&&merged.segments.some(s=>kind(s)==='S')))out.push({...f,segments:merged.segments,merges:merged.merges,representation:'source-fitted-I/C/S'});
    }
    return out;
  }
  function curvature(s,t){const [d,dd]=derivatives(s,t),l=norm(d);return l>1e-7?cross(d,dd)/(l*l*l):0;}
  function jumpEnergy(segments){let e=0;for(let i=0;i<segments.length;i++){const a=curvature(segments[i],1),b=curvature(segments[(i+1)%segments.length],0);e+=(a-b)**2;}return e;}
  function refine(segments,budget=.65) {
    let current=segments.map(s=>Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('p')).map(([k,v])=>[k,v.slice()]))),best=jumpEnergy(current);const initial=best;
    for(let round=0;round<5;round++)for(let i=0;i<current.length;i++)for(const key of ['p1','p2']){if(kind(segments[i])==='I')continue;const s=current[i],base=key==='p1'?s.p0:s.p3,dir=unit(sub(s[key],base)),old=s[key];let selected=old;
      for(const sign of [-1,1]){const candidate=add(old,mul(dir,sign*budget/(round+2)));if(dist(candidate,segments[i][key])>budget||dot(sub(candidate,base),dir)<=.001)continue;s[key]=candidate;if(inflections(s).length>1){s[key]=old;continue;}const e=jumpEnergy(current);if(e<best-1e-12){best=e;selected=candidate;}s[key]=old;}s[key]=selected;}
    return {segments:current,initialJump:initial,finalJump:best,handleBudget:budget,pointwiseBound:.75*budget};
  }
  function decorate(segments) {
    const out=segments.map((s,i)=>{const prev=segments[(i+segments.length-1)%segments.length],u=unit(sub(prev.p3,prev.p2)),v=unit(sub(s.p1,s.p0));return {...s,startNode:i,endNode:(i+1)%segments.length,kind:kind(s),smooth:dot(u,v)>1-1e-10,group:0};});let group=0;for(let i=0;i<out.length;i++){if(i&&out[i].kind!==out[i-1].kind)group++;out[i].group=group;}if(group&&out[0].kind===out.at(-1).kind){const last=out.at(-1).group;for(const s of out)if(s.group===last)s.group=0;}
    return out;
  }
  const reversedSegment=s=>({...s,p0:s.p3.slice(),p1:s.p2.slice(),p2:s.p1.slice(),p3:s.p0.slice(),...(s.curveT0!==undefined?{curveT0:s.curveT1,curveT1:s.curveT0}:{}),...(s.baseT0!==undefined?{baseT0:s.baseT1,baseT1:s.baseT0}:{})});
  const edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a;
  function parallelMeasure(segments) {
    const n=segments.length;
    let best={parallelAngle:180,capAngle:90,axis:0,penalty:10};
    if(n>=4&&n<=6)for(let i=0;i<n;i++)for(const offset of n===6?[2,3]:[2]){
      const j=(i+offset)%n,a=unit(sub(segments[i].p3,segments[i].p0)),b=unit(sub(segments[j].p3,segments[j].p0)),axis=unit(sub(a,b));
      const cap1=unit(sub(segments[j].p0,segments[i].p3)),cap2=unit(sub(segments[i].p0,segments[j].p3));
      const parallelAngle=Math.acos(Math.max(-1,Math.min(1,-dot(a,b))))*180/Math.PI;
      const capAngle=Math.asin(Math.min(1,Math.max(Math.abs(dot(axis,cap1)),Math.abs(dot(axis,cap2)))))*180/Math.PI;
      const penalty=parallelAngle/45+capAngle/45;if(penalty<best.penalty)best={parallelAngle,capAngle,axis:i,penalty};
    }
    return best;
  }
  // A sixth side can restore parallel sides or retain a real source-boundary
  // corner that a five-sided cell would lose. Collinear padding is rejected.
  // This uses endpoint chords, so near-stage handle fitting keeps the same rule.
  function polygonShape(points){
    const orientation=area(points)>=0?1:-1,angles=points.map((p,i)=>{const a=sub(p,points[(i+points.length-1)%points.length]),b=sub(points[(i+1)%points.length],p);return 180-orientation*Math.atan2(cross(a,b),dot(a,b))*180/Math.PI;}),reflexCount=angles.filter(a=>a>180+1e-5).length,convex=reflexCount===0,strictConvex=convex&&angles.every(a=>a<180-1e-5&&a>1e-5),hullArea=Math.abs(area(hull(points))),concavityRatio=hullArea?Math.max(0,1-Math.abs(area(points))/hullArea):0,minInteriorAngle=Math.min(...angles),spikePenalty=angles.reduce((sum,a)=>sum+Math.max(0,(30-a)/30)**2,0);
    return {convex,strictConvex,reflexCount,concavityRatio,minInteriorAngle,spikePenalty};
  }
  function partSidePolicy(segments) {
    const n=segments.length;
    if(n<=STANDARD_PART_EDGE_LIMIT)return {valid:n>=3,mode:'standard',defaultLimit:5,maxLimit:6};
    if(n!==PART_EDGE_LIMIT)return {valid:false,mode:'too-many-sides',defaultLimit:5,maxLimit:6};
    const six=parallelMeasure(segments),bestPairAngle=items=>{let best=180;for(let i=0;i<items.length;i++)for(let j=i+2;j<items.length;j++){if(i===0&&j===items.length-1)continue;const a=unit(sub(items[i].p3,items[i].p0)),b=unit(sub(items[j].p3,items[j].p0));best=Math.min(best,Math.acos(Math.max(-1,Math.min(1,-dot(a,b))))*180/Math.PI);}return best;};
    const sixAngle=bestPairAngle(segments);let best=null;
    if(sixAngle<=PARALLEL_DEGREES)for(let i=0;i<n;i++){
      const ordered=segments.slice(i).concat(segments.slice(0,i)),a=ordered[0],b=ordered[1];if(dist(a.p0,b.p3)<1e-8)continue;
      const five=[segmentFromLine(a.p0,b.p3),...ordered.slice(2)],anchors=five.map(s=>s.p0);
      if(area(anchors)<=1e-6||intersections(anchors))continue;
      const angle=bestPairAngle(five);
      const error=pointSegment(a.p3,a.p0,b.p3);
      if(!best||error<best.coarseningError-1e-7||Math.abs(error-best.coarseningError)<=1e-7&&angle<best.fiveParallelAngle)best={removedNode:(i+1)%n,fiveParallelAngle:angle,sixParallelAngle:sixAngle,coarseningError:error};
    }
    const parallelException=!!best&&best.fiveParallelAngle>PARALLEL_DEGREES&&best.fiveParallelAngle>sixAngle+1e-5;
    // A protected partition junction cannot be removed to make a five-sided
    // cell. For source-boundary corners, measure the detail a five-sided
    // approximation would lose, even if that pentagon already has parallel sides.
    const xs=segments.map(s=>s.p0[0]),ys=segments.map(s=>s.p0[1]),detailTolerance=Math.max(.5,.005*Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))),native=s=>s.role==='outer'||s.role==='hole'||s.role===undefined&&s.sourceLoop!==undefined;
    let detail=null;if(sixAngle<=PARALLEL_DEGREES)for(let i=0;i<n;i++){const a=segments[i],b=segments[(i+1)%n];if(!native(a)||!native(b)||a.sourceLoop!==undefined&&b.sourceLoop!==undefined&&a.sourceLoop!==b.sourceLoop)continue;const error=pointSegment(a.p3,a.p0,b.p3);if(!detail||error<detail.retainedBoundaryOffset)detail={detailCorner:(i+1)%n,retainedBoundaryOffset:error};}
    const fidelityException=!!detail&&detail.retainedBoundaryOffset>detailTolerance,shape=polygonShape(segments.map(s=>s.p0)),convexException=shape.strictConvex&&sixAngle<=PARALLEL_DEGREES;
    return {valid:parallelException||fidelityException||convexException,mode:parallelException?'nonparallel-five-to-six':fidelityException?'boundary-fidelity-six':convexException?'convex-six':'six-rejected',defaultLimit:5,maxLimit:6,thresholdDegrees:PARALLEL_DEGREES,...(best||{sixParallelAngle:sixAngle}),axis:six.axis,...(fidelityException?{...detail,detailTolerance}:{}),...(convexException?{preservesConvexity:true,minInteriorAngle:shape.minInteriorAngle}:{})};
  }
  function rectangularity(segments) {
    const samples=segments.flatMap(s=>Array.from({length:9},(_,j)=>bez(s,j/9))),rect=rectangle(samples),filledArea=Math.abs(area(samples));
    const fillRatio=rect?.area?Math.min(1,filledArea/rect.area):0,n=segments.length,best=parallelMeasure(segments);
    const lengths=rect?.points.map((p,i)=>dist(p,rect.points[(i+1)%4]))||[1],aspect=Math.max(...lengths)/Math.max(1e-6,Math.min(...lengths));
    const score=4*(1-fillRatio)+2*best.parallelAngle/90+best.capAngle/90+(n<4?8:0)+(n===6?.45:0)+Math.max(0,aspect-4)*.04;
    const shortScore=score+1.5*Math.max(0,aspect-1.5)**2;
    const shape=polygonShape(segments.map(s=>s.p0)),middleScore=shortScore+12*shape.concavityRatio+2*shape.reflexCount+6*shape.spikePenalty;
    return {...best,...shape,fillRatio,aspect,area:filledArea,score,shortScore,middleScore,passes:n>=4&&fillRatio>=.65&&best.parallelAngle<=PARALLEL_DEGREES&&best.capAngle<=25};
  }
  function faceBoundarySegments(nodes,outer) {return nodes.map((a,j)=>{const b=nodes[(j+1)%nodes.length];return (a+1)%outer.length===b?{...outer[a],role:outer[a].role||'outer'}:(b+1)%outer.length===a?{...reversedSegment(outer[b]),role:outer[b].role||'outer'}:{...segmentFromLine(outer[a].p0,outer[b].p0),role:'internal'};});}
  // Triangulate the anchor polygon, retaining the actual outer cubic edges.
  // Each diagonal must also stay inside the curved boundary, not just its chords.
  function triangulateContour(segments,variant=0) {
    const points=segments.map(s=>s.p0),n=points.length,flat=flatten(segments,.8),bins=new Map(),step=8,cache=new Map();
    for(let i=0;i<flat.length;i++){const a=flat[i],b=flat[(i+1)%flat.length];for(let y=Math.floor(Math.min(a[1],b[1])/step);y<=Math.floor(Math.max(a[1],b[1])/step);y++){if(!bins.has(y))bins.set(y,[]);bins.get(y).push(i);}}
    const inside=p=>{let parity=false;for(const i of bins.get(Math.floor(p[1]/step))||[]){const a=flat[i],b=flat[(i+1)%flat.length];if(pointSegment(p,a,b)<.025)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])parity=!parity;}return parity;};
    const diagonal=(a,b)=>{
      const key=edgeKey(a,b);if(cache.has(key))return cache.get(key);const p=points[a],q=points[b],length=dist(p,q);let valid=true;
      for(let j=1,steps=Math.max(8,Math.ceil(length/1.5));j<steps;j++)if(!inside(mix(p,q,j/steps))){valid=false;break;}
      if(valid)for(let i=0;i<flat.length;i++){const x=flat[i],y=flat[(i+1)%flat.length];if(dist(p,x)<.03||dist(p,y)<.03||dist(q,x)<.03||dist(q,y)<.03)continue;const d=sub(q,p),e=sub(y,x);if(cross(d,sub(x,p))*cross(d,sub(y,p))< -1e-8&&cross(e,sub(p,x))*cross(e,sub(q,x))< -1e-8){valid=false;break;}}
      cache.set(key,valid);return valid;
    };
    const remaining=points.map((_,i)=>i),triangles=[];
    while(remaining.length>3){let selected=-1,best=Infinity;
      for(let j=0;j<remaining.length;j++){
        const a=remaining[(j+remaining.length-1)%remaining.length],b=remaining[j],c=remaining[(j+1)%remaining.length],p=points[a],q=points[b],r=points[c],turn=cross(sub(q,p),sub(r,q));
        if(turn<=1e-7||!diagonal(a,c))continue;
        let occupied=false;for(const k of remaining)if(k!==a&&k!==b&&k!==c){const v=points[k];if(cross(sub(q,p),sub(v,p))>=-1e-7&&cross(sub(r,q),sub(v,q))>=-1e-7&&cross(sub(p,r),sub(v,r))>=-1e-7){occupied=true;break;}}
        if(occupied)continue;
        const length=dist(p,r),score=variant===0?length:variant===1?length*length/(turn+.01):variant===2?-length:variant===3?turn:variant===4?-turn:variant===5?j:-j;
        if(score<best){selected=j;best=score;}
      }
      if(selected<0)return null;const j=selected;triangles.push([remaining[(j+remaining.length-1)%remaining.length],remaining[j],remaining[(j+1)%remaining.length]]);remaining.splice(j,1);
    }
    triangles.push(remaining.slice());return triangles;
  }
  function partBoundary(triangles,ids) {
    const edges=new Map();for(const id of ids){const t=triangles[id];for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],key=edgeKey(a,b);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}}
    const next=new Map();for(const [a,b]of edges.values()){if(next.has(a))return null;next.set(a,b);}const start=next.keys().next().value,boundary=[];let cur=start;
    do{boundary.push(cur);cur=next.get(cur);if(cur===undefined||boundary.length>edges.size)return null;}while(cur!==start);
    return boundary.length===edges.size?boundary:null;
  }
  // Exact small-state DP on the triangulation dual tree. A group of <=3
  // adjacent triangles has <=6 boundary edges; a six-sided group must pass
  // the nonparallel-pentagon exception, including shared separators.
  function groupTriangles(triangles,segments,requireHalfC,maxParts,all=false,policy) {
    const n=segments.length,adj=triangles.map(()=>[]),owners=new Map();
    for(let id=0;id<triangles.length;id++)for(let j=0;j<3;j++){const a=triangles[id][j],b=triangles[id][(j+1)%3],key=edgeKey(a,b);if(owners.has(key)){const other=owners.get(key);adj[id].push({id:other,a,b});adj[other].push({id,a,b});}else owners.set(key,id);}
    const curves=ids=>{const b=partBoundary(triangles,ids);if(!b)return Infinity;let count=0;for(let j=0;j<b.length;j++)if((b[j]+1)%n===b[(j+1)%b.length]&&segments[b[j]].kind==='C')count++;return count;};
    const qualityCache=new Map(),wholeArea=Math.max(1,Math.abs(area(flatten(segments,2))));
    const penalty=ids=>{const key=ids.slice().sort((a,b)=>a-b).join(':');if(!qualityCache.has(key)){const b=partBoundary(triangles,ids),q=b?rectangularity(faceBoundarySegments(b,segments)):null;qualityCache.set(key,q?(requireHalfC?q.middleScore:q.score)*q.area/wholeArea+0.015:1e6);}return qualityCache.get(key);};
    const allowedCache=new Map(),allowed=ids=>{const key=ids.slice().sort((a,b)=>a-b).join(':');if(!allowedCache.has(key)){const b=partBoundary(triangles,ids);allowedCache.set(key,!!b&&b.length<=PART_EDGE_LIMIT&&(b.length<=STANDARD_PART_EDGE_LIMIT||partSidePolicy(faceBoundarySegments(b,segments)).valid));}return allowedCache.get(key);};
    const outerC=segments.filter(s=>s.kind==='C').length,outerI=segments.filter(s=>s.kind==='I').length,minParts=halfPolicy(requireHalfC,policy)?Math.max(1,Math.ceil((outerC-outerI)/2)+1):1;
    function visit(id,parent){let states=[{open:[id],closed:[],cost:0}];
      for(const child of adj[id])if(child.id!==parent){const children=visit(child.id,id),best=new Map();
        const retain=s=>{if(s.closed.length>=maxParts)return;const key=s.open.slice().sort((a,b)=>a-b).join(',')+':'+s.closed.length,old=best.get(key);if(!old||s.cost<old.cost)best.set(key,s);};
        for(const a of states)for(const b of children){
          if(allowed(b.open))retain({open:a.open,closed:[...a.closed,...b.closed,b.open],cost:a.cost+b.cost+penalty(b.open)+dist(segments[child.a].p0,segments[child.b].p0)*.00005});
          if(a.open.length+b.open.length<=PART_EDGE_LIMIT-2)retain({open:[...a.open,...b.open],closed:[...a.closed,...b.closed],cost:a.cost+b.cost});
        }
        states=[...best.values()];
      }
      return states;
    }
    const candidates=visit(0,-1).filter(s=>allowed(s.open)&&s.closed.length+1>=minParts&&s.closed.length+1<=maxParts).sort((a,b)=>a.cost+penalty(a.open)-b.cost-penalty(b.open));
    if(all){const best=new Map();for(const c of candidates){const count=c.closed.length+1;if(!best.has(count))best.set(count,[...c.closed,c.open].map(ids=>partBoundary(triangles,ids)));}return [...best.values()];}
    return candidates.length?[...candidates[0].closed,candidates[0].open].map(ids=>partBoundary(triangles,ids)):null;
  }
  function partitionContourOptions(segments,maxParts) {const choices=new Map();if(segments.length<=PART_EDGE_LIMIT){const direct=buildPartition(segments,[segments.map((_,i)=>i)],maxParts);if(direct.audit.valid)choices.set(1,direct);}for(let variant=0;variant<7;variant++){const triangles=triangulateContour(segments,variant);if(!triangles)continue;for(const groups of groupTriangles(triangles,segments,false,maxParts,true)){const built=buildPartition(segments,groups,maxParts);const old=choices.get(groups.length);if(built.audit.valid&&(!old||built.audit.shapeCost<old.audit.shapeCost))choices.set(groups.length,built);}}return [...choices.values()];}
  function partitionContour(segments,maxParts,requireHalfC=false,policy) {
    if(segments.length<=PART_EDGE_LIMIT){const direct=buildPartition(segments,[segments.map((_,i)=>i)],maxParts,requireHalfC,policy);if(direct.audit.valid)return direct;}
    let chosen=null;
    for(let variant=0;variant<7;variant++){
      const triangles=triangulateContour(segments,variant);if(!triangles)continue;
      const groups=groupTriangles(triangles,segments,requireHalfC,maxParts,false,policy);if(!groups||groups.length>maxParts)continue;
      const built=buildPartition(segments,groups,maxParts,requireHalfC,policy);
      if(built.audit.valid&&(!chosen||built.audit.shapeCost<chosen.audit.shapeCost))chosen=built;
    }
    return chosen;
  }
  function partitionWithSeamNodes(segments,maxParts,requireHalfC,outerBudget,policy) {
    if(policy?.noAdjacentC&&hasAdjacentC(segments))return null;
    if(policy?.noAdjacentC)segments=segments.map((s,i)=>({...s,curveId:i,curveT0:0,curveT1:1,curveDefinition:Object.fromEntries(['p0','p1','p2','p3'].map(k=>[k,s[k].slice()]))}));
    const direct=partitionContour(segments,maxParts,requireHalfC,policy);if(direct)return {segments,partition:direct};
    if(segments.length>=outerBudget)return null;
    const ranked=segments.map((s,i)=>({i,kind:kind(s),length:dist(s.p0,s.p1)+dist(s.p1,s.p2)+dist(s.p2,s.p3)})).sort((a,b)=>b.length-a.length);
    for(const item of ranked){
      const candidate=decorate([...segments.slice(0,item.i),...(policy?.noAdjacentC?splitDeclared(segments[item.i],.5):split(segments[item.i],.5)),...segments.slice(item.i+1)]),partition=partitionContour(candidate,maxParts,requireHalfC,policy);
      // The extra node is permitted only when it actually hosts a shared cut.
      if(partition&&partition.partitionEdges.some(e=>e.role==='internal'&&(e.startNode===item.i+1||e.endNode===item.i+1)))return {segments:candidate,partition};
    }
    if(segments.length+2<=outerBudget)for(let i=0;i<Math.min(8,ranked.length);i++)for(let j=i+1;j<Math.min(8,ranked.length);j++){
      const cuts=new Set([ranked[i].i,ranked[j].i]),pieces=[],newNodes=[];
      for(let k=0;k<segments.length;k++){if(cuts.has(k)){newNodes.push(pieces.length+1);pieces.push(...(policy?.noAdjacentC?splitDeclared(segments[k],.5):split(segments[k],.5)));}else pieces.push(segments[k]);}
      const candidate=decorate(pieces),partition=partitionContour(candidate,maxParts,requireHalfC,policy);
      if(partition&&newNodes.every(node=>partition.partitionEdges.some(e=>e.role==='internal'&&(e.startNode===node||e.endNode===node))))return {segments:candidate,partition};
    }
    return null;
  }
  function buildPartition(segments,groups,maxParts,requireHalfC=false,policy) {
    const n=segments.length,edges=[],edgeMap=new Map(),subcontours=[];
    for(let id=0;id<groups.length;id++){
      const nodes=groups[id],refs=[],parts=[];
      for(let j=0;j<nodes.length;j++){
        const a=nodes[j],b=nodes[(j+1)%nodes.length],key=edgeKey(a,b);let s,role;
        if((a+1)%n===b){s=segments[a];role='outer';}else if((b+1)%n===a){s=reversedSegment(segments[b]);role='outer';}else{s=segmentFromLine(segments[a].p0,segments[b].p0);role='internal';}
        if(!edgeMap.has(key)){const canonical=a<b?s:reversedSegment(s),edge={...canonical,id:edges.length,startNode:Math.min(a,b),endNode:Math.max(a,b),kind:kind(canonical),role,faces:[]};edgeMap.set(key,edges.length);edges.push(edge);}
        const index=edgeMap.get(key);edges[index].faces.push(id);refs.push({edge:index,reversed:a>b});parts.push({...s,...(a<b?edges[index]:reversedSegment(edges[index])),role,edge:index});
      }
      const decorated=decorate(parts).map((s,j)=>({...s,role:parts[j].role,edge:parts[j].edge,startNode:nodes[j],endNode:nodes[(j+1)%nodes.length]}));
      const flat=flatten(decorated,.8),signedArea=curveArea(decorated),counts={I:0,C:0,S:0};for(const s of decorated)counts[s.kind]=(counts[s.kind]||0)+1;
      subcontours.push({id,boundaryNodes:nodes,edgeRefs:refs,segments:decorated,edgePolicy:partSidePolicy(decorated),regularity:(()=>{const q=rectangularity(decorated);return {...q,score:requireHalfC?q.middleScore:q.score,preferShort:requireHalfC,preferConvex:requireHalfC,passes:q.passes&&(!requireHalfC||q.aspect<=2.5&&q.convex&&q.minInteriorAngle>=25)};})(),area:signedArea,kinds:counts,labelPoint:[flat.reduce((a,p)=>a+p[0],0)/flat.length,flat.reduce((a,p)=>a+p[1],0)/flat.length],valid:partSidePolicy(decorated).valid&&signedArea>1e-6&&!intersections(flat)&&!decorated.some(s=>['INVALID','MULTI'].includes(s.kind))&&(!requireHalfC||policy?.ratios?.S>0||counts.S===0)});
    }
    const outerArea=curveArea(segments),sumArea=subcontours.reduce((s,p)=>s+p.area,0),shared=edges.filter(e=>e.role==='internal'),badIncidence=edges.filter(e=>e.faces.length!==(e.role==='internal'?2:1)).length;
    const adjacency=subcontours.map(()=>[]);for(const e of shared)if(e.faces.length===2){adjacency[e.faces[0]].push(e.faces[1]);adjacency[e.faces[1]].push(e.faces[0]);}const visited=new Set(),queue=[0];while(queue.length){const id=queue.pop();if(visited.has(id))continue;visited.add(id);queue.push(...adjacency[id]);}
    const totalC=subcontours.reduce((a,p)=>a+p.kinds.C,0),totalI=subcontours.reduce((a,p)=>a+p.kinds.I,0),typeQuotaValid=!halfPolicy(requireHalfC,policy)||totalC<=totalI;
    const audit={shapeCost:subcontours.reduce((a,p)=>a+p.regularity.score*p.area/Math.max(1,outerArea),0),regularityPassed:subcontours.every(p=>p.regularity.passes),regularParts:subcontours.filter(p=>p.regularity.passes).length,typeQuotaValid,kinds:{I:totalI,C:totalC,S:subcontours.reduce((a,p)=>a+p.kinds.S,0)},sideCount:subcontours.reduce((a,p)=>a+p.segments.length,0),partCount:subcontours.length,maxParts,maxEdgesPerPart:PART_EDGE_LIMIT,defaultMaxEdgesPerPart:STANDARD_PART_EDGE_LIMIT,parallelToleranceDegrees:PARALLEL_DEGREES,sidePolicy:'five-or-parallel-or-boundary-fidelity-or-convex-six',sixSideCount:subcontours.filter(p=>p.segments.length===6).length,sidePolicyValid:subcontours.every(p=>p.edgePolicy.valid),sharedEdges:shared.length,badIncidence,connected:visited.size===subcontours.length,euler:n-edges.length+subcontours.length,areaDifference:Math.abs(sumArea-outerArea),valid:typeQuotaValid&&subcontours.length>0&&subcontours.length<=maxParts&&subcontours.every(p=>p.valid)&&!badIncidence&&visited.size===subcontours.length&&n-edges.length+subcontours.length===1&&Math.abs(sumArea-outerArea)<1e-5};
    return {subcontours,partitionEdges:edges,audit};
  }
  function flatten(segments,step=1) {const out=[];for(const s of segments){const len=dist(s.p0,s.p1)+dist(s.p1,s.p2)+dist(s.p2,s.p3),n=Math.max(8,Math.ceil(len/step));for(let i=0;i<n;i++)out.push(bez(s,i/n));}return out;}
  function curveArea(segments) {const roots=[.5-Math.sqrt(15)/10,.5,.5+Math.sqrt(15)/10],weights=[5/18,4/9,5/18];let sum=0;for(const s of segments)for(let j=0;j<3;j++)sum+=weights[j]*cross(bez(s,roots[j]),derivatives(s,roots[j])[0])*.5;return sum;}
  function assembleMesh(faces,maxParts) {
    const nodes=[],nodeMap=new Map(),edges=[],edgeMap=new Map(),parts=[];
    const node=p=>{const key=p.map(x=>Math.round(x*1e7)).join(':');if(!nodeMap.has(key)){nodeMap.set(key,nodes.length);nodes.push(p.slice());}return nodeMap.get(key);};
    for(let id=0;id<faces.length;id++){
      const face=faces[id],refs=[],items=[],boundary=[];
      for(let j=0;j<face.segments.length;j++){
        const s=face.segments[j];if(dist(s.p3,face.segments[(j+1)%face.segments.length].p0)>1e-6||dist(s.p0,s.p3)<1e-9)return null;
        const a=node(s.p0),b=node(s.p3),key=edgeKey(a,b),canonical=a<b?s:reversedSegment(s);
        if(!edgeMap.has(key)){edgeMap.set(key,edges.length);edges.push({p0:nodes[Math.min(a,b)],p1:canonical.p1.slice(),p2:canonical.p2.slice(),p3:nodes[Math.max(a,b)],id:edges.length,startNode:Math.min(a,b),endNode:Math.max(a,b),kind:kind(canonical),faces:[],...(canonical.baseEdgeId!==undefined?{baseEdgeId:canonical.baseEdgeId,baseT0:canonical.baseT0,baseT1:canonical.baseT1}:{}),...(canonical.sourceParentEdge!==undefined?{sourceParentEdge:canonical.sourceParentEdge}:{}),...(canonical.sourceLoop!==undefined?{sourceLoop:canonical.sourceLoop}:{})});}
        const e=edges[edgeMap.get(key)];if(['p0','p1','p2','p3'].some(k=>dist(e[k],canonical[k])>1e-5))return null;
        e.faces.push(id);refs.push({edge:e.id,reversed:a>b});boundary.push(a);items.push({...s,...(a<b?e:reversedSegment(e)),edge:e.id,startNode:a,endNode:b});
      }
      const flat=flatten(items,.8),signedArea=curveArea(items),counts={I:0,C:0,S:0};for(const s of items)counts[kind(s)]=(counts[kind(s)]||0)+1;
      const decorated=decorate(items).map((s,j)=>({...s,edge:refs[j].edge,startNode:boundary[j],endNode:boundary[(j+1)%boundary.length]}));
      parts.push({...face,id,boundaryNodes:boundary,edgeRefs:refs,segments:decorated,edgePolicy:partSidePolicy(decorated),area:signedArea,kinds:counts,regularity:rectangularity(items),labelPoint:[flat.reduce((a,p)=>a+p[0],0)/flat.length,flat.reduce((a,p)=>a+p[1],0)/flat.length],valid:items.length>=3&&items.length<=PART_EDGE_LIMIT&&signedArea>1e-6&&!intersections(flat)&&!counts.INVALID&&!counts.MULTI});
    }
    for(const e of edges)e.role=e.faces.length===1?'outer':'internal';
    for(const p of parts)for(const s of p.segments){s.role=edges[s.edge].role;s.kind=kind(s);}
    const next=new Map();for(const e of edges.filter(e=>e.role==='outer')){const p=parts[e.faces[0]],ref=p.edgeRefs.find(r=>r.edge===e.id),s=ref.reversed?reversedSegment(e):e,a=ref.reversed?e.endNode:e.startNode,b=ref.reversed?e.startNode:e.endNode;if(next.has(a))return null;next.set(a,{s,a,b});}
    const usedBoundary=new Set(),rings=[];
    for(const start of next.keys())if(!usedBoundary.has(start)){const ordered=[];let at=start;do{const item=next.get(at);if(!item||usedBoundary.has(at)||ordered.length>next.size)return null;usedBoundary.add(at);ordered.push(item);at=item.b;}while(at!==start);rings.push(decorate(ordered.map(x=>x.s)).map((s,i)=>({...s,startNode:ordered[i].a,endNode:ordered[i].b})));}
    if(!rings.length||usedBoundary.size!==next.size)return null;rings.sort((a,b)=>curveArea(b)-curveArea(a));
    const outer=rings[0],holeCount=rings.filter(r=>curveArea(r)<0).length;for(const r of rings.slice(1))if(curveArea(r)>=0)return null;
    for(const ring of rings.slice(1))for(const s of ring){edges[s.id].role='hole';s.role='hole';}
    for(const p of parts){for(const s of p.segments)s.role=edges[s.edge].role;p.edgePolicy=partSidePolicy(p.segments);p.valid&&=p.edgePolicy.valid;}
    const shared=edges.filter(e=>e.role==='internal'),badIncidence=edges.filter(e=>e.faces.length<1||e.faces.length>2).length,adj=parts.map(()=>[]);
    for(const e of shared)if(e.faces.length===2){adj[e.faces[0]].push(e.faces[1]);adj[e.faces[1]].push(e.faces[0]);}
    const seen=new Set(),queue=[0];while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);queue.push(...adj[id]);}
    const sumArea=parts.reduce((a,p)=>a+p.area,0),outerArea=rings.reduce((sum,r)=>sum+curveArea(r),0),difference=Math.abs(sumArea-outerArea),outerAudit={valid:rings.every(r=>audit(r,true).valid)},kinds={I:0,C:0,S:0};for(const p of parts)for(const k of ['I','C','S'])kinds[k]+=p.kinds[k];
    const boundariesValid=!holeCount||ringsValid(rings.map(r=>r.flatMap(s=>kind(s)==='I'?[s.p0]:Array.from({length:24},(_,i)=>bez(s,i/24)))));
    const valid=boundariesValid&&parts.length<=maxParts&&parts.every(p=>p.valid)&&!badIncidence&&seen.size===parts.length&&nodes.length-edges.length+parts.length===1-holeCount&&difference<1e-5&&outerAudit.valid;
    return {segments:outer,boundaryLoops:rings,holeLoops:rings.slice(1),holeCount,meshNodes:nodes,subcontours:parts,partitionEdges:edges,partitionAudit:{valid,shapeCost:parts.reduce((a,p)=>a+p.regularity.score*p.area/Math.max(1,outerArea),0),regularityPassed:parts.every(p=>p.regularity.passes),regularParts:parts.filter(p=>p.regularity.passes).length,typeQuotaValid:true,kinds,sideCount:parts.reduce((a,p)=>a+p.segments.length,0),partCount:parts.length,maxParts,maxEdgesPerPart:PART_EDGE_LIMIT,defaultMaxEdgesPerPart:STANDARD_PART_EDGE_LIMIT,parallelToleranceDegrees:PARALLEL_DEGREES,sidePolicy:'five-or-parallel-or-boundary-fidelity-or-convex-six',sixSideCount:parts.filter(p=>p.segments.length===6).length,sidePolicyValid:parts.every(p=>p.edgePolicy.valid),sharedEdges:shared.length,badIncidence,connected:seen.size===parts.length,euler:nodes.length-edges.length+parts.length,expectedEuler:1-holeCount,holeCount,areaDifference:difference}};
  }
  function shortPreference(mesh){const total=Math.max(1,mesh.subcontours.reduce((s,p)=>s+p.area,0));for(const p of mesh.subcontours){const q=p.regularity;p.regularity={...q,score:q.middleScore,preferShort:true,preferConvex:true,passes:q.passes&&q.aspect<=2.5&&q.convex&&q.minInteriorAngle>=25};}Object.assign(mesh.partitionAudit,{shapeCost:mesh.subcontours.reduce((s,p)=>s+p.regularity.score*p.area/total,0),regularityPassed:mesh.subcontours.every(p=>p.regularity.passes),regularParts:mesh.subcontours.filter(p=>p.regularity.passes).length,convexParts:mesh.subcontours.filter(p=>p.regularity.convex).length,sharpParts:mesh.subcontours.filter(p=>p.regularity.minInteriorAngle<25).length,minInteriorAngle:Math.min(...mesh.subcontours.map(p=>p.regularity.minInteriorAngle))});return mesh;}
  const middlePackingCost=mesh=>.35*mesh.partitionAudit.shapeCost+2.5*mesh.partitionAudit.sharpParts+.5*(mesh.subcontours.length-mesh.partitionAudit.convexParts);
  function improveMiddleCells(input,maxParts){
    if(input.partitionEdges.some(e=>kind(e)!=='I'))return input;
    let mesh=assembleMesh(input.subcontours,maxParts);if(!mesh?.partitionAudit.valid)return input;shortPreference(mesh);
    const pointKey=p=>p.map(v=>v.toFixed(7)).join(':'),boundaryKey=m=>m.partitionEdges.filter(e=>e.role!=='internal').map(e=>[pointKey(e.p0),pointKey(e.p3)].sort().join('|')).sort().join(';'),originalBoundary=boundaryKey(mesh),
      summary=m=>({shapeCost:m.partitionAudit.shapeCost,packingCost:middlePackingCost(m),convexParts:m.partitionAudit.convexParts,minInteriorAngle:m.partitionAudit.minInteriorAngle});
    const before=summary(mesh);let changes=0;
    for(let step=0;step<maxParts*4;step++){
      let best=null,bestCost=middlePackingCost(mesh);
      const originals=new Map(mesh.partitionEdges.map(e=>[pointKey(e.p0)+'|'+pointKey(e.p3),e])),segments=vertices=>vertices.map((p,i)=>{const q=vertices[(i+1)%vertices.length],s=originals.get(pointKey(p)+'|'+pointKey(q)),back=originals.get(pointKey(q)+'|'+pointKey(p));return s?{...s}:back?reversedSegment(back):segmentFromLine(p,q);});
      function consider(a,b,one,two){
        const faces=mesh.subcontours.map(p=>p.id===a?{segments:one}:p.id===b?{segments:two}:{segments:p.segments}),candidate=assembleMesh(faces,maxParts);
        if(!candidate?.partitionAudit.valid||candidate.holeCount!==mesh.holeCount||candidate.subcontours.length!==mesh.subcontours.length||boundaryKey(candidate)!==originalBoundary)return;
        shortPreference(candidate);
        if(candidate.partitionAudit.convexParts<mesh.partitionAudit.convexParts||candidate.partitionAudit.minInteriorAngle<Math.min(25,mesh.partitionAudit.minInteriorAngle)-1e-6)return;
        const cost=middlePackingCost(candidate);if(cost<bestCost-1e-8){best=candidate;bestCost=cost;}
      }
      const visited=new Set();
      for(const edge of mesh.partitionEdges.filter(e=>e.role==='internal')){
        for(const donorId of edge.faces){
          const recipientId=edge.faces.find(id=>id!==donorId),donor=mesh.subcontours[donorId],recipient=mesh.subcontours[recipientId];if(donor.segments.length<=3||recipient.segments.length>=PART_EDGE_LIMIT)continue;
          const points=donor.segments.map(s=>s.p0),shared=donor.edgeRefs.findIndex(ref=>ref.edge===edge.id);
          for(const corner of [shared,(shared+1)%points.length]){
            const previous=points[(corner+points.length-1)%points.length],tip=points[corner],next=points[(corner+1)%points.length];if(cross(sub(tip,previous),sub(next,tip))<=1e-8)continue;
            const recipientPoints=recipient.segments.map(s=>s.p0),at=recipient.edgeRefs.findIndex(ref=>ref.edge===edge.id),extra=corner===shared?previous:next;
            consider(donorId,recipientId,segments(points.filter((_,i)=>i!==corner)),segments(recipientPoints.flatMap((p,i)=>i===at?[p,extra]:[p])));
          }
        }
        // Recut the union as well: two six-sided neighbours have no spare
        // corner for a one-sided transfer, but can exchange their diagonal.
        const pair=edge.faces.slice().sort((a,b)=>a-b),pairKey=pair.join(':');if(visited.has(pairKey))continue;visited.add(pairKey);
        const first=mesh.subcontours[pair[0]],second=mesh.subcontours[pair[1]],shared=new Set(first.edgeRefs.filter(r=>second.edgeRefs.some(s=>r.edge===s.edge)).map(r=>r.edge));if(shared.size!==1)continue;
        const remaining=[...first.segments,...second.segments].filter(s=>!shared.has(s.edge)),next=new Map(remaining.map(s=>[s.startNode,s]));if(next.size!==remaining.length)continue;
        const ordered=[],start=remaining[0].startNode;let at=start;
        do{const s=next.get(at);if(!s||ordered.some(p=>p.startNode===at))break;ordered.push(s);at=s.endNode;}while(at!==start);
        if(at!==start||ordered.length!==remaining.length)continue;
        const points=ordered.map(s=>s.p0),n=points.length;
        for(let a=0;a<n;a++)for(let b=a+2;b<n;b++){
          const count=b-a;if(count+1>PART_EDGE_LIMIT||n-count+1>PART_EDGE_LIMIT||n-count<2||!segmentInRings(points[a],points[b],[points]))continue;
          const one=ordered.slice(a,b).concat(segmentFromLine(points[b],points[a])),two=ordered.slice(b).concat(ordered.slice(0,a),segmentFromLine(points[a],points[b]));
          consider(pair[0],pair[1],one,two);
        }
      }
      if(!best)break;mesh=best;changes++;
    }
    return {...input,...mesh,middleShapeAudit:{changes,before,after:summary(mesh),preservedBoundary:true}};
  }
  function subdivideBoundaryCells(mesh,targetParts,maxParts,preferShort=false) {
    if(preferShort)shortPreference(mesh);
    while(mesh.subcontours.length<targetParts){let best=null,bestScore=Infinity;
      function consider(face,segments,a,b){const arc=(start,end)=>{const out=[];for(let j=start;j!==end;j=(j+1)%segments.length)out.push(segments[j]);return out;},p=segments[a].p0,q=segments[b].p0,one=[...arc(a,b),segmentFromLine(q,p)],two=[...arc(b,a),segmentFromLine(p,q)];
        if(one.length<3||two.length<3||one.length>PART_EDGE_LIMIT||two.length>PART_EDGE_LIMIT)return;
        const faces=mesh.subcontours.flatMap(f=>f.id===face.id?[{...f,segments:one},{...f,segments:two}]:[f]),candidate=assembleMesh(faces,maxParts);
        if(!candidate?.partitionAudit.valid)return;
        if(preferShort)shortPreference(candidate);const total=candidate.subcontours.reduce((s,p)=>s+p.area,0),largest=Math.max(...candidate.subcontours.map(p=>p.area)),score=candidate.partitionAudit.shapeCost+.3*largest/total;
        if(score<bestScore){best=candidate;bestScore=score;}
      }
      function halves(s){const out=split(s,.5);return out.map((p,k)=>({...s,...p,...(s.baseT0!==undefined?{baseT0:s.baseT0+(s.baseT1-s.baseT0)*k/2,baseT1:s.baseT0+(s.baseT1-s.baseT0)*(k+1)/2}:{}),...(s.curveT0!==undefined?{curveT0:s.curveT0+(s.curveT1-s.curveT0)*k/2,curveT1:s.curveT0+(s.curveT1-s.curveT0)*(k+1)/2}:{})}));}
      for(const face of mesh.subcontours.slice().sort((a,b)=>b.area-a.area)){
        const n=face.segments.length;
        for(let a=0;a<n;a++)if(face.segments[a].role!=='internal'){
          for(let b=a+1;b<n;b++)if(face.segments[b].role!=='internal'){
            const segments=[],indices=[];for(let j=0;j<n;j++){if(j===a||j===b){indices.push(segments.length+1);segments.push(...halves(face.segments[j]));}else segments.push(face.segments[j]);}consider(face,segments,indices[0],indices[1]);
          }
          const segments=face.segments.flatMap((s,i)=>i===a?halves(s):[s]),mid=a+1;
          for(let v=0;v<n;v++)if(v!==a&&v!==(a+1)%n){const index=v>a?v+1:v;consider(face,segments,mid,index);}
        }
      }
      if(!best)break;mesh=best;
    }
    return mesh;
  }
  function hierarchyAudit(mesh,middle,linearized=false,tolerance=Infinity) {
    const original=middle.partitionEdges.filter(e=>e.role==='internal');let preserved=0,maxDeviation=0;
    for(const edge of original){const children=mesh.partitionEdges.filter(e=>e.baseEdgeId===edge.id&&e.role==='internal'),ranges=children.map(e=>[Math.min(e.baseT0,e.baseT1),Math.max(e.baseT0,e.baseT1)]).sort((a,b)=>a[0]-b[0]);let end=0,valid=!!ranges.length;
      for(const range of ranges){if(Math.abs(range[0]-end)>1e-6)valid=false;end=range[1];const child=children.find(e=>Math.min(e.baseT0,e.baseT1)===range[0]&&Math.max(e.baseT0,e.baseT1)===range[1]),a=bez(edge,child.baseT0),b=bez(edge,child.baseT1);for(let j=0;j<=24;j++){const t=j/24,source=bez(edge,child.baseT0+(child.baseT1-child.baseT0)*t),expected=linearized?mix(a,b,t):source,actual=bez(child,t);if(dist(actual,expected)>1e-5)valid=false;maxDeviation=Math.max(maxDeviation,dist(actual,source));}}
      if(valid&&Math.abs(end-1)<1e-6)preserved++;
    }
    const valid=preserved===original.length&&mesh.subcontours.every(p=>Number.isInteger(p.parentId)&&p.parentId>=0&&p.parentId<middle.subcontours.length);return {valid,mode:linearized?'polyline':'geometry',geometryPreserved:valid&&maxDeviation<1e-5,parentCount:middle.subcontours.length,expectedParentEdges:original.length,preservedParentEdges:preserved,...(linearized?{maxDeviation,approximationToleranceMet:maxDeviation<=tolerance}: {})};
  }
  // Refit after subdivision: new boundary nodes can move, while the near
  // stage's internal seams (including their endpoints) remain shared and fixed.
  function refitUltraBoundary(mesh,parent,sources,mask,w,h,tolerance,settings) {
    const key=p=>p.map(v=>Math.round(v*1e7)).join(':'),fixed=new Set(parent.partitionEdges.filter(e=>e.role==='internal').flatMap(e=>[key(e.p0),key(e.p3)])),targets=new Map(),rings=[];
    for(let r=0;r<loopsOf(mesh).length;r++){
      const loop=loopsOf(mesh).find(x=>x[0]?.sourceLoop===r)||loopsOf(mesh)[r],samples=Math.max(16,loop.length*2);let source=sources[r];
      if(source.length<samples){const length=source.reduce((sum,p,i)=>sum+dist(p,source[(i+1)%source.length]),0);source=resample(source,Math.max(1e-9,length/samples));}
      const anchors=sourceAnchors(loop,source);
      // Preserve a subpixel hole instead of quantizing it out of the input.
      const tiny=r>0&&Math.abs(area(source))<=1;
      for(let i=0;i<loop.length;i++)if(!tiny&&!fixed.has(key(loop[i].p0)))targets.set(loop[i].startNode,source[anchors[i]%source.length]);
      rings.push({loop,source,anchors});
    }
    const measure=m=>({error:boundaryDeviation(sources,m,2),iou:iou(mask,rasterizeLoops(loopsOf(m).map(r=>flatten(r,1.2)),w,h))}),before=measure(mesh);
    let best=mesh,bestMeasure=before,bestMovement=0;
    function arcError(s,arc){const points=Array.from({length:33},(_,j)=>bez(s,j/32));let error=0;for(const p of arc){let d=Infinity;for(let j=1;j<points.length;j++)d=Math.min(d,pointSegment(p,points[j-1],points[j]));error=Math.max(error,d);}for(const p of points){let d=Infinity;for(let j=1;j<arc.length;j++)d=Math.min(d,pointSegment(p,arc[j-1],arc[j]));error=Math.max(error,d);}return error;}
    function build(selected){const candidate=assembleMesh(mesh.subcontours.map(p=>({...p,segments:p.edgeRefs.map(ref=>ref.reversed?reversedSegment(selected.get(ref.edge)):selected.get(ref.edge))})),settings.maxParts);return candidate?.partitionAudit.valid&&candidate.holeCount===mesh.holeCount&&hierarchyAudit(candidate,parent,!!settings.iOnly,tolerance).valid?candidate:null;}
    function consider(candidate,movement){if(!candidate)return false;const value=measure(candidate);if(value.error>before.error+1e-6||value.iou<before.iou-1e-9)return false;if(!(value.error<bestMeasure.error-1e-6||Math.abs(value.error-bestMeasure.error)<=1e-6&&value.iou>bestMeasure.iou+1e-9))return false;const filled=rasterizeLoops(loopsOf(candidate).map(r=>flatten(r,1.2)),w,h);if(maskInfo(filled,w,h).holes!==mesh.holeCount)return false;best=candidate;bestMeasure=value;bestMovement=movement;return true;}
    for(const fraction of [0,1,.5,.25]){
      const positions=mesh.meshNodes.map((p,i)=>targets.has(i)?mix(p,targets.get(i),fraction):p),geometry=new Map();
      for(const e of mesh.partitionEdges){const p0=positions[e.startNode],p3=positions[e.endNode],d0=sub(p0,e.p0),d3=sub(p3,e.p3);geometry.set(e.id,{...e,...(kind(e)==='I'?segmentFromLine(p0,p3):{p0,p1:add(e.p1,mix(d0,d3,1/3)),p2:add(e.p2,mix(d0,d3,2/3)),p3})});}
      const choices=new Map();
      for(const {loop,source,anchors}of rings){const n=source.length,points=source.map(p=>p.slice());for(let i=0;i<loop.length;i++)points[anchors[i]%n]=positions[loop[i].startNode];
        for(let i=0;i<loop.length;i++){
          const edge=mesh.partitionEdges[loop[i].id],a=anchors[i],b=i+1<loop.length?anchors[i+1]:anchors[0]+n,arc=Array.from({length:b-a+1},(_,j)=>source[(a+j)%n]),forward=loop[i].startNode===edge.startNode,old=geometry.get(edge.id),list=[];
          const addChoice=s=>{if(!forward)s=reversedSegment(s);const k=kind(s);if(!['I','C','S'].includes(k)||settings.iOnly&&k!=='I')return;const error=arcError(s,forward?arc:arc.slice().reverse());list.push({s:{...old,p0:s.p0,p1:s.p1,p2:s.p2,p3:s.p3},error});};
          addChoice(forward?old:reversedSegment(old));addChoice(segmentFromLine(points[a%n],points[b%n]));
          if(!settings.iOnly&&!(loop[i].sourceLoop>0&&Math.abs(area(source))<=1)){
            for(const window of [2,6,12]){const tangents=source.map((_,j)=>unit(sub(source[(j+window)%n],source[(j-window+n)%n])));addChoice(fitSpan(points,tangents,a,b,4).s);}
            const previous=loop[(i+loop.length-1)%loop.length],next=loop[(i+1)%loop.length],tangents={};tangents[a%n]=unit(sub(previous.p3,previous.p2));tangents[b%n]=unit(sub(next.p1,next.p0));addChoice(fitSpan(points,tangents,a,b,4).s);
          }
          list.sort((a,b)=>a.error-b.error);choices.set(edge.id,list);
        }
      }
      for(const seed of ['fit','original','line']){
        const selected=new Map(geometry);for(const [id,list]of choices){const choice=seed==='original'?list.find(c=>['p0','p1','p2','p3'].every(k=>dist(c.s[k],geometry.get(id)[k])<1e-7)):seed==='line'?list.find(c=>kind(c.s)==='I'):list[0];if(choice)selected.set(id,choice.s);}
        if(seed==='fit'&&!settings.iOnly)for(let round=0;round<=mesh.partitionEdges.length;round++){
          let retry=false;
          for(const {loop,source,anchors}of rings){const n=source.length,points=source.map(p=>p.slice());for(let i=0;i<loop.length;i++)points[anchors[i]%n]=positions[loop[i].startNode];
            for(let i=0;i<loop.length;i++){const id=loop[i].id,edge=mesh.partitionEdges[id];if(kind(selected.get(id))==='I')continue;
              const previous=loop[(i+loop.length-1)%loop.length],next=loop[(i+1)%loop.length],a=anchors[i],b=i+1<loop.length?anchors[i+1]:anchors[0]+n,tangents={},direction=s=>{const e=selected.get(s.id);return s.startNode===e.startNode?unit(sub(e.p3,e.p0)):unit(sub(e.p0,e.p3));};
              tangents[a%n]=kind(selected.get(previous.id))==='I'?direction(previous):unit(sub(source[(a+2)%n],source[(a-2+n)%n]));tangents[b%n]=kind(selected.get(next.id))==='I'?direction(next):unit(sub(source[(b+2)%n],source[(b-2+n)%n]));let s=fitSpan(points,tangents,a,b,4).s;
              if(!['I','C','S'].includes(kind(s))){s=segmentFromLine(points[a%n],points[b%n]);retry=true;}if(loop[i].startNode!==edge.startNode)s=reversedSegment(s);selected.set(id,{...selected.get(id),...s});
            }
          }
          if(!retry)break;
        }
        consider(build(selected),Math.max(...positions.map((p,i)=>dist(p,mesh.meshNodes[i]))));
      }
      // A joint fit can be invalid at one corner. Improve edges independently
      // from a valid graph instead of discarding all the other useful fits.
      if(fraction===0){let selected=new Map(mesh.partitionEdges.map(e=>[e.id,e]));for(const [id,list]of choices)for(const choice of list){const trial=new Map(selected);trial.set(id,choice.s);if(consider(build(trial),0))selected=trial;}}
    }
    const changed=best!==mesh,outlineRefinement={mode:'source-fit-after-subdivision',changed,beforeError:before.error,afterError:bestMeasure.error,beforeIoU:before.iou,afterIoU:bestMeasure.iou,maxNodeMovement:bestMovement,preservedNearSeams:true};
    return {...mesh,...best,hierarchyAudit:hierarchyAudit(best,parent,!!settings.iOnly,tolerance),fittingResidual:bestMeasure.error,fitFallback:changed?false:mesh.fitFallback,outlineRefinement};
  }
  // Hole arcs must be fitted together: replacing one side of a polygon alone
  // cannot create a smooth closed curve. New cuts may bend around the fitted
  // void, while inherited near-stage seams keep their exact geometry.
  function refitBoundaryLoops(input,parent,sources,mask,w,h,tolerance,settings,originalSources=sources,indices=null) {
    if(!indices)indices=Array.from({length:sources.length-1},(_,i)=>i+1);
    if(!indices.length)return input;
    const pointKey=p=>p.map(v=>Math.round(v*1e7)).join(':'),
      protectedPoints=new Set(parent.partitionEdges.filter(e=>e.role==='internal').flatMap(e=>[pointKey(e.p0),pointKey(e.p3)])),
      loopFor=(mesh,index)=>loopsOf(mesh).find(loop=>loop[0]?.sourceLoop===index)||(index===0?loopsOf(mesh)[0]:undefined),
      errorOf=(source,loop)=>deviation(resample(source,1),resample(flatten(loop,.6),1)),
      voidIoU=(source,loop)=>iou(rasterize(source,w,h),rasterize(flatten(loop,.6),w,h)),
      materialIoU=mesh=>iou(mask,rasterizeLoops(loopsOf(mesh).map(loop=>flatten(loop,1.2)),w,h));
    let current=input;const records=[];
    const build=(mesh,geometry)=>assembleMesh(mesh.subcontours.map(face=>({...face,segments:face.edgeRefs.map(ref=>ref.reversed?reversedSegment(geometry.get(ref.edge)):geometry.get(ref.edge))})),settings.maxParts);
    function constrainedTangent(mesh,node,desired,margin){
      const constraints=[];for(const edge of mesh.partitionEdges)if(edge.role==='internal'&&(edge.startNode===node||edge.endNode===node)&&edge.baseEdgeId!==undefined&&parent.partitionEdges[edge.baseEdgeId]?.role==='internal')for(const t of [.001,.02,.08,.2])constraints.push(unit(sub(bez(edge,edge.startNode===node?t:1-t),mesh.meshNodes[node])));
      if(!constraints.length)return desired;const options=[desired];for(const v of constraints)for(const angle of [-margin,-Math.PI+margin])options.push([v[0]*Math.cos(angle)-v[1]*Math.sin(angle),v[0]*Math.sin(angle)+v[1]*Math.cos(angle)]);
      return options.filter(t=>constraints.every(v=>cross(t,v)>=Math.sin(margin)-1e-7)).sort((a,b)=>dot(b,desired)-dot(a,desired))[0]||desired;
    }
    function clearInheritedSeams(mesh,fitted,source,anchors){
      const seams=mesh.partitionEdges.filter(e=>e.role==='internal'&&e.baseEdgeId!==undefined&&parent.partitionEdges[e.baseEdgeId]?.role==='internal').map(e=>Array.from({length:65},(_,j)=>bez(e,j/64)));
      const crosses=s=>{const poly=Array.from({length:49},(_,j)=>bez(s,j/48));for(const seam of seams)for(let a=1;a<poly.length;a++)for(let b=1;b<seam.length;b++){const p=poly[a-1],q=poly[a],r=seam[b-1],t=seam[b];if(Math.max(p[0],q[0])<Math.min(r[0],t[0])||Math.max(r[0],t[0])<Math.min(p[0],q[0])||Math.max(p[1],q[1])<Math.min(r[1],t[1])||Math.max(r[1],t[1])<Math.min(p[1],q[1]))continue;const dx=q[0]-p[0],dy=q[1]-p[1],vx=t[0]-r[0],vy=t[1]-r[1];if((dx*(r[1]-p[1])-dy*(r[0]-p[0]))*(dx*(t[1]-p[1])-dy*(t[0]-p[0]))< -1e-9&&(vx*(p[1]-r[1])-vy*(p[0]-r[0]))*(vx*(q[1]-r[1])-vy*(q[0]-r[0]))< -1e-9)return true;}return false;};
      return fitted.map((s,i)=>{if(!crosses(s))return s;const a=anchors[i],b=i+1<fitted.length?anchors[i+1]:anchors[0]+source.length,arc=Array.from({length:Math.min(65,b-a+1)},(_,j)=>source[Math.round(a+(b-a)*j/Math.max(1,Math.min(65,b-a+1)-1))%source.length]);let best=null,cost=Infinity;
        for(const x of [1,.8,1.2,.6,1.4,.4,1.8])for(const y of [1,.8,1.2,.6,1.4,.4,1.8]){const candidate={...s,p1:add(s.p0,mul(sub(s.p1,s.p0),x)),p2:add(s.p3,mul(sub(s.p2,s.p3),y))};if(!['C','S'].includes(kind(candidate))||crosses(candidate))continue;const poly=Array.from({length:49},(_,j)=>bez(candidate,j/48));let error=0;for(const p of arc){let d=Infinity;for(let k=1;k<poly.length;k++)d=Math.min(d,pointSegment(p,poly[k-1],poly[k]));error=Math.max(error,d);}if(error<cost){best=candidate;cost=error;}}
        return best||s;
      });
    }
    function* routeNewCuts(mesh,geometry,boundaries){
      const fill=rasterizeLoops(boundaries.map(loop=>flatten(loop,.6)),w,h),field=edt(fill,w,h,1),
        outside=p=>{const x=Math.floor(p[0]),y=Math.floor(p[1]);return x<0||y<0||x>=w||y>=h?Math.hypot(w,h):Math.sqrt(field[y*w+x]);};
      function energy(s){const count=Math.max(48,Math.ceil(dist(s.p0,s.p3))),chord=dist(s.p0,s.p3);let sum=0,max=0,length=0,last=s.p0;for(let j=1;j<=count;j++){const p=bez(s,j/count);length+=dist(last,p);last=p;if(j===count)continue;const d=outside(p);sum+=d;max=Math.max(max,d);}return sum/Math.max(1,count-1)+.2*max+.002*Math.max(0,length-chord);}
      const choices=[];
      for(const edge of mesh.partitionEdges.filter(e=>e.role==='internal')){
        if(edge.baseEdgeId!==undefined&&parent.partitionEdges[edge.baseEdgeId]?.role==='internal')continue;
        const original=geometry.get(edge.id),initial=energy(original);if(initial<.12)continue;
        const chord=sub(original.p3,original.p0),length=norm(chord),normal=[-chord[1]/length,chord[0]/length],options=[{s:original,cost:initial}];
        if(!settings.iOnly)for(const sign of [-1,1])for(const fraction of [.015625,.03125,.0625,.125,.25,.5,1])for(const ratio of [.5,1,2,-.5,-1,-2]){
          const offset=sign*fraction*length,s={...original,p1:add(mix(original.p0,original.p3,1/3),mul(normal,offset)),p2:add(mix(original.p0,original.p3,2/3),mul(normal,offset*ratio))},k=kind(s);
          if(!['C','S'].includes(k))continue;const cost=energy(s);if(cost<initial)options.push({s,cost});
        }
        options.sort((a,b)=>a.cost-b.cost);if(options.length>1)choices.push({id:edge.id,options:options.slice(0,6),improvement:initial-options[0].cost});
      }
      choices.sort((a,b)=>b.improvement-a.improvement);
      let states=[{geometry,cost:0}];
      for(const choice of choices){const next=[];for(const state of states)for(const option of choice.options){const g=new Map(state.geometry);g.set(choice.id,option.s);
          next.push({geometry:g,cost:state.cost+option.cost});
        }states=next.sort((a,b)=>a.cost-b.cost).slice(0,24);if(!states.length)break;}
      for(const state of states){const candidate=build(mesh,state.geometry);if(candidate?.partitionAudit.valid&&candidate.holeCount===mesh.holeCount&&hierarchyAudit(candidate,parent,!!settings.iOnly,tolerance).valid)yield candidate;}
    }
    for(const ring of indices){
      const originalLoop=loopFor(current,ring);if(!originalLoop)continue;
      let source=sources[ring];const samples=Math.max(16,originalLoop.length*2);if(source.length<samples){const length=source.reduce((s,p,i)=>s+dist(p,source[(i+1)%source.length]),0);source=resample(source,length/samples);}
      const beforeError=errorOf(source,originalLoop),beforeIoU=voidIoU(source,originalLoop),originalSource=originalSources[ring]||source,beforeSourceError=errorOf(originalSource,originalLoop),beforeSourceIoU=voidIoU(originalSource,originalLoop),record={sourceLoop:ring,beforeError,afterError:beforeError,beforeIoU,afterIoU:beforeIoU,beforeSourceError,afterSourceError:beforeSourceError,beforeSourceIoU,afterSourceIoU:beforeSourceIoU,changed:false,movedNodes:0,curvedNewCuts:0};
      if(Math.abs(area(source))<=1||settings.iOnly){records.push({...record,status:settings.iOnly?'i-only':'subpixel-preserved'});continue;}
      if(beforeError<=tolerance&&beforeIoU>.99){records.push({...record,status:'within-tolerance'});continue;}
      let best=current,bestError=beforeError,bestIoU=beforeIoU,bestMovement=0;const baseIoU=materialIoU(current),n=source.length,nearest=sourceAnchors(originalLoop,source),featureWindow=Math.max(2,Math.round(n/40)),turn=source.map((p,j)=>{const a=sub(p,source[(j-featureWindow+n)%n]),b=sub(source[(j+featureWindow)%n],p);return cross(a,b)/Math.max(1e-9,norm(a)*norm(b));}),strong=turn.map((value,index)=>({value,index})).filter(x=>Math.abs(x.value)>.04),features=[];
      for(let j=0;j<strong.length;j++){const a=strong[j],b=strong[(j+1)%strong.length];if(a.value*b.value>=0)continue;const end=b.index>a.index?b.index:b.index+n;let best=a.index;for(let k=a.index+1;k<=end;k++)if(Math.abs(turn[k%n])<Math.abs(turn[best%n]))best=k;features.push(best%n);}
      const triedFits=new Set();
      search: for(const placement of ['nearest','arc','features']){
        const anchors=nearest.slice(),pins=originalLoop.map(s=>protectedPoints.has(pointKey(s.p0)));
        if(placement==='arc'){
          const starts=pins.map((v,i)=>v?i:-1).filter(i=>i>=0);if(!starts.length)starts.push(0);
          for(let j=0;j<starts.length;j++){const a=starts[j],b=j+1<starts.length?starts[j+1]:starts[0]+originalLoop.length,start=nearest[a],end=(b<originalLoop.length?nearest[b]:nearest[b%originalLoop.length]+n);for(let i=a+1;i<b;i++)anchors[i%originalLoop.length]=Math.round(start+(end-start)*(i-a)/(b-a));}
          for(let j=0;j<anchors.length;j++){anchors[j]=((anchors[j]%n)+n)%n;if(j)while(anchors[j]<=anchors[j-1])anchors[j]+=n;}
          if(anchors.at(-1)>=anchors[0]+n)continue;
        }
        if(placement==='features'){
          if(!features.length)continue;const used=new Set();for(const feature of features){let at=feature;while(at<anchors[0])at+=n;let best=-1;for(let j=1;j<anchors.length;j++)if(!pins[j]&&!used.has(j)&&at>anchors[j-1]&&at<(j+1<anchors.length?anchors[j+1]:anchors[0]+n)&&(best<0||Math.abs(anchors[j]-at)<Math.abs(anchors[best]-at)))best=j;if(best>=0){anchors[best]=at;used.add(best);}}
        }
        for(const fraction of [1,.5,0])for(const window of [6,12,24,2])for(const margin of [null,.02,.1,.25]){
          const positions=current.meshNodes.map(p=>p.slice());for(let j=0;j<originalLoop.length;j++)if(!pins[j])positions[originalLoop[j].startNode]=mix(originalLoop[j].p0,source[anchors[j]%n],fraction);
          const points=source.map(p=>p.slice());for(let j=0;j<originalLoop.length;j++)points[anchors[j]%n]=positions[originalLoop[j].startNode];
          const tangentWindow=Math.min(window,Math.max(1,Math.floor(n/4))),tangents=source.map((_,j)=>unit(sub(source[(j+tangentWindow)%n],source[(j-tangentWindow+n)%n])));
          if(margin!==null)for(let j=0;j<originalLoop.length;j++)if(pins[j])tangents[anchors[j]%n]=constrainedTangent(current,originalLoop[j].startNode,tangents[anchors[j]%n],margin);
          let fitted=originalLoop.map((s,j)=>({...s,...fitSpan(points,tangents,anchors[j],j+1<originalLoop.length?anchors[j+1]:anchors[0]+n,4).s}));
          if(ring===0){
            // One arc with several turns must not prevent neighbouring arcs
            // from improving. Keep that arc linear and jointly align the
            // adjacent curve tangents, instead of rejecting the whole ring.
            const linear=fitted.map((s,j)=>{
              if(!['C','S'].includes(kind(s)))return true;
              if(kind(originalLoop[j])!=='I')return false;
              const a=anchors[j],b=j+1<fitted.length?anchors[j+1]:anchors[0]+n,poly=Array.from({length:49},(_,k)=>bez(s,k/48));let curved=0,straight=0;
              for(let k=a;k<=b;k++){const p=source[k%n];straight=Math.max(straight,pointSegment(p,s.p0,s.p3));let d=Infinity;for(let t=1;t<poly.length;t++)d=Math.min(d,pointSegment(p,poly[t-1],poly[t]));curved=Math.max(curved,d);}
              return curved>straight+Math.max(.25,straight*.02);
            });
            for(let round=0;round<=fitted.length;round++){
              let retry=false;
              for(let j=0;j<fitted.length;j++){
                const a=anchors[j],b=j+1<fitted.length?anchors[j+1]:anchors[0]+n;
                if(linear[j]){fitted[j]={...originalLoop[j],...segmentFromLine(points[a%n],points[b%n])};continue;}
                const previous=(j+fitted.length-1)%fitted.length,next=(j+1)%fitted.length,local={};
                local[a%n]=linear[previous]?unit(sub(points[a%n],points[anchors[previous]%n])):tangents[a%n];
                local[b%n]=linear[next]?unit(sub(points[(next+1<fitted.length?anchors[next+1]:anchors[0]+n)%n],points[b%n])):tangents[b%n];
                fitted[j]={...originalLoop[j],...fitSpan(points,local,a,b,4).s};
                if(!['C','S'].includes(kind(fitted[j]))){linear[j]=true;retry=true;}
              }
              if(!retry)break;
            }
          }
          fitted=clearInheritedSeams(current,fitted,source,anchors);
          if(!audit(decorate(fitted),true).valid)continue;
          const fittedError=errorOf(source,fitted);if(fittedError>bestError+1e-6)continue;
          const fitKey=JSON.stringify(fitted.map(s=>[s.p0,s.p1,s.p2,s.p3]));if(triedFits.has(fitKey))continue;triedFits.add(fitKey);
          const geometry=new Map();for(const edge of current.partitionEdges){const p0=positions[edge.startNode],p3=positions[edge.endNode],a=sub(p0,edge.p0),b=sub(p3,edge.p3);geometry.set(edge.id,{...edge,...(kind(edge)==='I'?segmentFromLine(p0,p3):{p0,p1:add(edge.p1,mix(a,b,1/3)),p2:add(edge.p2,mix(a,b,2/3)),p3})});}
          for(let j=0;j<originalLoop.length;j++){const edge=current.partitionEdges[originalLoop[j].id],s=originalLoop[j].startNode===edge.startNode?fitted[j]:reversedSegment(fitted[j]);geometry.set(edge.id,{...geometry.get(edge.id),p0:s.p0,p1:s.p1,p2:s.p2,p3:s.p3});}
          const boundaries=loopsOf(current).map(loop=>loop===originalLoop?fitted:loop);
          for(const candidate of routeNewCuts(current,geometry,boundaries)){
            const loop=loopFor(candidate,ring),error=errorOf(source,loop),score=voidIoU(source,loop);if(error>bestError+1e-6||score<bestIoU-1e-9||error>=bestError-1e-5&&score<=bestIoU+1e-9||materialIoU(candidate)<baseIoU-1e-9)continue;
            const fill=rasterizeLoops(loopsOf(candidate).map(loop=>flatten(loop,.6)),w,h);if(maskInfo(fill,w,h).holes!==current.holeCount)continue;
            best=candidate;bestError=error;bestIoU=score;bestMovement=Math.max(...positions.map((p,i)=>dist(p,current.meshNodes[i])));if(bestError<=tolerance&&bestIoU>.99)break search;break;
          }
        }
      }
      if(best!==current){record.changed=true;record.afterError=bestError;record.afterIoU=bestIoU;record.afterSourceError=errorOf(originalSource,loopFor(best,ring));record.afterSourceIoU=voidIoU(originalSource,loopFor(best,ring));record.maxNodeMovement=bestMovement;record.movedNodes=best.meshNodes.filter((p,i)=>dist(p,current.meshNodes[i])>1e-7).length;record.curvedNewCuts=best.partitionEdges.filter(e=>e.role==='internal'&&kind(e)!=='I'&&(e.baseEdgeId===undefined||parent.partitionEdges[e.baseEdgeId]?.role!=='internal')).length;current={...current,...best};}
      records.push({...record,status:record.changed?'improved':'constraints'});
    }
    const changed=records.some(r=>r.changed),outline=current.outlineRefinement;
    return {...current,hierarchyAudit:hierarchyAudit(current,parent,!!settings.iOnly,tolerance),...(indices[0]===0?{outerFitAudit:records[0]}:{holeFitAudit:records}),fitFallback:changed?false:current.fitFallback,...(outline?{outlineRefinement:{...outline,changed:outline.changed||changed,afterError:boundaryDeviation(sources,current,2),afterIoU:materialIoU(current),maxNodeMovement:Math.max(outline.maxNodeMovement,...records.map(r=>r.maxNodeMovement||0))}}:{})};
  }
  const refitHoleLoops=(...args)=>refitBoundaryLoops(...args);
  const refitOuterLoop=(input,parent,sources,mask,w,h,tolerance,settings,originalSources=sources)=>refitBoundaryLoops(input,parent,sources,mask,w,h,tolerance,settings,originalSources,[0]);
  function sourceAnchors(outer,source) {
    const n=source.length,k=outer.length;let start=0;for(let j=1;j<n;j++)if(dist(source[j],outer[0].p0)<dist(source[start],outer[0].p0))start=j;
    let prev=new Float64Array(n).fill(Infinity);prev[0]=0;const backs=[];
    for(let i=1;i<k;i++){const row=new Float64Array(n).fill(Infinity),back=new Int32Array(n).fill(-1);let best=Infinity,index=-1;for(let j=1;j<n;j++){if(prev[j-1]<best){best=prev[j-1];index=j-1;}if(j>=i&&j<=n-(k-i)&&index>=0){row[j]=best+dist(source[(start+j)%n],outer[i].p0)**2;back[j]=index;}}backs.push(back);prev=row;}
    let end=0;for(let j=1;j<n;j++)if(prev[j]<prev[end])end=j;const result=[end];for(let i=backs.length-1;i>=0;i--){end=backs[i][end];result.push(end);}return result.reverse().map(j=>j+start);
  }
  function fitAnchoredPolyline(base,source,tolerance,budget,pinned=null){
    const n=source.length,anchors=sourceAnchors(base,source),points=source.map(p=>p.slice());for(let i=0;i<base.length;i++)if(!pinned||pinned[i])points[anchors[i]%n]=base[i].p0.slice();
    const span=(a,b,owner)=>{const p=points[a%n],q=points[b%n];let error=0,index=-1;for(let j=a+1;j<b;j++){const d=pointSegment(points[j%n],p,q);if(d>error){error=d;index=j;}}return {a,b,owner,error,index};};
    const spans=base.map((_,i)=>span(anchors[i],i+1<base.length?anchors[i+1]:anchors[0]+n,i));if(spans.length>budget)return null;
    while(spans.length<budget){let worst=-1;for(let i=0;i<spans.length;i++)if(spans[i].index>spans[i].a&&spans[i].error>tolerance&&(worst<0||spans[i].error>spans[worst].error))worst=i;if(worst<0)break;const old=spans[worst];spans.splice(worst,1,span(old.a,old.index,old.owner),span(old.index,old.b,old.owner));}
    return spans.map(s=>({...segmentFromLine(points[s.a%n],points[s.b%n]),sourceParentEdge:s.owner}));
  }
  function fitAnchoredOutline(base,source,tolerance,budget,tangentWindow=2,pinned=null) {
    const n=source.length,anchors=sourceAnchors(base,source),points=source.map(p=>p.slice()),tangents=points.map((_,i)=>unit(sub(source[(i+tangentWindow)%n],source[(i-tangentWindow+n)%n])));
    for(let i=0;i<base.length;i++)if(!pinned||pinned[i])points[anchors[i]%n]=base[i].p0.slice();
    let spans=base.map((_,i)=>({...fitSpan(points,tangents,anchors[i],i+1<base.length?anchors[i+1]:anchors[0]+n,4),owner:i}));
    while(spans.length<4){let selected=0;for(let i=1;i<spans.length;i++)if(spans[i].b-spans[i].a>spans[selected].b-spans[selected].a)selected=i;const item=spans[selected],mid=(item.a+item.b)>>1;if(mid<=item.a||mid>=item.b)break;spans.splice(selected,1,{...fitSpan(points,tangents,item.a,mid,4),owner:item.owner},{...fitSpan(points,tangents,mid,item.b,4),owner:item.owner});}
    function expanded(){const out=[];for(const item of spans)for(const s of validSegments([item.s]))out.push({...s,sourceParentEdge:item.owner});return out;}
    while(expanded().length<budget){let worst=-1;for(let i=0;i<spans.length;i++)if(spans[i].b-spans[i].a>2&&spans[i].error>tolerance&&(worst<0||spans[i].error>spans[worst].error))worst=i;if(worst<0)break;
      const s=spans[worst],m=Math.max(s.a+1,Math.min(s.b-1,s.index)),parts=[{...fitSpan(points,tangents,s.a,m,4),owner:s.owner},{...fitSpan(points,tangents,m,s.b,4),owner:s.owner}],candidate=spans.slice();candidate.splice(worst,1,...parts);
      const count=candidate.reduce((a,p)=>a+validSegments([p.s]).length,0);if(count>budget)break;spans=candidate;
    }
    const result=expanded();return result.length<=budget?result:null;
  }
  function curveSharedEdges(middle,source,settings,domain) {
    const pure=s=>({p0:s.p0,p1:s.p1,p2:s.p2,p3:s.p3,...(s.sourceLoop!==undefined?{sourceLoop:s.sourceLoop}:{})}),geometry=new Map(middle.partitionEdges.map(e=>[e.id,{...pure(e),baseEdgeId:e.id,baseT0:0,baseT1:1}])),changed=[];
    if(settings.curveInternal===false)return {geometry,changed,sharedKinds:{I:middle.partitionAudit.sharedEdges*2,C:0,S:0}};
    let mask=domain?.mask,w=domain?.width,h=domain?.height,ox=0,oy=0;
    if(!mask){ox=Math.floor(Math.min(...source.map(p=>p[0])))-2;oy=Math.floor(Math.min(...source.map(p=>p[1])))-2;w=Math.ceil(Math.max(...source.map(p=>p[0])))-ox+3;h=Math.ceil(Math.max(...source.map(p=>p[1])))-oy+3;mask=rasterize(source.map(p=>[p[0]-ox,p[1]-oy]),w,h);}
    const field=edt(mask,w,h,1);
    const outside=p=>{const x=p[0]-ox-.5,y=p[1]-oy-.5;if(x<0||y<0||x>w-1||y>h-1)return 1e6;const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,index=b*w+a;return (1-u)*(1-v)*field[index]+u*(1-v)*field[b*w+Math.min(a+1,w-1)]+(1-u)*v*field[Math.min(b+1,h-1)*w+a]+u*v*field[Math.min(b+1,h-1)*w+Math.min(a+1,w-1)];};
    function energy(s){const length=dist(s.p0,s.p3),samples=Math.max(32,Math.ceil(length/2));let sum=0,max=0,walk=0,last=s.p0,count=0;for(let i=1;i<=samples;i++){const p=bez(s,i/samples);walk+=dist(p,last);last=p;if(i/samples<.04||i/samples>.96)continue;const d=outside(p);sum+=d;max=Math.max(max,d);count++;}const mean=sum/Math.max(1,count);return {score:mean+.25*max+.02*Math.max(0,walk-length),mean,max};}
    const build=g=>assembleMesh(middle.subcontours.map(p=>({parentId:p.id,segments:p.edgeRefs.map(ref=>ref.reversed?reversedSegment(g.get(ref.edge)):g.get(ref.edge))})),middle.subcontours.length);
    for(const edge of middle.partitionEdges.filter(e=>e.role==='internal')){
      const initial=energy(geometry.get(edge.id));if(initial.mean<.03||initial.max<1)continue;
      const length=dist(edge.p0,edge.p3),u=unit(sub(edge.p3,edge.p0)),normal=[-u[1],u[0]],candidates=[];
      for(const sign of [-1,1])for(const fraction of [1/128,1/64,1/32,1/16,1/8,1/4,1/2,1])for(const ratio of [-2,-1,-.5,.5,1,2]){
        const offset=length*fraction*sign,s={p0:edge.p0,p1:add(add(edge.p0,mul(u,length/3)),mul(normal,offset)),p2:add(sub(edge.p3,mul(u,length/3)),mul(normal,offset*ratio)),p3:edge.p3};if(!['C','S'].includes(kind(s)))continue;const e=energy(s);if(e.score<initial.score*.98&&e.max<=initial.max)candidates.push({s,e});
      }
      for(const candidate of candidates.sort((a,b)=>a.e.score-b.e.score)){
        const g=new Map(geometry);g.set(edge.id,{...candidate.s,baseEdgeId:edge.id,baseT0:0,baseT1:1});const mesh=build(g);if(!mesh?.partitionAudit.valid||mesh.subcontours.some(p=>hasAdjacentC(p.segments)||hasAdjacentS(p.segments)))continue;
        geometry.set(edge.id,g.get(edge.id));changed.push({edge:edge.id,kind:kind(candidate.s),before:initial,after:candidate.e});break;
      }
    }
    const sharedKinds={I:0,C:0,S:0};for(const edge of middle.partitionEdges.filter(e=>e.role==='internal'))sharedKinds[kind(geometry.get(edge.id))]+=2;
    return {geometry,changed,sharedKinds};
  }
  // Same graph/node positions; fit I/C/S freely, forbidding C-C and S-S.
  function curveOnMiddle(middle,source,tolerance,settings,domain=null) {
    const base=middle.segments,n=base.length;
    if(source.length<n*2)source=resample(source,Math.max(.1,source.length/(n*2)));
    const size=source.length,anchors=sourceAnchors(base,source),points=source.map(p=>p.slice()),directions=anchors.map(i=>unit(sub(source[(i+2)%size],source[(i-2+size)%size])));
    for(let i=0;i<n;i++)points[anchors[i]%size]=base[i].p0.slice();
    const pure=s=>({p0:s.p0,p1:s.p1,p2:s.p2,p3:s.p3,...(s.sourceLoop!==undefined?{sourceLoop:s.sourceLoop}:{})}),chord=i=>unit(sub(base[(i+n)%n].p3,base[(i+n)%n].p0)),routing=curveSharedEdges(middle,source,settings,domain),fits=[],baseline=[],arcs=[],banned=base.map(()=>new Set());
    const edgeForNodes=new Map(middle.partitionEdges.map(e=>[edgeKey(e.startNode,e.endNode),e])),outerIndex=new Map(base.map((s,i)=>[edgeForNodes.get(edgeKey(s.startNode,s.endNode)).id,i]));
    for(const p of middle.subcontours)for(let j=0;j<p.edgeRefs.length;j++){
      const ref=p.edgeRefs[j],i=outerIndex.get(ref.edge);if(i===undefined)continue;
      for(const adjacent of [p.edgeRefs[(j+p.edgeRefs.length-1)%p.edgeRefs.length],p.edgeRefs[(j+1)%p.edgeRefs.length]])if(middle.partitionEdges[adjacent.edge].role==='internal'){const k=kind(routing.geometry.get(adjacent.edge));if(k==='C'||k==='S')banned[i].add(k);}
    }
    function openError(a,b){function directed(p,q){let max=0;for(const v of p){let nearest=Infinity;for(let j=0;j+1<q.length;j++)nearest=Math.min(nearest,pointSegment(v,q[j],q[j+1]));max=Math.max(max,nearest);}return max;}return Math.max(directed(a,b),directed(b,a));}
    for(let i=0;i<n;i++){
      const a=anchors[i],b=i+1<n?anchors[i+1]:anchors[0]+size,arc=Array.from({length:b-a+1},(_,j)=>points[(a+j)%size]),weight=Math.max(1,b-a);let error=0;
      for(const p of arc)error=Math.max(error,pointSegment(p,base[i].p0,base[i].p3));arcs.push(arc);baseline.push({s:pure(base[i]),kind:'I',error,weight,cost:weight*error*error});
      const options={};for(const key of ['SS','IS','SI','II']){const tangents={};tangents[a%size]=key[0]==='S'?directions[i]:chord(i-1);tangents[b%size]=key[1]==='S'?directions[(i+1)%n]:chord(i+1);const f=fitSpan(points,tangents,a,b,4),k=kind(f.s),error=['I','C','S'].includes(k)?openError(arc,Array.from({length:49},(_,j)=>bez(f.s,j/48))):Infinity;options[key]={s:f.s,kind:k,error,weight,cost:weight*error*error+1e-8};}fits.push(options);
    }
    const option=(i,prev,current,next)=>current?fits[i][(prev?'S':'I')+(next?'S':'I')]:baseline[i],valid=(i,f)=>['I','C','S'].includes(f.kind)&&!banned[i].has(f.kind),repeat=(a,b)=>a===b&&(a==='C'||a==='S'),patterns=[];
    // A curve's tangent modes depend on its neighbours. This cyclic DP keeps
    // the last two choices and last actual kind, without ratio quotas.
    for(const first of [0,1])for(const second of [0,1])for(const last of [0,1]){
      const initial=option(0,last,first,second);if(!valid(0,initial))continue;
      let states=[{prev:first,current:second,kind:initial.kind,pattern:''+first+second,cost:initial.cost}];
      for(let i=1;i<n-1;i++){
        const nextStates=new Map();
        for(const state of states)for(const next of (i===n-2?[last]:[0,1])){const f=option(i,state.prev,state.current,next);if(!valid(i,f)||repeat(state.kind,f.kind))continue;const candidate={prev:state.current,current:next,kind:f.kind,pattern:state.pattern+next,cost:state.cost+f.cost},key=candidate.prev+':'+candidate.current+':'+candidate.kind,list=nextStates.get(key)||[];list.push(candidate);list.sort((a,b)=>a.cost-b.cost||a.pattern.localeCompare(b.pattern));if(list.length>4)list.length=4;nextStates.set(key,list);}
        states=[...nextStates.values()].flat();
      }
      for(const state of states){const final=option(n-1,state.prev,state.current,first);if(valid(n-1,final)&&!repeat(state.kind,final.kind)&&!repeat(final.kind,initial.kind))patterns.push({pattern:state.pattern,cost:state.cost+final.cost});}
    }
    patterns.push({pattern:'0'.repeat(n),cost:baseline.reduce((s,f)=>s+f.cost,0)});const tried=new Set();
    function freeSpan(arc){
      const p0=arc[0],p3=arc.at(-1),params=[0];for(let i=1;i<arc.length;i++)params.push(params.at(-1)+dist(arc[i],arc[i-1]));const length=params.at(-1);if(length<1e-8)return null;for(let i=1;i<params.length;i++)params[i]/=length;let best=null;
      for(let round=0;round<7;round++){
        let aa=0,ab=0,bb=0,r1=[0,0],r2=[0,0];for(let i=0;i<arc.length;i++){const t=params[i],q=1-t,a=3*q*q*t,b=3*q*t*t;aa+=a*a;ab+=a*b;bb+=b*b;for(let k=0;k<2;k++){const d=arc[i][k]-q*q*q*p0[k]-t*t*t*p3[k];r1[k]+=a*d;r2[k]+=b*d;}}
        const determinant=aa*bb-ab*ab;if(Math.abs(determinant)<1e-12)break;const s={p0,p3,p1:r1.map((v,k)=>(v*bb-r2[k]*ab)/determinant),p2:r2.map((v,k)=>(v*aa-r1[k]*ab)/determinant)},error=openError(arc,Array.from({length:65},(_,j)=>bez(s,j/64)));if(['C','S'].includes(kind(s))&&(!best||error<best.error))best={s,error};
        for(let i=1;i<params.length-1;i++){const [d,dd]=derivatives(s,params[i]),r=sub(bez(s,params[i]),arc[i]),den=dot(d,d)+dot(r,dd);if(Math.abs(den)>1e-12)params[i]=Math.max(params[i-1]+1e-8,Math.min(params[i+1]-1e-8,params[i]-dot(r,d)/den));}
      }return best;
    }
    function jointCandidates(selected){
      const free=arcs.map(freeSpan),missing=[];for(let i=0;i<n;i++){const current=Math.min(baseline[i].error,...Object.values(fits[i]).filter(f=>!banned[i].has(f.kind)).map(f=>f.error));if(free[i]&&kind(free[i].s)==='S'&&!banned[i].has('S')&&free[i].error+Math.max(.05,tolerance*.1)<current*.9)missing.push(i);}
      if(!missing.length)return {paths:[],missing,tangentModes:[]};
      // Each node owns one tangent pool. Neighbouring curves use the exact
      // same vector; only I/I joints may retain the middle-stage hard corner.
      const pools=base.map((s,i)=>{const previous=(i+n-1)%n,out=[],append=p=>{const d=unit(p);if(norm(d)>.5&&!out.some(q=>dot(d,q)>1-1e-12))out.push(d);};append(chord(previous));append(chord(i));append(directions[i]);append(sub(selected[previous].s.p3,selected[previous].s.p2));append(sub(selected[i].s.p1,selected[i].s.p0));if(free[previous])append(sub(free[previous].s.p3,free[previous].s.p2));if(free[i])append(sub(free[i].s.p1,free[i].s.p0));if(free[previous]&&free[i])append(add(unit(sub(free[previous].s.p3,free[previous].s.p2)),unit(sub(free[i].s.p1,free[i].s.p0))));return out;});
      const mode=(i,d)=>pools[(i+n)%n].findIndex(p=>dot(p,d)>1-1e-12),options=base.map((s,i)=>{const arc=arcs[i],weight=baseline[i].weight,d=chord(i),out=[{...baseline[i],start:mode(i,d),end:mode(i+1,d)}];for(let a=0;a<pools[i].length;a++)for(let b=0;b<pools[(i+1)%n].length;b++){const tangents=[];tangents[0]=pools[i][a];tangents[arc.length-1]=pools[(i+1)%n][b];const f=fitSpan(arc,tangents,0,arc.length-1,4),k=kind(f.s);if(!['C','S'].includes(k)||banned[i].has(k))continue;const error=openError(arc,Array.from({length:65},(_,j)=>bez(f.s,j/64)));out.push({s:f.s,kind:k,error,weight,cost:weight*error*error+1e-8,start:a,end:b});}return out;});
      const compatible=(a,b)=>!repeat(a.kind,b.kind)&&(a.kind==='I'&&b.kind==='I'||a.end===b.start),groups=new Map();for(const o of options[0]){const key=o.kind+':'+o.start;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}const paths=[];
      for(const initial of groups.values()){
        let states=initial.map(o=>({last:o,selected:[o],cost:o.cost}));for(let i=1;i<n;i++){const next=new Map();for(const state of states)for(const o of options[i])if(compatible(state.last,o)){const key=o.kind+':'+o.end,list=next.get(key)||[];list.push({last:o,selected:[...state.selected,o],cost:state.cost+o.cost});list.sort((a,b)=>a.cost-b.cost);if(list.length>3)list.length=3;next.set(key,list);}states=[...next.values()].flat();}paths.push(...states.filter(s=>compatible(s.last,s.selected[0])));
      }return {paths:paths.sort((a,b)=>a.cost-b.cost),missing,tangentModes:pools.map(p=>p.length)};
    }
    function materialize(selected){
      const outer=decorate(selected.map(f=>f.s));if(hasAdjacentC(outer)||hasAdjacentS(outer)||!audit(outer,true).valid)return null;const geometry=new Map(routing.geometry);
      for(let i=0;i<n;i++){const original=base[i],edge=edgeForNodes.get(edgeKey(original.startNode,original.endNode)),s=original.startNode===edge.startNode?selected[i].s:reversedSegment(selected[i].s);geometry.set(edge.id,{...pure(s),...(edge.sourceLoop!==undefined?{sourceLoop:edge.sourceLoop}:{}),baseEdgeId:edge.id,baseT0:0,baseT1:1});}
      const faces=middle.subcontours.map(p=>({parentId:p.id,regionType:'curve-fit',segments:p.edgeRefs.map(ref=>ref.reversed?reversedSegment(geometry.get(ref.edge)):geometry.get(ref.edge))})),mesh=assembleMesh(faces,middle.subcontours.length);
      if(!mesh?.partitionAudit.valid||hasAdjacentC(mesh.segments)||hasAdjacentS(mesh.segments)||mesh.subcontours.some(p=>hasAdjacentC(p.segments)||hasAdjacentS(p.segments)))return null;
      const sameEdges=mesh.partitionEdges.length===middle.partitionEdges.length&&mesh.partitionEdges.every(e=>{const old=middle.partitionEdges[e.baseEdgeId];return old&&e.faces.length===old.faces.length&&e.faces.every(id=>old.faces.includes(id))&&Math.abs(Math.abs(e.baseT1-e.baseT0)-1)<1e-9;}),sameFaces=mesh.subcontours.length===middle.subcontours.length&&mesh.subcontours.every(p=>p.segments.length===middle.subcontours[p.parentId].segments.length),oldNodes=middle.meshNodes||middle.nodes||middle.segments.map(s=>s.p0),unchangedNodePositions=mesh.meshNodes.length===oldNodes.length&&mesh.meshNodes.every(p=>oldNodes.some(q=>dist(p,q)<1e-7)),topologyAudit={valid:sameEdges&&sameFaces&&unchangedNodePositions,partCount:mesh.subcontours.length,sameEdges,sameFaces,unchangedNodePositions},ancestry=hierarchyAudit(mesh,middle);
      if(!topologyAudit.valid||(settings.curveInternal===false&&!ancestry.valid))return null;return {mesh,topologyAudit,ancestry};
    }
    const materialIoU=mesh=>domain?.mask?iou(domain.mask,rasterizeLoops(loopsOf(mesh).map(r=>flatten(r,1.2)),domain.width,domain.height)):null;
    for(const candidate of patterns.sort((a,b)=>a.cost-b.cost||a.pattern.localeCompare(b.pattern))){
      if(tried.has(candidate.pattern))continue;tried.add(candidate.pattern);const flags=Array.from(candidate.pattern,Number),selected=flags.map((flag,i)=>option(i,flags[(i+n-1)%n],flag,flags[(i+1)%n])),built=materialize(selected);if(!built)continue;
      let chosen={...built,selected,cost:candidate.cost},beforeIoU=materialIoU(built.mesh),beforeError=Math.max(...selected.map(f=>f.error));const search=jointCandidates(selected);let tested=0;
      for(const path of search.paths){if(path.cost>=candidate.cost-1e-8)break;if(Math.max(...path.selected.map(f=>f.error))>beforeError+1e-6)continue;tested++;const trial=materialize(path.selected);if(!trial)continue;const trialIoU=materialIoU(trial.mesh);if(beforeIoU!==null&&trialIoU<beforeIoU-1e-9)continue;chosen={...trial,selected:path.selected,cost:path.cost};break;}
      const {mesh,topologyAudit,ancestry}=chosen,afterError=Math.max(...chosen.selected.map(f=>f.error)),fittingSearchAudit={mode:'shared-node tangent search',sourceLoop:base[0].sourceLoop??0,sourceInflectionEdges:search.missing.map(i=>base[i].id),candidatePaths:search.paths.length,tested,accepted:chosen.cost<candidate.cost-1e-8,beforeCost:candidate.cost,afterCost:chosen.cost,beforeMaxError:beforeError,afterMaxError:afterError,beforeIoU,afterIoU:materialIoU(mesh),tangentModes:search.tangentModes};
      return {...mesh,topologyAudit,hierarchyAudit:{...ancestry,mode:routing.changed.length?'topology':'geometry',valid:topologyAudit.valid,geometryPreserved:ancestry.valid},curvedSharedEdges:routing.changed.length,sharedCurveAudit:routing.changed,derivedFrom:'middle',maxSubcontours:middle.subcontours.length,maxEdgesPerSubcontour:PART_EDGE_LIMIT,budget:middle.partitionAudit.sideCount,fittingResidual:afterError,curveSelection:chosen.selected.map(f=>f.kind==='I'?0:1),fittingSearchAudit,representation:'boundary-fit/shared-node-tangents/no-C-C/no-S-S/no-ratio-quota',exteriorCount:0};
    }
    throw Error('近档未找到保持中档拓扑且无连续C/S的有效拟合。');
  }
  function insidePolygon(p,points){let parity=false;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])parity=!parity;}return parity;}
  function holedChains(parent){const protectedNodes=new Set(parent.partitionEdges.filter(e=>e.role==='internal').flatMap(e=>[e.startNode,e.endNode])),base=[],groups=[];for(let ring=0;ring<loopsOf(parent).length;ring++){const original=loopsOf(parent).find(r=>r[0]?.sourceLoop===ring)||loopsOf(parent)[ring],starts=original.map((s,i)=>protectedNodes.has(s.startNode)?i:-1).filter(i=>i>=0),chains=[];if(starts.length<2)for(const s of original)chains.push([s]);else for(let k=0;k<starts.length;k++){const c=[],end=starts[(k+1)%starts.length];for(let j=starts[k];!c.length||j!==end;j=(j+1)%original.length)c.push(original[j]);chains.push(c);}const group=[];for(const segments of chains){group.push(base.length);base.push({segments,ring,startNode:segments[0].startNode,endNode:segments.at(-1).endNode,p0:segments[0].p0,p3:segments.at(-1).p3,pinned:protectedNodes.has(segments[0].startNode)});}for(let j=0;j<group.length;j++)base[group[j]].next=group[(j+1)%group.length];groups.push(group);}return {base,groups};}
  function fitHoledBoundary(data,sources,tolerance,budget,window,pins,iOnly){const points=[],tangents=[],spans=[];for(let ring=0;ring<data.groups.length;ring++){const owners=data.groups[ring],base=owners.map(i=>data.base[i]),source=sources[ring],n=source.length,offset=points.length,anchors=sourceAnchors(base,source);for(let j=0;j<n*2;j++){points.push(source[j%n].slice());tangents.push(unit(sub(source[(j+window)%n],source[(j-window+n*2)%n])));}for(let j=0;j<owners.length;j++)if(pins[owners[j]])for(const index of [anchors[j]%n,anchors[j]%n+n])points[offset+index]=base[j].p0.slice();for(let j=0;j<owners.length;j++)spans.push({a:offset+anchors[j],b:offset+(j+1<owners.length?anchors[j+1]:anchors[0]+n),owner:owners[j]});}
    function fitted(span){if(!iOnly)return {...fitSpan(points,tangents,span.a,span.b,4),owner:span.owner};const a=points[span.a],b=points[span.b];let error=0,index=(span.a+span.b)>>1;for(let j=span.a+1;j<span.b;j++){const value=pointSegment(points[j],a,b);if(value>error){error=value;index=j;}}return {...span,s:segmentFromLine(a,b),error,index};}
    let fits=spans.map(fitted);const expanded=()=>fits.flatMap(f=>validSegments([f.s]).map(s=>({...s,sourceParentEdge:f.owner,sourceLoop:data.base[f.owner].ring})));if(expanded().length>budget)return null;while(expanded().length<budget){let worst=-1;for(let j=0;j<fits.length;j++)if(fits[j].b-fits[j].a>2&&fits[j].error>tolerance&&(worst<0||fits[j].error>fits[worst].error))worst=j;if(worst<0)break;const f=fits[worst],m=Math.max(f.a+1,Math.min(f.b-1,f.index)),parts=[fitted({a:f.a,b:m,owner:f.owner}),fitted({a:m,b:f.b,owner:f.owner})],count=fits.reduce((s,x,i)=>s+(i===worst?0:validSegments([x.s]).length),0)+parts.reduce((s,x)=>s+validSegments([x.s]).length,0);if(count>budget)break;fits.splice(worst,1,...parts);}return expanded();
  }
  function refineHoledParent(parent,sources,mask,w,h,tolerance,settings){const maxParts=settings.maxParts,H=parent.holeCount,data=holedChains(parent),base=data.base,edgeByNodes=new Map(parent.partitionEdges.filter(e=>e.role!=='internal').map(e=>[edgeKey(e.startNode,e.endNode),e])),ownerByEdge=new Map(),oldByEdge=new Map();for(let i=0;i<base.length;i++)for(const s of base[i].segments){const e=edgeByNodes.get(edgeKey(s.startNode,s.endNode));ownerByEdge.set(e.id,i);oldByEdge.set(e.id,s);}
    const extensions=base.map(s=>s.pinned&&insideRings(s.p0,sources,false)&&sources[s.ring].reduce((d,p,j)=>Math.min(d,pointSegment(s.p0,p,sources[s.ring][(j+1)%sources[s.ring].length])),Infinity)>tolerance*.75),seams=parent.partitionEdges.filter(e=>e.role==='internal'&&(kind(e)==='S'||settings.iOnly&&kind(e)==='C')),splits=new Map(seams.map(e=>[e.id,kind(e)==='S'?inflections(e)[0]:.5])),interior=extensions.filter(Boolean).length+seams.length,maxBoundary=(PART_EDGE_LIMIT-2)*maxParts+2-2*H,pins=base.map((s,i)=>s.pinned&&!extensions[i]);
    const baseFaces=parent.subcontours.map(p=>({parentId:p.id,regionType:'subdivision',segments:p.segments.flatMap((s,j)=>{const ref=p.edgeRefs[j],item={...s,baseEdgeId:ref.edge,baseT0:ref.reversed?1:0,baseT1:ref.reversed?0:1};let pieces=[item];if(splits.has(ref.edge)){const t=ref.reversed?1-splits.get(ref.edge):splits.get(ref.edge),mid=item.baseT0+(item.baseT1-item.baseT0)*t;pieces=split(s,t).map((g,k)=>({...item,...g,baseT0:k?mid:item.baseT0,baseT1:k?item.baseT1:mid}));}return settings.iOnly?pieces.map(p=>({...p,...segmentFromLine(p.p0,p.p3)})):pieces;})}));
    const partitionCache=new Map();
    function assembleCandidates(faces){
      const lower=faces.map(f=>Math.max(1,Math.ceil((f.segments.length-2)/(PART_EDGE_LIMIT-2)))),minimum=lower.reduce((a,b)=>a+b,0);if(minimum>maxParts)return [];
      let states=[{faces:[],cost:0}];for(let i=0;i<faces.length;i++){const face=faces[i],limit=maxParts-minimum+lower[i],key=JSON.stringify([limit,face.segments.map(s=>[s.p0,s.p1,s.p2,s.p3,s.role,s.sourceLoop,s.baseEdgeId,s.baseT0,s.baseT1,s.sourceParentEdge])]);if(!partitionCache.has(key))partitionCache.set(key,partitionContourOptions(decorate(face.segments),limit));const choices=partitionCache.get(key);if(!choices.length)return [];const counts=new Map();for(const state of states)for(const choice of choices){const n=state.faces.length+choice.subcontours.length;if(n>maxParts)continue;const next={faces:state.faces.concat(choice.subcontours.map(p=>({...face,segments:p.segments}))),cost:state.cost+choice.audit.shapeCost*curveArea(face.segments)};if(!counts.has(n)||next.cost<counts.get(n).cost)counts.set(n,next);}states=[...counts.values()];}
      return states.sort((a,b)=>a.cost-b.cost).map(s=>assembleMesh(s.faces,maxParts)).filter(m=>m?.partitionAudit.valid&&m.holeCount===H);
    }
    function finish(mesh,fallback=false){mesh=subdivideBoundaryCells(mesh,maxParts,maxParts);const ancestry=hierarchyAudit(mesh,parent,!!settings.iOnly,tolerance);if(!ancestry.valid)return null;return {...mesh,hierarchyAudit:ancestry,derivedFrom:'near',maxSubcontours:maxParts,maxEdgesPerSubcontour:PART_EDGE_LIMIT,exteriorCount:0,fittingResidual:boundaryDeviation(sources,mesh,3),...(fallback?{fitFallback:true}:{})};}
    // Internal subdivision preserves the outline. Rank source fits before
    // densifying, then subdivide the selected geometry once and audit again.
    let best=null,bestError=Infinity;const tried=new Set();for(const window of (settings.iOnly?[2]:[2,6,12]))for(let budget=maxBoundary-2*interior;budget>=base.length;budget--){const raw=fitHoledBoundary(data,sources,tolerance,budget,window,pins,settings.iOnly);if(!raw)continue;const fitted=raw,key=JSON.stringify(fitted.map(s=>[s.sourceParentEdge,s.p0,s.p1,s.p2,s.p3]));if(tried.has(key)||fitted.length+2*interior>maxBoundary)continue;tried.add(key);const grouped=base.map((_,i)=>fitted.filter(s=>s.sourceParentEdge===i));if(grouped.some(g=>!g.length))continue;
      const faces=baseFaces.map(face=>{const used=new Set();return {...face,segments:face.segments.flatMap(s=>{const i=ownerByEdge.get(s.baseEdgeId);if(i===undefined)return [s];if(used.has(i))return [];used.add(i);const next=base[i].next,pieces=[...(extensions[i]&&dist(base[i].p0,grouped[i][0].p0)>1e-7?[segmentFromLine(base[i].p0,grouped[i][0].p0)]:[]),...grouped[i],...(extensions[next]&&dist(grouped[i].at(-1).p3,base[i].p3)>1e-7?[segmentFromLine(grouped[i].at(-1).p3,base[i].p3)]:[])];return dist(s.p0,oldByEdge.get(s.baseEdgeId).p0)<1e-7?pieces:pieces.slice().reverse().map(reversedSegment);})};});
      for(const mesh of assembleCandidates(faces)){if(!hierarchyAudit(mesh,parent,!!settings.iOnly,tolerance).valid)continue;const error=boundaryDeviation(sources,mesh,3);if(error<bestError){best=mesh;bestError=error;}if(error<=tolerance){const candidate=finish(mesh);if(candidate&&candidate.fittingResidual<=tolerance+.5)return candidate;}}
    }
    if(best){const selected=finish(best);if(selected)return selected;}
    for(const mesh of assembleCandidates(baseFaces)){if(!hierarchyAudit(mesh,parent,!!settings.iOnly,tolerance).valid)continue;const selected=finish(mesh,true);if(selected)return selected;}
    const originalFaces=parent.subcontours.map(p=>({parentId:p.id,regionType:'subdivision',segments:p.segments.map((s,j)=>({...s,...(settings.iOnly?segmentFromLine(s.p0,s.p3):{}),baseEdgeId:p.edgeRefs[j].edge,baseT0:p.edgeRefs[j].reversed?1:0,baseT1:p.edgeRefs[j].reversed?0:1}))})),safe=assembleMesh(originalFaces,maxParts);if(safe?.partitionAudit.valid){const selected=finish(safe,true);if(selected)return selected;}
    throw Error('超近分区预算不足以保留孔洞、父分界和条件边数限制，请提高超近上限。');
  }
  function nearFromMiddle(middle,source,mask,w,h,tolerance,settings={maxParts:NEAR_PART_LIMIT,automatic:true,ratios:null}) {
    if(parentHasHoles(middle))return refineHoledParent(middle,source,mask,w,h,tolerance,settings);
    const maxParts=settings.maxParts,maxOuter=(PART_EDGE_LIMIT-2)*maxParts+2,original=middle.segments,protectedNodes=new Set(middle.partitionEdges.filter(e=>e.role==='internal').flatMap(e=>[e.startNode,e.endNode]));
    const starts=original.map((s,i)=>protectedNodes.has(s.startNode)?i:-1).filter(i=>i>=0),chains=[];
    if(starts.length<2)for(const s of original)chains.push([s]);else for(let i=0;i<starts.length;i++){const chain=[],end=starts[(i+1)%starts.length];for(let j=starts[i];chain.length===0||j!==end;j=(j+1)%original.length)chain.push(original[j]);chains.push(chain);}
    const base=chains.map(c=>({...segmentFromLine(c[0].p0,c.at(-1).p3),startNode:c[0].startNode,endNode:c.at(-1).endNode})),pinned=base.map(s=>protectedNodes.has(s.startNode)),edgeByNodes=new Map(middle.partitionEdges.filter(e=>e.role==='outer').map(e=>[edgeKey(e.startNode,e.endNode),e])),baseEdgeToOuter=new Map(),edgeOriginal=new Map();
    const oldCurves=chains.map((c,i)=>c.map(s=>{const e=edgeByNodes.get(edgeKey(s.startNode,s.endNode));baseEdgeToOuter.set(e.id,i);edgeOriginal.set(e.id,s);return {...s,baseEdgeId:e.id,baseT0:s.startNode===e.startNode?0:1,baseT1:s.startNode===e.startNode?1:0};}));
    const extensions=base.map((s,i)=>pinned[i]&&insidePolygon(s.p0,source)&&source.reduce((best,p,j)=>Math.min(best,pointSegment(s.p0,p,source[(j+1)%source.length])),Infinity)>tolerance*.75),curvedSeams=middle.partitionEdges.filter(e=>e.role==='internal'&&kind(e)!=='I'),interiorNodes=extensions.filter(Boolean).length+curvedSeams.length,outlinePins=pinned.map((pin,i)=>pin&&!extensions[i]);
    const splitSeams=new Map(curvedSeams.map(e=>[e.id,kind(e)==='S'?inflections(e)[0]:.5])),fixedShared={I:0,C:0,S:0};for(const e of middle.partitionEdges.filter(e=>e.role==='internal'))for(const piece of splitSeams.has(e.id)?split(e,splitSeams.get(e.id)):[e])fixedShared[kind(piece)]+=2;
    const baseFaces=middle.subcontours.map(p=>({parentId:p.id,regionType:'subdivision',segments:p.segments.flatMap((s,j)=>{const item={...s,baseEdgeId:p.edgeRefs[j].edge,baseT0:p.edgeRefs[j].reversed?1:0,baseT1:p.edgeRefs[j].reversed?0:1};let pieces=[item];if(splitSeams.has(item.baseEdgeId)){const t=p.edgeRefs[j].reversed?1-splitSeams.get(item.baseEdgeId):splitSeams.get(item.baseEdgeId),mid=item.baseT0+(item.baseT1-item.baseT0)*t;pieces=split(item,t).map((piece,k)=>({...item,...piece,baseT0:k?mid:item.baseT0,baseT1:k?item.baseT1:mid}));}return settings.iOnly?pieces.map(piece=>({...piece,...segmentFromLine(piece.p0,piece.p3)})):pieces;})}));
    let bestMesh=null,bestError=Infinity;const sourceSamples=resample(source,3),triedOutlines=new Map();
    for(const tangentWindow of (settings.tangentWindows||[2,6,12])){let cachedRaw=null;for(let budget=maxOuter;budget>=base.length;budget--){
      let foundWindowCandidate=false;
      let raw=cachedRaw&&cachedRaw.length<=budget?cachedRaw:(settings.iOnly?fitAnchoredPolyline(base,source,tolerance,budget,outlinePins):fitAnchoredOutline(base,source,tolerance,budget,tangentWindow,outlinePins));if(!raw)break;cachedRaw=raw;
      const seen=new Set();
      for(const outline of [raw]){const fitted=outline,key=JSON.stringify(fitted.map(s=>[s.sourceParentEdge,s.p0,s.p1,s.p2,s.p3]));if(seen.has(key)||fitted.length+2*interiorNodes>maxOuter)continue;seen.add(key);if(triedOutlines.has(key)){if(triedOutlines.get(key))foundWindowCandidate=true;continue;}triedOutlines.set(key,false);
      const grouped=base.map((_,i)=>fitted.filter(s=>s.sourceParentEdge===i));if(grouped.some(g=>!g.length))continue;
      const external=[];
      const patches=new Map();
      for(let i=0;i<base.length;i++)if(!settings.iOnly&&grouped[i].length+oldCurves[i].length>=3&&grouped[i].length+oldCurves[i].length<=PART_EDGE_LIMIT&&dist(grouped[i][0].p0,base[i].p0)<1e-7&&dist(grouped[i].at(-1).p3,base[i].p3)<1e-7){const region=[...grouped[i],...oldCurves[i].slice().reverse().map(reversedSegment)],a=curveArea(region);if(a<Math.max(1,count(mask)*.001)||intersections(flatten(region,.8)))continue;const pixels=rasterize(flatten(region,.8),w,h);let good=0,bad=0;for(let j=0;j<pixels.length;j++)if(pixels[j])mask[j]?good++:bad++;if(good>bad&&good>16)patches.set(i,region);}
      const faces=baseFaces.map(face=>{const seen=new Set();return {...face,segments:face.segments.flatMap(s=>{const i=baseEdgeToOuter.get(s.baseEdgeId);if(i===undefined)return [s];if(seen.has(i))return [];seen.add(i);const pieces=patches.has(i)?oldCurves[i]:[...(extensions[i]&&dist(base[i].p0,grouped[i][0].p0)>1e-7?[segmentFromLine(base[i].p0,grouped[i][0].p0)]:[]),...grouped[i],...(extensions[(i+1)%base.length]&&dist(grouped[i].at(-1).p3,base[i].p3)>1e-7?[segmentFromLine(grouped[i].at(-1).p3,base[i].p3)]:[])];return dist(s.p0,edgeOriginal.get(s.baseEdgeId).p0)<1e-6?pieces:pieces.slice().reverse().map(reversedSegment);})};});
      for(const [i,segments]of patches){const e=middle.partitionEdges.find(e=>baseEdgeToOuter.get(e.id)===i);external.push({parentId:e.faces[0],neighborParentIds:e.faces.slice(),regionType:'exterior',segments});}
      let states=[{faces:[],cost:0}];
      for(const face of faces){const options=partitionContourOptions(decorate(face.segments),maxParts-external.length);if(!options.length){states=[];break;}const best=new Map();for(const state of states)for(const option of options){const children=option.subcontours.map(p=>({parentId:face.parentId,regionType:'subdivision',segments:p.segments})),count=state.faces.length+children.length+external.length;if(count>maxParts)continue;const next={faces:[...state.faces,...children],cost:state.cost+option.audit.shapeCost*curveArea(face.segments)};if(!best.has(count)||next.cost<best.get(count).cost)best.set(count,next);}states=[...best.values()];}
      const totalArea=Math.max(1,count(mask));
      states.sort((a,b)=>a.cost/totalArea-b.cost/totalArea);
      for(const state of states){let mesh=assembleMesh([...state.faces,...external],maxParts);if(mesh?.partitionAudit.valid){
        mesh=subdivideBoundaryCells(mesh,Math.min(maxParts,settings.targetParts??(middle.subcontours.length*2+external.length)),maxParts);const ancestry=hierarchyAudit(mesh,middle,!!settings.iOnly,tolerance);
        if(ancestry.valid){
          const error=deviation(sourceSamples,resample(flatten(mesh.segments,1.2),3)),candidate={...mesh,hierarchyAudit:ancestry,derivedFrom:(middle.id||'middle'),maxSubcontours:maxParts,maxEdgesPerSubcontour:PART_EDGE_LIMIT,budget:maxParts*PART_EDGE_LIMIT,fittingBudget:budget,tangentWindow,extendedSeamEndpoints:interiorNodes,exteriorCount:mesh.subcontours.filter(p=>p.regionType==='exterior').length,fittingResidual:error};
          foundWindowCandidate=true;triedOutlines.set(key,true);if(error<bestError){bestMesh=candidate;bestError=error;}if(error<=tolerance+.5)return candidate;break;
        }
      }}
    }
    if(foundWindowCandidate)break;
    }}
    if(bestMesh)return bestMesh;
    // A constrained candidate remains reviewable if source fitting is infeasible.
    const fallbackFaces=settings.iOnly?baseFaces.flatMap(face=>{const choice=partitionContourOptions(decorate(face.segments),maxParts).sort((a,b)=>a.subcontours.length-b.subcontours.length||a.audit.shapeCost-b.audit.shapeCost)[0];return choice?choice.subcontours.map(p=>({...face,segments:p.segments})):[];}):baseFaces;
    let mesh=assembleMesh(fallbackFaces,maxParts);if(!mesh?.partitionAudit.valid||!hierarchyAudit(mesh,middle,!!settings.iOnly,tolerance).valid){const originalFaces=middle.subcontours.map(p=>({parentId:p.id,regionType:'subdivision',segments:p.segments.map((s,j)=>({...s,...(settings.iOnly?segmentFromLine(s.p0,s.p3):{}),baseEdgeId:p.edgeRefs[j].edge,baseT0:p.edgeRefs[j].reversed?1:0,baseT1:p.edgeRefs[j].reversed?0:1}))}));mesh=assembleMesh(originalFaces,maxParts);}if(!mesh?.partitionAudit.valid)throw Error('无法保留父档共享分界，请提高分区上限。');mesh=subdivideBoundaryCells(mesh,Math.min(maxParts,settings.targetParts??middle.subcontours.length*2),maxParts);return {...mesh,hierarchyAudit:hierarchyAudit(mesh,middle,!!settings.iOnly,tolerance),derivedFrom:(middle.id||'middle'),maxSubcontours:maxParts,maxEdgesPerSubcontour:PART_EDGE_LIMIT,budget:maxParts*PART_EDGE_LIMIT,fittingBudget:base.length,exteriorCount:0,fitFallback:true};
  }
  function pointSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-(a[0]+dx*t),p[1]-(a[1]+dy*t));}
  function deviation(a,b) {
    function directed(p,q){if(!q.length)return p.length?Infinity:0;let max=0;const n=q.length,boxes=q.map((v,j)=>{const w=q[(j+1)%n];return [Math.min(v[0],w[0]),Math.max(v[0],w[0]),Math.min(v[1],w[1]),Math.max(v[1],w[1])];}),margin=1e-10*q.reduce((m,v)=>Math.max(m,Math.abs(v[0]),Math.abs(v[1])),1);
      for(const v of p){let seed=0,best=Infinity;for(let j=0;j<n;j++){const dx=v[0]-q[j][0],dy=v[1]-q[j][1],d=dx*dx+dy*dy;if(d<best){best=d;seed=j;}}
        let min=Math.min(pointSegment(v,q[seed],q[(seed+1)%n]),pointSegment(v,q[(seed+n-1)%n],q[seed]));
        for(let j=0;j<n;j++){const box=boxes[j],dx=Math.max(0,box[0]-v[0],v[0]-box[1]),dy=Math.max(0,box[2]-v[1],v[1]-box[3]);if(dx*dx+dy*dy>(min+margin)**2)continue;min=Math.min(min,pointSegment(v,q[j],q[(j+1)%n]));}max=Math.max(max,min);
      }return max;
    }return Math.max(directed(a,b),directed(b,a));
  }
  function intersections(points){
    const n=points.length,bins=new Map(),checked=new Int32Array(n),cell=16;
    const boxes=points.map((a,i)=>{const b=points[(i+1)%n];return [Math.min(a[0],b[0]),Math.max(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[1],b[1])];});let count=0;
    for(let i=0;i<n;i++){
      const a=points[i],b=points[(i+1)%n],box=boxes[i],abx=b[0]-a[0],aby=b[1]-a[1];
      for(let x=Math.floor(box[0]/cell);x<=Math.floor(box[1]/cell);x++)for(let y=Math.floor(box[2]/cell);y<=Math.floor(box[3]/cell);y++){
        const key=x+','+y,list=bins.get(key)||[];
        for(const j of list){
          if(i-j<=1||i===n-1&&j===0||checked[j]===i+1)continue;checked[j]=i+1;
          const other=boxes[j];if(box[1]<other[0]||other[1]<box[0]||box[3]<other[2]||other[3]<box[2])continue;
          const c=points[j],d=points[(j+1)%n],cdx=d[0]-c[0],cdy=d[1]-c[1];
          if((abx*(c[1]-a[1])-aby*(c[0]-a[0]))*(abx*(d[1]-a[1])-aby*(d[0]-a[0]))< -1e-12&&(cdx*(a[1]-c[1])-cdy*(a[0]-c[0]))*(cdx*(b[1]-c[1])-cdy*(b[0]-c[0]))< -1e-12)count++;
        }
        list.push(i);bins.set(key,list);
      }
    }return count;
  }
  function audit(segments,allowCorners=false) {
    let gap=0,tangent=0,smoothTangent=0,typeSwitchTangent=0,cornerJoins=0,invalidCorners=0;
    const kinds={I:0,C:0,S:0,MULTI:0,INVALID:0};
    for(let i=0;i<segments.length;i++){
      const s=segments[i],next=segments[(i+1)%segments.length];gap=Math.max(gap,dist(s.p3,next.p0));
      const u=unit(sub(s.p3,s.p2)),v=unit(sub(next.p1,next.p0)),angle=Math.acos(Math.max(-1,Math.min(1,dot(u,v))))*180/Math.PI;
      tangent=Math.max(tangent,angle);if(next.smooth!==false)smoothTangent=Math.max(smoothTangent,angle);
      if(kind(s)!==kind(next))typeSwitchTangent=Math.max(typeSwitchTangent,angle);
      if(angle>.001){cornerJoins++;if(!allowCorners||next.smooth!==false||kind(s)!=='I'||kind(next)!=='I')invalidCorners++;}
      kinds[kind(s)]++;
    }
    const selfIntersections=intersections(flatten(segments,1.5));
    return {closed:gap<1e-7,maxGap:gap,maxTangentDegrees:tangent,maxSmoothTangentDegrees:smoothTangent,maxTypeSwitchDegrees:typeSwitchTangent,cornerJoins,invalidCorners,kinds,selfIntersections,valid:gap<1e-7&&!invalidCorners&&smoothTangent<.001&&typeSwitchTangent<.001&&!kinds.MULTI&&!kinds.INVALID&&!selfIntersections};
  }
  function rasterize(points,w,h) {const mask=new Uint8Array(w*h);for(let y=0;y<h;y++){const yy=y+.5,xs=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a[1]<=yy&&b[1]>yy)||(b[1]<=yy&&a[1]>yy))xs.push(a[0]+(yy-a[1])*(b[0]-a[0])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.ceil(xs[i]-.5));x<Math.min(w,Math.ceil(xs[i+1]-.5));x++)mask[y*w+x]=1;}return mask;}
  function iou(a,b){let common=0,union=0;for(let i=0;i<a.length;i++){if(a[i]&&b[i])common++;if(a[i]||b[i])union++;}return union?common/union:1;}
  const parentHasHoles=l=>(l.holeCount||0)>0;
  const loopsOf=l=>l.boundaryLoops||[l.segments];
  const boundarySegments=l=>loopsOf(l).flat();
  const boundaryPath=l=>loopsOf(l).map(path).join(' ');
  function rasterizeLoops(loops,w,h){const mask=new Uint8Array(w*h),edges=loops.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%p.length]]));for(let y=0;y<h;y++){const yy=y+.5,xs=[];for(const [a,b]of edges)if((a[1]<=yy&&b[1]>yy)||(b[1]<=yy&&a[1]>yy))xs.push(a[0]+(yy-a[1])*(b[0]-a[0])/(b[1]-a[1]));xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.ceil(xs[i]-.5));x<Math.min(w,Math.ceil(xs[i+1]-.5));x++)mask[y*w+x]=1;}return mask;}
  function boundaryDeviation(sourceLoops,mesh,step=2){const candidates=loopsOf(mesh);let error=0;for(let i=0;i<sourceLoops.length;i++){const target=candidates.find(r=>r[0]?.sourceLoop===i)||candidates[i];if(!target)return Infinity;error=Math.max(error,deviation(resample(sourceLoops[i],step),resample(flatten(target,1.2),step)));}return error;}
  function insideRings(p,rings,boundary=true){for(const ring of rings)for(let j=0;j<ring.length;j++)if(pointSegment(p,ring[j],ring[(j+1)%ring.length])<1e-7)return boundary;return insidePolygon(p,rings[0])&&!rings.slice(1).some(r=>insidePolygon(p,r));}
  function segmentInRings(a,b,rings){const u=sub(b,a),length2=dot(u,u),cuts=[0,1];if(length2<1e-18)return insideRings(a,rings);for(const r of rings)for(let i=0;i<r.length;i++){const c=r[i],d=r[(i+1)%r.length],v=sub(d,c),w=sub(c,a),den=cross(u,v);if(Math.abs(den)>1e-12){const t=cross(w,v)/den,q=cross(w,u)/den;if(t>0&&t<1&&q>=-1e-9&&q<=1+1e-9)cuts.push(t);}else if(Math.abs(cross(u,w))<1e-8)for(const p of [c,d]){const t=dot(sub(p,a),u)/length2;if(t>0&&t<1)cuts.push(t);}}cuts.sort((a,b)=>a-b);return cuts.every((t,i)=>!i||insideRings(mix(a,b,(cuts[i-1]+t)/2),rings));}
  function ringsValid(rings){if(!rings.length||area(rings[0])<=0||rings.some((r,i)=>r.length<3||intersections(r)||i&&area(r)>=0))return false;for(let i=1;i<rings.length;i++)if(rings[i].some(p=>!insidePolygon(p,rings[0])||rings[0].some((a,j)=>pointSegment(p,a,rings[0][(j+1)%rings[0].length])<1e-6)))return false;for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++){if(i&& (insidePolygon(rings[i][0],rings[j])||insidePolygon(rings[j][0],rings[i])))return false;for(let a=0;a<rings[i].length;a++)for(let b=0;b<rings[j].length;b++){const p=rings[i][a],q=rings[i][(a+1)%rings[i].length],r=rings[j][b],s=rings[j][(b+1)%rings[j].length];if(cross(sub(q,p),sub(r,p))*cross(sub(q,p),sub(s,p))<0&&cross(sub(s,r),sub(p,r))*cross(sub(s,r),sub(q,r))<0)return false;}}return true;}
  function triangulateRings(rings,variant=0){
    if(!ringsValid(rings))return null;const points=[],ids=rings.map(r=>r.map(p=>{points.push(p.slice());return points.length-1;})),boundary=new Map();for(let k=0;k<ids.length;k++)for(let i=0;i<ids[k].length;i++){const a=ids[k][i],b=ids[k][(i+1)%ids[k].length];boundary.set(edgeKey(a,b),{...segmentFromLine(points[a],points[b]),sourceLoop:k});}
    let polygon=ids[0].slice();const holes=ids.slice(1).sort((a,b)=>Math.max(...b.map(i=>points[i][0]))-Math.max(...a.map(i=>points[i][0]))),bridges=[];
    for(const hole of holes){let choice=null;for(let i=0;i<polygon.length;i++)for(let j=0;j<hole.length;j++){const a=points[polygon[i]],b=points[hole[j]],cost=dist(a,b);if(choice&&cost>=choice.cost||cost<1e-7||!segmentInRings(a,b,rings))continue;let crossing=false;for(const [c,d]of bridges)if(cross(sub(b,a),sub(c,a))*cross(sub(b,a),sub(d,a))< -1e-10&&cross(sub(d,c),sub(a,c))*cross(sub(d,c),sub(b,c))< -1e-10)crossing=true;if(!crossing)choice={i,j,cost};}if(!choice)return null;const {i,j}=choice,a=polygon[i],ordered=[...hole.slice(j),...hole.slice(0,j)];bridges.push([points[a],points[hole[j]]]);polygon=[...polygon.slice(0,i+1),...ordered,ordered[0],a,...polygon.slice(i+1)];}
    const triangles=[],active=polygon.slice(),eps=1e-8,insideTri=(p,a,b,c)=>cross(sub(b,a),sub(p,a))>=-eps&&cross(sub(c,b),sub(p,b))>=-eps&&cross(sub(a,c),sub(p,c))>=-eps;
    let guard=0;while(active.length>3&&guard++<points.length*points.length*4){const ears=[];for(let i=0;i<active.length;i++){const ia=active[(i+active.length-1)%active.length],ib=active[i],ic=active[(i+1)%active.length],a=points[ia],b=points[ib],c=points[ic],twice=cross(sub(b,a),sub(c,a));if(twice<=eps||!segmentInRings(a,c,rings))continue;let blocked=false;for(const node of active){const p=points[node];if(node===ia||node===ib||node===ic)continue;if(dist(p,a)<1e-7||dist(p,b)<1e-7||dist(p,c)<1e-7)continue;if(insideTri(p,a,b,c)){blocked=true;break;}}if(!blocked){const diagonal=dist(a,c),quality=(dist(a,b)**2+dist(b,c)**2+diagonal**2)/twice;ears.push({i,nodes:[ia,ib,ic],score:variant===1?quality:variant===2?-twice:variant===3?-i:diagonal});}}if(ears.length){ears.sort((a,b)=>a.score-b.score);const ear=ears[0];triangles.push(ear.nodes);active.splice(ear.i,1);continue;}let removed=false;for(let i=0;i<active.length;i++){const a=points[active[(i+active.length-1)%active.length]],b=points[active[i]],c=points[active[(i+1)%active.length]];if(pointSegment(b,a,c)<1e-7){active.splice(i,1);removed=true;break;}}if(!removed)return null;}
    if(active.length===3&&area(active.map(i=>points[i]))>eps)triangles.push(active.slice());
    // Restore any collinear boundary vertices removed during weak-polygon ears.
    let changed=true;while(changed){changed=false;for(let t=0;t<triangles.length&&!changed;t++)for(let j=0;j<3&&!changed;j++){const tr=triangles[t],a=tr[j],b=tr[(j+1)%3],c=tr[(j+2)%3];for(let v=0;v<points.length;v++)if(v!==a&&v!==b&&v!==c&&pointSegment(points[v],points[a],points[b])<1e-7&&dist(points[v],points[a])>1e-7&&dist(points[v],points[b])>1e-7){triangles.splice(t,1,[a,v,c],[v,b,c]);changed=true;break;}}}
    const expected=Math.abs(area(rings[0]))-rings.slice(1).reduce((s,r)=>s+Math.abs(area(r)),0),actual=triangles.reduce((s,t)=>s+area(t.map(i=>points[i])),0);if(Math.abs(expected-actual)>1e-5)return null;return {points,triangles,boundary,holes:rings.length-1};
  }
  function partitionRings(rings,maxParts,variant=0,beamWidth=28){const data=triangulateRings(rings,variant);if(!data)return null;const {points,triangles,boundary}=data;if(triangles.length>(PART_EDGE_LIMIT-2)*maxParts)return null;
    const canonical=face=>{const k=face.indexOf(Math.min(...face));return [...face.slice(k),...face.slice(0,k)].join(',');},cache=new Map(),total=triangles.reduce((s,t)=>s+area(t.map(i=>points[i])),0);
    const info=nodes=>{const key=canonical(nodes);if(!cache.has(key)){const segments=nodes.map((a,i)=>{const b=nodes[(i+1)%nodes.length],original=boundary.get(edgeKey(a,b));return {...segmentFromLine(points[a],points[b]),role:original?(original.sourceLoop?'hole':'outer'):'internal',...(original?{sourceLoop:original.sourceLoop}:{})};}),q=rectangularity(segments),a=area(nodes.map(i=>points[i]));cache.set(key,{area:a,sidePolicy:partSidePolicy(segments),cost:(q.shortScore+(nodes.length===3?.4:0))*a/total});}return cache.get(key);};
    function merged(a,b){const lines=new Map();let shared=0;for(const f of [a,b])for(let i=0;i<f.length;i++){const u=f[i],v=f[(i+1)%f.length],key=edgeKey(u,v);if(lines.has(key)){const old=lines.get(key);if(old[0]!==v||old[1]!==u)return null;lines.delete(key);shared++;}else lines.set(key,[u,v]);}if(!shared||lines.size<3||lines.size>PART_EDGE_LIMIT)return null;const next=new Map([...lines.values()]);if(next.size!==lines.size)return null;const out=[],start=next.keys().next().value;let at=start;do{if(at===undefined||out.includes(at)||out.length>PART_EDGE_LIMIT)return null;out.push(at);at=next.get(at);}while(at!==start);return out.length===lines.size&&info(out).sidePolicy.valid&&info(out).area>1e-6?out:null;}
    let states=[{faces:triangles,cost:triangles.reduce((s,t)=>s+info(t).cost,0)}];while(states.length&&states[0].faces.length>maxParts){const next=new Map();for(const state of states)for(let i=0;i<state.faces.length;i++)for(let j=i+1;j<state.faces.length;j++){const m=merged(state.faces[i],state.faces[j]);if(!m)continue;const faces=state.faces.filter((_,k)=>k!==i&&k!==j).concat([m]),key=faces.map(canonical).sort().join('|'),cost=state.cost-info(state.faces[i]).cost-info(state.faces[j]).cost+info(m).cost;if(!next.has(key)||cost<next.get(key).cost)next.set(key,{faces,cost});}states=[...next.values()].sort((a,b)=>a.cost-b.cost).slice(0,beamWidth);}
    for(const state of states){const faces=state.faces.map(nodes=>({segments:nodes.map((a,i)=>{const b=nodes[(i+1)%nodes.length],s=boundary.get(edgeKey(a,b));return s?dist(s.p0,points[a])<1e-7?{...s}:reversedSegment(s):segmentFromLine(points[a],points[b]);})}));let mesh=assembleMesh(faces,maxParts);if(!mesh?.partitionAudit.valid)continue;mesh=subdivideBoundaryCells(mesh,maxParts,maxParts,true);if(mesh.partitionAudit.valid&&mesh.holeCount===rings.length-1)return mesh;}return null;
  }
  function middleWithHoles(sourceLoops,D,settings,detail){
    const H=sourceLoops.length-1,max=(PART_EDGE_LIMIT-2)*settings.maxParts+2-2*H,tolerance=D*.012*detail;
    if(max<3*sourceLoops.length)throw Error(`保留${H}个孔洞且每区通常5边、满足平行条件时最多6边，当前${settings.maxParts}个分区不足，请增加中档分区数。`);
    let best=null,bestScore=Infinity;const seen=new Set(),allocations=[];
    // Use the actual regional side budget. A fixed seven-corner outer cap can
    // erase deep concavities even when many more boundary corners are feasible.
    for(const holeN of [4,3,5]){
      const holes=sourceLoops.slice(1).map(r=>{let p=r.length<=4?r.slice():polygonKnots(r,D*.009*detail,holeN).knots.map(k=>k.point);return area(p)<0?p:p.reverse();}),remaining=max-holes.reduce((n,r)=>n+r.length,0);
      if(remaining<3)continue;
      const peak=polygonKnots(sourceLoops[0],D*.009*detail,remaining).knots.length,counts=new Set([peak,...Array.from({length:Math.min(12,peak-3)},(_,i)=>peak-i-1),7,6,5,4,3].filter(n=>n>=3&&n<=remaining&&n<=peak));
      for(const outerN of counts)allocations.push({outerN,holes});
    }
    // Preserve concavities whenever a nonconvex candidate can be partitioned.
    // A convex envelope is a fallback for infeasible budgets, not a shape prior.
    for(const envelope of [false,true]){
      if(envelope&&best)break;
      for(const {outerN,holes}of allocations){
        if(envelope&&outerN<4)continue;
        let outer=envelope?enclosingPolygon(sourceLoops[0],outerN).points:polygonKnots(sourceLoops[0],D*.009*detail,outerN).knots.map(k=>k.point);if(area(outer)<0)outer=outer.reverse();
        const rings=[outer,...holes],key=JSON.stringify(rings);if(seen.has(key)||!ringsValid(rings))continue;seen.add(key);
        const boundaryLoops=rings.map((r,k)=>r.map((p,i)=>({...segmentFromLine(p,r[(i+1)%r.length]),sourceLoop:k}))),residual=boundaryDeviation(sourceLoops,{boundaryLoops},3),fitCost=3*(residual/Math.max(tolerance,1e-6))**2;
        if(fitCost>=bestScore)continue;
        for(const variant of [0,1,2,3]){const initial=partitionRings(rings,settings.maxParts,variant);if(!initial)continue;const mesh=improveMiddleCells(initial,settings.maxParts),score=fitCost+middlePackingCost(mesh);if(score<bestScore){best={...mesh,fittingResidual:residual,representation:'I-only / adaptive boundary budget / polygon-with-holes / convex-aware merging and recuts',convexFallback:envelope,maxSubcontours:settings.maxParts,maxEdgesPerSubcontour:PART_EDGE_LIMIT};bestScore=score;}}
      }
    }
    if(!best)throw Error(`无法在${settings.maxParts}区内构成保留${H}孔的有效分区，请提高中档分区数。`);return best;
  }
  function curveHoledMiddle(middle,targets,tolerance,settings,domain){let mesh=middle,initial=null;const boundaryFitAudit=[];for(let ring=0;ring<targets.length;ring++){const loop=loopsOf(mesh).find(r=>r[0]?.sourceLoop===ring)||loopsOf(mesh)[ring],view={...mesh,segments:loop};const candidate=curveOnMiddle(view,targets[ring],tolerance,{...settings,curveInternal:ring===0&&settings.curveInternal!==false},domain);if(!initial)initial=candidate;boundaryFitAudit.push(candidate.fittingSearchAudit);mesh=candidate;}
    const ancestry=hierarchyAudit(mesh,middle);return {...mesh,boundaryFitAudit,derivedFrom:'middle',curvedSharedEdges:initial.curvedSharedEdges,sharedCurveAudit:initial.sharedCurveAudit,hierarchyAudit:{...ancestry,mode:initial.curvedSharedEdges?'topology':'geometry',valid:mesh.topologyAudit.valid,geometryPreserved:ancestry.valid}};
  }
  const segmentFromLine=(a,b)=>({p0:a,p1:mix(a,b,1/3),p2:mix(a,b,2/3),p3:b});
  function computeHoledPrepared(prepared,w,h,options){const mask=prepared.mask,source=traceAll(mask,w,h),outer=source[0],H=source.length-1,xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]),D=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)),solid=fillHoles(mask,w,h),body=robustBody(solid,w,h,D*(options.trim??.012)),rect=rectangle(trace(body.mask,w,h)),middleSettings=options.middle,nearSettings=options.near,ultraSettings=options.ultra,levels=[];
    function safeHoleRectangle(ring){const pixels=rasterize(ring,w,h),field=edt(pixels,w,h,0);let at=0;for(let i=1;i<field.length;i++)if(pixels[i]&&field[i]>field[at])at=i;const center=[at%w+.5,Math.floor(at/w)+.5],radius=Math.max(.1,(Math.sqrt(field[at])-1)/Math.SQRT2),u=unit(sub(rect.points[1],rect.points[0])),v=[-u[1],u[0]],p=[[-1,-1],[-1,1],[1,1],[1,-1]].map(([a,b])=>add(center,add(mul(u,a*radius),mul(v,b*radius))));return area(p)<0?p:p.reverse();}
    const safeRects=source.slice(1).map(safeHoleRectangle);
    function lowLevel(id,name,outerPoints,preserve,limit){const rings=[outerPoints,...(preserve?source.slice(1).map((r,i)=>{if(id==='far')return safeRects[i];let p=polygonKnots(r,D*.025,5).knots.map(k=>k.point);if(area(p)>0)p.reverse();const filled=rasterize(p,w,h);return filled.some((v,j)=>v&&mask[j])?safeRects[i]:p;}):[])];if(!ringsValid(rings)){rings.splice(1,rings.length-1,...(preserve?safeRects:[]));if(!ringsValid(rings))rings[0]=id==='far'?rectangle(outer).points:enclosingPolygon(outer,limit).points;}let offset=0;const boundaryLoops=rings.map((r,k)=>{const a=decorate(r.map((p,i)=>({...segmentFromLine(p,r[(i+1)%r.length]),sourceLoop:k}))).map((s,i)=>({...s,id:offset+i,startNode:offset+i,endNode:offset+(i+1)%r.length,sourceLoop:k,role:k?'hole':'outer'}));offset+=r.length;return a;});return {id,name,segments:boundaryLoops[0],boundaryLoops,holeLoops:boundaryLoops.slice(1),holeCount:boundaryLoops.length-1,meshNodes:boundaryLoops.flatMap(r=>r.map(s=>s.p0)),sigma:0,tolerance:0,budget:limit,holePolicy:preserve?'preserve':'ignore',sourceHoleCount:H,removed:body.removed,trimRadius:body.radius};}
    levels.push(lowLevel('far','远',rect.points,false,4));let cageBody=body;while(cageBody.radius>0&&cageBody.removed>count(mask)*.02)cageBody=robustBody(solid,w,h,cageBody.radius-1);const cage=enclosingPolygon(trace(cageBody.mask,w,h),5);levels.push(lowLevel('farMid','中远',cage.points,false,5));
    const middle=middleWithHoles(source,D,middleSettings,options.detail??1);levels.push({id:'middle',name:'中',...middle,tolerance:D*.012*(options.detail??1),sigma:D*.015,budget:middleSettings.maxParts*PART_EDGE_LIMIT,holePolicy:'preserve'});
    const nearTargets=source.map(r=>smoothPoints(resample(r,1),Math.max(.7,D*.002))),safeNear=ringsValid(nearTargets)?nearTargets:source.map(r=>resample(r,1)),near=curveHoledMiddle(levels[2],safeNear,D*.004,nearSettings,{mask,width:w,height:h});levels.push({id:'near',name:'近',...near,tolerance:D*.004,sigma:D*.003,holePolicy:'preserve'});
    const ultraTargets=source.map(r=>smoothPoints(resample(r,1),.7)),safeUltra=ringsValid(ultraTargets)?ultraTargets:source.map(r=>resample(r,1)),tolerance=options.ultraTolerance??options.nearTolerance??1.1,initialUltra=refineHoledParent(levels[3],safeUltra,mask,w,h,tolerance,{...ultraSettings,targetParts:ultraSettings.maxParts}),ultra=refitOuterLoop(refitHoleLoops(refitUltraBoundary(initialUltra,levels[3],safeUltra,mask,w,h,tolerance,ultraSettings),levels[3],safeUltra,mask,w,h,tolerance,ultraSettings,source),levels[3],safeUltra,mask,w,h,tolerance,ultraSettings,source);levels.push({id:'ultra',name:'超近',...ultra,tolerance,sigma:D*.0008,holePolicy:'preserve'});
    for(const l of levels){const loops=loopsOf(l),segments=boundarySegments(l),audits=loops.map(r=>audit(r,true)),kinds={I:0,C:0,S:0,MULTI:0,INVALID:0};for(const a of audits)for(const k of Object.keys(kinds))kinds[k]+=a.kinds[k];l.nodes=l.meshNodes;l.audit={closed:audits.every(a=>a.closed),maxGap:Math.max(...audits.map(a=>a.maxGap)),maxTangentDegrees:Math.max(...audits.map(a=>a.maxTangentDegrees)),maxSmoothTangentDegrees:Math.max(...audits.map(a=>a.maxSmoothTangentDegrees)),maxTypeSwitchDegrees:Math.max(...audits.map(a=>a.maxTypeSwitchDegrees)),cornerJoins:audits.reduce((s,a)=>s+a.cornerJoins,0),invalidCorners:audits.reduce((s,a)=>s+a.invalidCorners,0),selfIntersections:audits.reduce((s,a)=>s+a.selfIntersections,0),kinds,valid:audits.every(a=>a.valid),cPrimitiveValid:(l.partitionEdges||segments).every(e=>e.kind!=='C'||kind(e)==='C'&&simpleC(e)),partitionValid:l.partitionAudit?.valid??true,holesPreserved:l.holeCount===H};l.allowedKinds=['far','farMid','middle'].includes(l.id)||l.id==='ultra'&&ultraSettings.iOnly?['I']:['I','C','S'];l.audit.typePolicyValid=(l.partitionEdges||segments).every(s=>l.allowedKinds.includes(kind(s)));l.audit.valid&&=l.audit.typePolicyValid&&l.audit.partitionValid&&l.audit.cPrimitiveValid&&(l.holePolicy==='ignore'||l.audit.holesPreserved)&&(!l.topologyAudit||l.topologyAudit.valid);
      const relevant=l.holePolicy==='ignore'?[outer]:source,filled=rasterizeLoops(loops.map(r=>flatten(r,1.2)),w,h);l.iou=iou(mask,filled);l.sourceError=boundaryDeviation(relevant,l);l.targetError=l.id==='near'?boundaryDeviation(safeNear,l):l.id==='ultra'?boundaryDeviation(safeUltra,l):l.sourceError;l.groupCount=loops.reduce((s,r)=>s+new Set(r.map(x=>x.group)).size,0);let allLength=0,iLength=0;for(const s of segments){let n=0;for(let j=0;j<24;j++)n+=dist(bez(s,j/24),bez(s,(j+1)/24));allLength+=n;if(kind(s)==='I')iLength+=n;}l.straightFraction=iLength/Math.max(1e-9,allLength);l.metTolerance=l.id==='far'?true:l.targetError<=l.tolerance+.5;l.metRequirements=l.metTolerance&&l.audit.valid&&(l.partitionAudit?.regularityPassed??true)&&l.hierarchyAudit?.approximationToleranceMet!==false;
      if(l.id==='farMid'){let outside=0,bodyOutside=0;for(let j=0;j<mask.length;j++){if(mask[j]&&!filled[j])outside++;if(cageBody.mask[j]&&!filled[j])bodyOutside++;}let maxBodyViolation=0;const cageBoundary=trace(cageBody.mask,w,h);for(const edge of l.segments){const direction=unit(sub(edge.p3,edge.p0));for(const p of cageBoundary)maxBodyViolation=Math.max(maxBodyViolation,-cross(direction,sub(p,edge.p0)));}const bodyArea=count(cageBody.mask),envelopeArea=Math.abs(area(l.segments.map(e=>e.p0)));l.removed=cageBody.removed;l.trimRadius=cageBody.radius;l.enclosure={bodyArea,bodyOutsidePixels:bodyOutside,bodyCoverage:1-bodyOutside/bodyArea,sourceOutsidePixels:outside,sourceOutsideFraction:outside/count(mask),sourceCoverage:1-outside/count(mask),maxBodyViolation,area:envelopeArea,emptyArea:Math.max(0,envelopeArea-count(mask)+outside),maxOutsideFraction:.02};l.metTolerance=null;l.metRequirements=l.audit.valid&&bodyOutside===0&&maxBodyViolation<1e-6&&outside/count(mask)<=.02&&l.segments.length<=5;}
      if(l.partitionAudit){const counts=l.partitionAudit.kinds,total=l.partitionAudit.sideCount;l.ratioAudit=l.id==='middle'?ratioAudit(counts,{I:100,C:0,S:0}):{actual:Object.fromEntries(TYPE_KEYS.map(k=>[k,100*counts[k]/total])),target:null,deviation:null,close:true,automatic:true,softTarget:false,counting:'part-sides/shared-twice'};if(l.id==='middle'||l.id==='near'){l.audit.noAdjacentC=loops.every(r=>!hasAdjacentC(r))&&l.subcontours.every(p=>!hasAdjacentC(p.segments));l.audit.valid&&=l.audit.noAdjacentC;}if(l.id==='near'||l.id==='ultra'){l.audit.noAdjacentS=loops.every(r=>!hasAdjacentS(r))&&l.subcontours.every(p=>!hasAdjacentS(p.segments));l.audit.SwithinLimit=null;l.audit.adjacencyPolicyValid=l.id==='ultra'||l.audit.noAdjacentS;l.audit.valid&&=l.audit.adjacencyPolicyValid;l.adjacencyPolicy={allowCC:l.id==='ultra',allowSS:l.id==='ultra'};}if(l.id==='middle'||l.id==='ultra'){l.countTargetReached=l.subcontours.length===l.maxSubcontours;l.metRequirements&&=l.countTargetReached;}l.metRequirements&&=l.audit.valid;}
    }
    return {version:16,width:w,height:h,inputArea:count(mask),discarded:prepared.discarded,inputComponents:prepared.components,diagonal:D,original:outer,originalLoops:source,holeCount:H,levels,options,method:'binary mask with holes / oriented boundary rings / hole-bridged triangulation and region merging / fixed-topology curve fitting / parent-preserving multi-ring refinement'};
  }
  // Large budgets refine an already fitted graph. Inset rings add mostly
  // quadrilateral cells without hanging nodes or changing existing separators.
  // Paired middle/near meshes use the same new vertices and connectivity.
  function densifyMeshes(inputs,target) {
    let meshes=inputs.map(m=>assembleMesh(m.subcontours,target));
    if(meshes.some(m=>!m?.partitionAudit.valid))throw Error('密集分区的基础网格无效。');
    const initial=meshes[0].subcontours.length;let steps=0;
    while(meshes[0].subcontours.length<target){
      const remaining=target-meshes[0].subcontours.length;
      let accepted=null;
      const ranked=meshes[0].subcontours.slice().sort((a,b)=>b.area-a.area);
      for(const face of ranked){
        const n=face.segments.length,points=face.segments.map(s=>s.p0),center=points.reduce((p,q)=>add(p,mul(q,1/n)),[0,0]);
        const proposals=[];
        if(n<=remaining)for(const scale of [.45,.6,.3])proposals.push({mode:'inset',inner:points.map(p=>mix(center,p,scale))});
        if(n>=4)for(let a=0;a<n;a++)for(let b=a+2;b<n;b++)if(!(a===0&&b===n-1))proposals.push({mode:'diagonal',a,b});
        if(n-1<=remaining)proposals.push({mode:'fan',center});
        for(const proposal of proposals){
          const candidates=[];
          for(const mesh of meshes){
            const source=mesh.subcontours[face.id],ss=source.segments,children=[];
            const child=segments=>({...source,segments,denseParentId:source.denseParentId??source.id});
            if(proposal.mode==='inset'){
              const inner=proposal.inner;
              for(let i=0;i<n;i++){const j=(i+1)%n;children.push(child([ss[i],segmentFromLine(ss[i].p3,inner[j]),segmentFromLine(inner[j],inner[i]),segmentFromLine(inner[i],ss[i].p0)]));}
              children.push(child(inner.map((p,i)=>segmentFromLine(p,inner[(i+1)%n]))));
            }else if(proposal.mode==='fan'){
              for(const edge of ss)children.push(child([edge,segmentFromLine(edge.p3,proposal.center),segmentFromLine(proposal.center,edge.p0)]));
            }else{
              const {a,b}=proposal,arc=(start,end)=>{const out=[];for(let i=start;i!==end;i=(i+1)%n)out.push(ss[i]);return out;};
              children.push(child([...arc(a,b),segmentFromLine(ss[b].p0,ss[a].p0)]),child([...arc(b,a),segmentFromLine(ss[a].p0,ss[b].p0)]));
            }
            // Certify new straight separators against the original curved face.
            const ring=flatten(ss,.2),native=new Set(ss),contains=p=>insidePolygon(p,ring)||ring.some((a,i)=>pointSegment(p,a,ring[(i+1)%ring.length])<1e-5);
            if(children.some(c=>c.segments.some(s=>!native.has(s)&&Array.from({length:15},(_,i)=>bez(s,(i+1)/16)).some(p=>!contains(p))))){candidates.length=0;break;}
            const next=assembleMesh(mesh.subcontours.flatMap(p=>p.id===face.id?children:[p]),target);
            if(!next?.partitionAudit.valid||next.holeCount!==mesh.holeCount){candidates.length=0;break;}
            candidates.push(next);
          }
          if(candidates.length===meshes.length){accepted=candidates;break;}
        }
        if(accepted)break;
      }
      if(!accepted)break;meshes=accepted;steps++;
    }
    return meshes.map(m=>({...m,denseRefinementAudit:{mode:'shared inset rings / diagonal remainder',initialParts:initial,targetParts:target,actualParts:m.subcontours.length,steps,boundaryUnchanged:true}}));
  }
  function computeDense(input,w,h,options){
    const middleCount=options.middle.maxParts,ultraCount=options.ultra.maxParts;
    // Boundary fitting remains independent of the large interior cell budget.
    const coarseMiddle=middleCount>24?12:middleCount,coarseUltra=Math.min(ultraCount,Math.max(12,coarseMiddle));
    const result=compute(input,w,h,{...options,middle:{...options.middle,maxParts:coarseMiddle},ultra:{...options.ultra,maxParts:coarseUltra}});
    const levels=result.levels.slice(),baseMiddle=levels[2],baseNear=levels[3];
    function replace(base,mesh,count){
      const kinds=mesh.partitionAudit.kinds,valid=mesh.partitionAudit.valid;
      const aa=loopsOf(mesh).map(r=>audit(r,true)),outerKinds={I:0,C:0,S:0,MULTI:0,INVALID:0};for(const a of aa)for(const k of Object.keys(outerKinds))outerKinds[k]+=a.kinds[k];const outerAudit={...base.audit,kinds:outerKinds,closed:aa.every(a=>a.closed),maxGap:Math.max(...aa.map(a=>a.maxGap)),maxTypeSwitchDegrees:Math.max(...aa.map(a=>a.maxTypeSwitchDegrees)),maxSmoothTangentDegrees:Math.max(...aa.map(a=>a.maxSmoothTangentDegrees)),cornerJoins:aa.reduce((n,a)=>n+a.cornerJoins,0),invalidCorners:aa.reduce((n,a)=>n+a.invalidCorners,0),selfIntersections:aa.reduce((n,a)=>n+a.selfIntersections,0),valid:aa.every(a=>a.valid)&&valid};
      return {...base,...mesh,nodes:mesh.meshNodes,maxSubcontours:count,budget:count*PART_EDGE_LIMIT,countTargetReached:mesh.subcontours.length===count,
        audit:{...outerAudit,partitionValid:valid},ratioAudit:{...base.ratioAudit,actual:ratioAudit(kinds,{I:100,C:0,S:0}).actual},
        metRequirements:base.metTolerance&&valid&&mesh.partitionAudit.regularityPassed&&mesh.subcontours.length===count};
    }
    if(middleCount>coarseMiddle){
      const [middle,near]=densifyMeshes([baseMiddle,baseNear],middleCount);
      levels[2]=replace(baseMiddle,shortPreference(middle),middleCount);levels[3]=replace(baseNear,near,middleCount);
      const sameNodes=middle.meshNodes.length===near.meshNodes.length&&middle.meshNodes.every((p,i)=>dist(p,near.meshNodes[i])<1e-7),sameEdges=middle.partitionEdges.length===near.partitionEdges.length&&middle.partitionEdges.every((e,i)=>e.startNode===near.partitionEdges[i].startNode&&e.endNode===near.partitionEdges[i].endNode),sameFaces=middle.subcontours.length===near.subcontours.length&&middle.subcontours.every((p,i)=>p.segments.length===near.subcontours[i].segments.length);
      levels[3].topologyAudit={valid:sameNodes&&sameEdges&&sameFaces,partCount:near.subcontours.length,sameEdges,sameFaces,unchangedNodePositions:sameNodes};
      for(const e of levels[3].partitionEdges){e.baseEdgeId=e.id;e.baseT0=0;e.baseT1=1;}for(const p of levels[3].subcontours)p.parentId=p.id;
      const ancestry=hierarchyAudit(levels[3],levels[2]);levels[3].hierarchyAudit={...ancestry,mode:'topology',valid:levels[3].topologyAudit.valid,geometryPreserved:ancestry.valid};
    }
    let ultraBase=levels[4];
    if(middleCount>coarseMiddle){
      const parent=levels[3],faces=parent.subcontours.map(p=>({...p,parentId:p.id,regionType:'subdivision',segments:p.segments.map((s,i)=>({...s,baseEdgeId:p.edgeRefs[i].edge,baseT0:p.edgeRefs[i].reversed?1:0,baseT1:p.edgeRefs[i].reversed?0:1}))}));
      ultraBase={...parent,...assembleMesh(faces,ultraCount),id:'ultra',name:'超近',derivedFrom:'near',allowedKinds:['I','C','S'],adjacencyPolicy:{allowAdjacentC:true,allowAdjacentS:true},outlineRefinement:{adopted:false,reason:'密集分区保持已拟合边界'}};
      if(options.ultra.iOnly){
        const linear=assembleMesh(faces.map(p=>({...p,segments:p.segments.map(s=>({...s,...segmentFromLine(s.p0,s.p3)}))})),ultraCount);
        if(!linear?.partitionAudit.valid)throw Error('当前曲边无法直接转成仅I密集分区，请关闭仅I或减少中档分区。');
        ultraBase={...ultraBase,...linear,allowedKinds:['I']};
      }
    }
    const [ultra]=densifyMeshes([ultraBase],ultraCount);levels[4]=replace(ultraBase,ultra,ultraCount);
    delete levels[4].topologyAudit;
    levels[4].hierarchyAudit=hierarchyAudit(levels[4],levels[3],!!options.ultra.iOnly,options.ultraTolerance??1.1);
    levels[4].audit.valid&&=levels[4].hierarchyAudit.valid;
    levels[4].metRequirements&&=levels[4].audit.valid;
    const material=prepare(input,w,h).mask,sources=result.originalLoops||[result.original];for(const l of levels.slice(2)){l.iou=iou(material,rasterizeLoops(loopsOf(l).map(r=>flatten(r,1.2)),w,h));l.sourceError=boundaryDeviation(sources,l);l.audit.typePolicyValid=l.partitionEdges.every(e=>l.allowedKinds.includes(kind(e)));l.audit.valid&&=l.audit.typePolicyValid;l.metRequirements&&=l.audit.valid;}
    result.levels=levels;result.options=options;result.method+=' / large-budget conforming interior refinement';return result;
  }
  function compute(input,w=512,h=512,options={}) {
    const middleSettings=stageSettings({...options.middle,ratios:{I:100,C:0,S:0}},{maxParts:MIDDLE_PART_LIMIT,ratios:{I:100,C:0,S:0}}),nearSettings={maxParts:middleSettings.maxParts,automatic:true,ratios:null,curveInternal:options.near?.curveInternal??true},ultraSettings={maxParts:stageSettings({...options.ultra,ratios:{I:100,C:0,S:0}},{maxParts:NEAR_PART_LIMIT,ratios:{I:100,C:0,S:0}}).maxParts,automatic:true,ratios:null,iOnly:!!options.ultra?.iOnly};
    if(ultraSettings.maxParts<middleSettings.maxParts)throw Error('超近上限不能小于中档分区数。');
    options={...options,middle:middleSettings,near:nearSettings,ultra:ultraSettings};
    if(middleSettings.maxParts>24||ultraSettings.maxParts>24)return computeDense(input,w,h,options);
    const prepared=prepare(input,w,h),mask=prepared.mask,original=trace(mask,w,h),xs=original.map(p=>p[0]),ys=original.map(p=>p[1]),D=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
    if(traceAll(mask,w,h).length>1)return computeHoledPrepared(prepared,w,h,options);
    const body=robustBody(mask,w,h,D*(options.trim??.012)),rect=rectangle(trace(body.mask,w,h)),levels=[];
    const far=rect.points.map((p,i)=>segmentFromLine(p,rect.points[(i+1)%4]));levels.push({id:'far',name:'远',segments:decorate(far).map(s=>({...s,smooth:false})),sigma:0,tolerance:0,removed:body.removed,trimRadius:body.radius,bodyArea:count(body.mask),rectangleArea:rect.area});
    // Only small details may escape the low-edge cage. If cleanup removes too
    // much, lower its radius; large connected parts must remain in the body.
    const maxOutsideFraction=.02;let cageBody=body;
    while(cageBody.removed>count(mask)*maxOutsideFraction&&cageBody.radius>0)cageBody=robustBody(mask,w,h,cageBody.radius-1);
    const cageBoundary=trace(cageBody.mask,w,h),cage=enclosingPolygon(cageBoundary,FAR_MID_EDGE_LIMIT);
    levels.push({id:'farMid',name:'中远',segments:decorate(cage.points.map((p,i)=>segmentFromLine(p,cage.points[(i+1)%cage.points.length]))),budget:FAR_MID_EDGE_LIMIT,sigma:0,tolerance:null,representation:'I-only/body-enclosure',acceptance:'body-enclosure',envelopeMethod:cage.method,body:cageBody.mask,bodyBoundary:cageBoundary,removed:cageBody.removed,trimRadius:cageBody.radius,maxOutsideFraction});
    const detail=options.detail??1;
    for(const config of [{id:'middle',name:'中',scale:.006,tolerance:D*.0065,maxSubcontours:middleSettings.maxParts}]){
      const factor=detail,blurred=stableBlur(mask,w,h,config.scale*D*factor),target=resample(trace(blurred.mask,w,h),1),points=smoothPoints(target,.7),outerBudget=(PART_EDGE_LIMIT-2)*config.maxSubcontours+2;
      let selected=null;const candidates=[],seenFits=new Set(),ratios=middleSettings.ratios,fitCache={},middlePolicy={...middleSettings,noAdjacentC:true};
      for(let fitBudget=outerBudget;fitBudget>=3;fitBudget--)for(const fitted of fittingVariants(points,config.tolerance*factor,fitBudget,ratios,2*(config.maxSubcontours-1),fitCache)){
        const outer=decorate(fitted.segments);if(outer.length>outerBudget||hasAdjacentC(outer)||!audit(outer,true).valid)continue;
        const signature=JSON.stringify(outer.map(s=>[s.p0,s.p1,s.p2,s.p3]));if(seenFits.has(signature))continue;seenFits.add(signature);
        const residual=deviation(resample(points,3),resample(flatten(outer,2),3));
        candidates.push({fitBudget,fitted:{...fitted,fittingResidual:residual},outer});
      }
      let bestCost=Infinity,checkedAfterValid=0;
      for(const {fitBudget,fitted,outer}of candidates.sort((a,b)=>a.fitted.fittingResidual-b.fitted.fittingResidual)){
        const splitResult=partitionWithSeamNodes(outer,config.maxSubcontours,true,outerBudget,middlePolicy);if(!splitResult)continue;const {partition}=splitResult;
        // Fit is evaluated before square preference; no triangle ban or dummy sides.
        const ratio=ratioAudit(partition.audit.kinds,ratios),relativeError=fitted.fittingResidual/Math.max(1,config.tolerance*factor),cost=.35*partition.audit.shapeCost+3*relativeError**2+4*(ratio.deviation/100)**2+.025*splitResult.segments.length;
        if(cost<bestCost){bestCost=cost;selected={...fitted,segments:splitResult.segments,subcontours:partition.subcontours,partitionEdges:partition.partitionEdges,partitionAudit:partition.audit,fittingBudget:fitBudget};}
        if(++checkedAfterValid>=6)break;
      }
      if(!selected)throw Error(config.name+'档在子轮廓预算内未找到有效拆分。请提高上限或调整窗口。');
      if(selected.subcontours.length<config.maxSubcontours){const mesh=subdivideBoundaryCells(assembleMesh(selected.subcontours,config.maxSubcontours),config.maxSubcontours,config.maxSubcontours,true);selected={...selected,...mesh,partitionAudit:mesh.partitionAudit};}
      selected=improveMiddleCells(selected,config.maxSubcontours);
      levels.push({...config,...selected,budget:config.maxSubcontours*PART_EDGE_LIMIT,outerEdgeBudget:outerBudget,maxEdgesPerSubcontour:PART_EDGE_LIMIT,tolerance:config.tolerance*factor,sigma:blurred.sigma,target});
    }
    const middle=levels.at(-1),nearBlur=stableBlur(mask,w,h,.003*D),nearTarget=smoothPoints(resample(trace(nearBlur.mask,w,h),1),.7),near=curveOnMiddle(middle,nearTarget,D*.004,nearSettings,{mask,width:w,height:h});
    levels.push({id:'near',name:'近',...near,sigma:nearBlur.sigma,tolerance:D*.004,target:nearTarget});
    const nearLevel=levels.at(-1),ultraBlur=stableBlur(mask,w,h,.0008*D),ultraTarget=smoothPoints(resample(trace(ultraBlur.mask,w,h),1),.7),initialUltra=nearFromMiddle(nearLevel,ultraTarget,mask,w,h,options.ultraTolerance??options.nearTolerance??1.1,{...ultraSettings,targetParts:ultraSettings.maxParts}),ultra=refitOuterLoop(refitUltraBoundary(initialUltra,nearLevel,[ultraTarget],mask,w,h,options.ultraTolerance??options.nearTolerance??1.1,ultraSettings),nearLevel,[ultraTarget],mask,w,h,options.ultraTolerance??options.nearTolerance??1.1,ultraSettings,[original]);
    levels.push({id:'ultra',name:'超近',...ultra,sigma:ultraBlur.sigma,tolerance:options.ultraTolerance??options.nearTolerance??1.1,target:ultraTarget});
    for(const l of levels){if(l.segments.some(s=>s.kind==='INVALID'))throw Error('拟合出现回折直线，请调小容差或调整轮廓。');l.nodes=l.meshNodes||l.segments.map(s=>s.p0.slice());l.audit=audit(l.segments,l.id==='far'||l.id==='farMid'||!!l.subcontours);l.allowedKinds=['far','farMid','middle'].includes(l.id)||l.id==='ultra'&&ultraSettings.iOnly?['I']:['I','C','S'];l.audit.typePolicyValid=l.segments.every(s=>l.allowedKinds.includes(s.kind))&&(l.id!=='middle'||l.partitionAudit.typeQuotaValid&&l.subcontours.every(p=>middleSettings.ratios.S>0||p.kinds.S===0));l.audit.partitionValid=l.partitionAudit?l.partitionAudit.valid:true;l.audit.valid=l.audit.valid&&l.audit.typePolicyValid&&l.audit.partitionValid&&(!l.topologyAudit||l.topologyAudit.valid);let straightLength=0,totalLength=0;for(const s of l.segments){let length=0;for(let j=0;j<24;j++)length+=dist(bez(s,j/24),bez(s,(j+1)/24));totalLength+=length;if(s.kind==='I')straightLength+=length;}l.straightFraction=totalLength?straightLength/totalLength:0;const polygon=flatten(l.segments,1.2);const filled=rasterize(polygon,w,h);l.iou=iou(mask,filled);l.sourceError=deviation(resample(original,2),resample(polygon,2));l.targetError=l.target?deviation(resample(l.target,2),resample(polygon,2)):null;l.groupCount=new Set(l.segments.map(s=>s.group)).size;l.metTolerance=l.acceptance==='body-enclosure'?null:l.targetError===null||l.targetError<=l.tolerance+.5;l.metRequirements=l.metTolerance&&l.audit.partitionValid&&(!l.partitionAudit||l.partitionAudit.regularityPassed);if(l.id==='middle'){l.budgetHit=!l.metTolerance;l.targetCurveCountFraction=middleSettings.ratios.C/100;l.logicalSegments=logicalOutline(l.segments);l.audit.noAdjacentC=!hasAdjacentC(l.logicalSegments)&&l.subcontours.every(p=>!hasAdjacentC(p.segments));l.audit.valid=l.audit.valid&&l.audit.noAdjacentC;}
      if(l.acceptance==='body-enclosure'){
        let bodyOutside=0,sourceOutside=0;for(let i=0;i<mask.length;i++){if(l.body[i]&&!filled[i])bodyOutside++;if(mask[i]&&!filled[i])sourceOutside++;}
        let maxBodyViolation=0;for(const s of l.segments){const direction=unit(sub(s.p3,s.p0));for(const p of l.bodyBoundary)maxBodyViolation=Math.max(maxBodyViolation,-cross(direction,sub(p,s.p0)));}
        const bodyArea=count(l.body),sourceArea=count(mask),envelopeArea=Math.abs(area(l.segments.map(s=>s.p0)));
        l.enclosure={bodyArea,bodyOutsidePixels:bodyOutside,bodyCoverage:1-bodyOutside/bodyArea,sourceOutsidePixels:sourceOutside,sourceOutsideFraction:sourceOutside/sourceArea,sourceCoverage:1-sourceOutside/sourceArea,maxBodyViolation,area:envelopeArea,emptyArea:Math.max(0,envelopeArea-sourceArea+sourceOutside),maxOutsideFraction:l.maxOutsideFraction};
        l.metRequirements=bodyOutside===0&&maxBodyViolation<1e-6&&sourceOutside/sourceArea<=l.maxOutsideFraction&&l.segments.length<=l.budget;
        delete l.body;delete l.bodyBoundary;
      }
      if(l.partitionAudit){
        if(l.id==='near'||l.id==='ultra'){
          const actual=Object.fromEntries(TYPE_KEYS.map(k=>[k,100*l.partitionAudit.kinds[k]/l.partitionAudit.sideCount]));l.ratioAudit={actual,target:null,deviation:null,close:true,counting:'part-sides/shared-twice',automatic:true,softTarget:false};l.audit.SwithinLimit=null;if(l.id==='near')l.audit.noAdjacentC=!hasAdjacentC(l.segments)&&l.subcontours.every(p=>!hasAdjacentC(p.segments));l.audit.noAdjacentS=!hasAdjacentS(l.segments)&&l.subcontours.every(p=>!hasAdjacentS(p.segments));l.audit.adjacencyPolicyValid=l.id==='ultra'||l.audit.noAdjacentC&&l.audit.noAdjacentS;l.audit.valid&&=l.audit.adjacencyPolicyValid;l.adjacencyPolicy={allowCC:l.id==='ultra',allowSS:l.id==='ultra'};
        }else l.ratioAudit=ratioAudit(l.partitionAudit.kinds,middleSettings.ratios);
      }
      l.audit.cPrimitiveValid=(l.partitionEdges||l.segments).every(e=>e.kind!=='C'||kind(e)==='C'&&simpleC(e));l.audit.valid=l.audit.valid&&l.audit.cPrimitiveValid;
      if(l.id==='middle'||l.id==='ultra'){l.countTargetReached=l.subcontours.length===l.maxSubcontours;l.metRequirements=l.metRequirements&&l.countTargetReached;}l.metRequirements=l.metRequirements&&l.audit.valid&&l.hierarchyAudit?.approximationToleranceMet!==false;
      delete l.target;}
    return {version:16,width:w,height:h,inputArea:count(mask),discarded:prepared.discarded,inputComponents:prepared.components,diagonal:D,original,levels,options,method:'binary-mask / separable Gaussian / support envelope + budgeted balanced I/C / middle I-only graph / near fixed-topology quota-free I/C/S no-CC/no-SS / ultra child partitions + source boundary refit after subdivision / dynamic part budgets / near and ultra without type quotas / analytic inflection classification'};
  }
  function viewBox(segments,w=512,h=512){const p=segments.flatMap(s=>[s.p0,s.p1,s.p2,s.p3]),x0=Math.min(0,...p.map(p=>p[0]-4)),y0=Math.min(0,...p.map(p=>p[1]-4));return [x0,y0,Math.max(w,...p.map(p=>p[0]+4))-x0,Math.max(h,...p.map(p=>p[1]+4))-y0];}
  const fmt=n=>Number(n.toFixed(5));
  function segmentPath(s,move=true){return (move?`M ${s.p0.map(fmt).join(' ')} `:'')+(s.kind==='I'?`L ${s.p3.map(fmt).join(' ')}`:`C ${s.p1.map(fmt).join(' ')} ${s.p2.map(fmt).join(' ')} ${s.p3.map(fmt).join(' ')}`);}
  function path(segments){return segments.map((s,i)=>segmentPath(s,i===0)).join(' ')+' Z';}
  const partColor=(i,parentId=null,exterior=false)=>exterior?'hsl(30 48% 80%)':`hsl(${(125+(parentId??i)*137.5)%360} 27% ${parentId==null?82:78+(i%3)*4}%)`;
  function svg(result,index){const l=result.levels[index],prefix=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(boundarySegments(l),result.width,result.height).map(fmt).join(' ')}"><title>${l.name} — I/C/S contour</title>`;
    if(l.subcontours)return prefix+`<g id="subcontours">${l.subcontours.map(p=>`<path d="${path(p.segments)}" fill="${partColor(p.id,p.parentId,p.regionType==='exterior')}" data-part-id="${p.id}" data-edge-count="${p.segments.length}" ${p.parentId!==undefined?`data-parent-id="${p.parentId}" data-region-type="${p.regionType}"`:""}/>`).join('')}</g>${l.logicalSegments?`<g id="logical-outline">${l.logicalSegments.map((s,i)=>`<path d="${segmentPath(s)}" fill="none" stroke="${{I:'#3371bb',C:'#158873',S:'#bd6c3b'}[s.kind]}" stroke-width="1.2" data-vector-curve="${i}"/>`).join('')}</g>`:''}<g id="shared-edge-graph">${l.partitionEdges.map(e=>`<path d="${segmentPath(e)}" fill="none" stroke="${e.role==='internal'?'#977b60':l.logicalSegments?'none':{I:'#3371bb',C:'#158873',S:'#bd6c3b'}[e.kind]}" stroke-width="1.2" ${e.role==='internal'?'stroke-dasharray="3 2"':''} data-edge-id="${e.id}" ${e.curveId!==undefined?`data-curve-id="${e.curveId}" data-curve-t0="${e.curveT0}" data-curve-t1="${e.curveT1}"`:''} data-role="${e.role}" data-kind="${e.kind}" data-smooth-group="${e.group??-1}"/>`).join('')}</g></svg>`;
    return prefix+`<path d="${boundaryPath(l)}" fill-rule="evenodd" fill="#e0eee7" stroke="none"/>${boundarySegments(l).map(s=>`<path d="${segmentPath(s)}" fill="none" stroke="${{I:'#3371bb',C:'#158873',S:'#bd6c3b'}[s.kind]}" stroke-width="1.5" data-kind="${s.kind}" data-smooth-group="${s.group}" data-smooth="${s.smooth?'true':'false'}"/>`).join('')}</svg>`;
  }
  return {densifyMeshes,polygonShape,improveMiddleCells,refitOuterLoop,refitHoleLoops,refitUltraBoundary,partSidePolicy,parallelMeasure,middleWithHoles,refineHoledParent,holedChains,maskInfo,traceAll,rasterizeLoops,boundarySegments,boundaryPath,boundaryDeviation,triangulateRings,partitionRings,curveHoledMiddle,simpleC,curveSharedEdges,refineFromParent:nearFromMiddle,pointSegment,curveOnMiddle,subdivideBoundaryCells,compute,sameC,logicalOutline,splitDeclared,hasAdjacentC,limitS,outerTypeTargets,hasAdjacentS,separateS,stageSettings,ratioAudit,typedPreference,mergeCurves,prepare,trace,resample,smoothPoints,robustBody,gaussian,rectangle,enclosingPolygon,bez,derivatives,inflections,kind,split,fit,fitLinearStage,polygonKnots,partitionContour,buildPartition,refine,flatten,audit,rasterize,iou,deviation,path,segmentPath,area,decorate,validSegments,svg,viewBox,partColor,curveArea,rectangularity,assembleMesh,nearFromMiddle,hierarchyAudit};
}
if(typeof module!=='undefined'&&module.exports)module.exports=makeContourEngine();
if(typeof window!=='undefined')window.makeContourEngine=makeContourEngine;
