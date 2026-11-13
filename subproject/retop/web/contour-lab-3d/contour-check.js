// View-dependent diagnostics only. Never writes to geometry or CSI partitions.
function createContourCheck(E){
  'use strict';
  const cache=new WeakMap();
  function prepare(mesh){if(!cache.has(mesh)){const t=E.triangulate(mesh);cache.set(mesh,{vertices:mesh.vertices,faces:t.faces});}return cache.get(mesh);}
  function raster(mesh,project,w,h){
    const depth=new Float64Array(w*h);depth.fill(Infinity);
    const points=mesh.vertices.map(p=>{const q=project(p);return [q[0]*w,q[1]*h,q[2]];});
    for(const f of mesh.faces){const [a,b,c]=f.map(i=>points[i]);if(![...a,...b,...c].every(Number.isFinite))continue;
      const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-12)continue;
      const x0=Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0])-.5)),x1=Math.min(w-1,Math.floor(Math.max(a[0],b[0],c[0])-.5)),y0=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5)),y1=Math.min(h-1,Math.floor(Math.max(a[1],b[1],c[1])-.5));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/den,v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/den,z=1-u-v;if(u< -1e-9||v< -1e-9||z< -1e-9)continue;const d=u*a[2]+v*b[2]+z*c[2],i=y*w+x;if(d>=-1&&d<=1&&d<depth[i])depth[i]=d;}
    }
    const mask=Uint8Array.from(depth,d=>Number.isFinite(d)?1:0),border=[],segments=[],lo=[w,h],hi=[0,0];let area=0,clipped=false;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!mask[i])continue;area++;lo[0]=Math.min(lo[0],x);lo[1]=Math.min(lo[1],y);hi[0]=Math.max(hi[0],x+1);hi[1]=Math.max(hi[1],y+1);if(x===0||y===0||x===w-1||y===h-1){clipped=true;continue;}
      const edges=[];if(!mask[i-w])edges.push([x,y,x+1,y]);if(!mask[i+1])edges.push([x+1,y,x+1,y+1]);if(!mask[i+w])edges.push([x+1,y+1,x,y+1]);if(!mask[i-1])edges.push([x,y+1,x,y]);if(edges.length){border.push(i);for(const edge of edges)segments.push({pixel:i,edge});}
    }
    return {depth,mask,border,segments,area,lo,hi,clipped};
  }
  // Eight-neighbour chamfer distance in isotropic raster pixels, not an exact
  // analytic Hausdorff distance. Holes and both directions are included.
  function distance(seeds,w,h){const d=new Float32Array(w*h);d.fill(Infinity);for(const i of seeds)d[i]=0;const k=Math.SQRT2;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x)d[i]=Math.min(d[i],d[i-1]+1);if(y){d[i]=Math.min(d[i],d[i-w]+1);if(x)d[i]=Math.min(d[i],d[i-w-1]+k);if(x+1<w)d[i]=Math.min(d[i],d[i-w+1]+k);}}
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(x+1<w)d[i]=Math.min(d[i],d[i+1]+1);if(y+1<h){d[i]=Math.min(d[i],d[i+w]+1);if(x)d[i]=Math.min(d[i],d[i+w-1]+k);if(x+1<w)d[i]=Math.min(d[i],d[i+w+1]+k);}}return d;
  }
  function cubic(c,t){const s=1-t;return [0,1,2].map(k=>s*s*s*c.p0[k]+3*s*s*t*c.p1[k]+3*s*t*t*c.p2[k]+t*t*t*c.p3[k]);}
  function curvePixels(curves,project,source,w,h){const seeds=new Set();let visibleSamples=0;
    for(const c of curves||[]){if(![c.p0,c.p1,c.p2,c.p3].every(p=>p?.length===3))continue;const anchors=c.displaySamples||c.samples;let previous=null;
      for(let j=0;j<=192;j++){const t=j/192,p=project(cubic(c,t));let anchor=p;if(anchors?.length>1){const a=t*(anchors.length-1),i=Math.min(anchors.length-2,Math.floor(a)),u=a-i;anchor=project(anchors[i].map((v,k)=>v*(1-u)+anchors[i+1][k]*u));}
        const x=anchor[0]*w,y=anchor[1]*h;let front=-Infinity;for(let yy=Math.floor(y)-1;yy<=Math.floor(y)+1;yy++)for(let xx=Math.floor(x)-1;xx<=Math.floor(x)+1;xx++)if(xx>=0&&yy>=0&&xx<w&&yy<h){const d=source.depth[yy*w+xx];if(Number.isFinite(d))front=Math.max(front,d);}
        const visible=Number.isFinite(front)&&anchor[2]>=-1&&anchor[2]<=front+.002;if(!visible){previous=null;continue;}visibleSamples++;const q=[p[0]*w,p[1]*h],steps=previous?Math.max(1,Math.ceil(Math.hypot(q[0]-previous[0],q[1]-previous[1])*2)):1;
        for(let k=0;k<=steps;k++){const u=k/steps,xx=Math.floor(previous?previous[0]*(1-u)+q[0]*u:q[0]),yy=Math.floor(previous?previous[1]*(1-u)+q[1]*u:q[1]);if(xx>=0&&yy>=0&&xx<w&&yy<h)seeds.add(yy*w+xx);}previous=q;
      }
    }return {seeds:[...seeds],visibleSamples};
  }
  function analyze(source,candidate,curves,project,options={}){
    const resolution=Math.max(96,Math.min(768,options.resolution||480)),aspect=Math.max(.1,Math.min(10,options.aspect||1)),w=Math.round(aspect>=1?resolution:resolution*aspect),h=Math.round(aspect>=1?resolution/aspect:resolution),a=raster(prepare(source),project,w,h),b=raster(prepare(candidate),project,w,h),diagonal=Math.hypot(a.hi[0]-a.lo[0],a.hi[1]-a.lo[1]),tolerance=options.tolerance??.015;
    if(!a.area||!b.area||!a.border.length||!b.border.length)return {report:{available:false,reason:'轮廓不可见，请缩小或调整视角。',clipped:a.clipped||b.clipped},w,h,source:a,candidate:b};
    const da=distance(a.border,w,h),db=distance(b.border,w,h),c=curvePixels(curves,project,a,w,h),dc=distance(c.seeds,w,h),limit=Math.max(1,tolerance*diagonal),missing=new Set(a.border.filter(i=>dc[i]>limit)),sourceBad=new Set(a.border.filter(i=>db[i]>limit)),candidateBad=new Set(b.border.filter(i=>da[i]>limit)),upper=a.border.filter(i=>Math.floor(i/w)+.5<=a.lo[1]+(a.hi[1]-a.lo[1])*.35),values=[...a.border.map(i=>db[i]),...b.border.map(i=>da[i])].sort((x,y)=>x-y);let union=0,intersection=0;for(let i=0;i<a.mask.length;i++){if(a.mask[i]||b.mask[i])union++;if(a.mask[i]&&b.mask[i])intersection++;}
    const report={available:true,method:'screen-depth-mask-chamfer',resolution:[w,h],tolerance,clipped:a.clipped||b.clipped,sourceSamples:a.border.length,candidateSamples:b.border.length,rasterUncertainty:Math.SQRT2/diagonal,maxRelative:values.at(-1)/diagonal,meanRelative:values.reduce((s,v)=>s+v,0)/values.length/diagonal,p95Relative:values[Math.floor((values.length-1)*.95)]/diagonal,shapeOutsideFraction:(sourceBad.size+candidateBad.size)/values.length,iou:intersection/union,csiCoverage:1-missing.size/a.border.length,upperMissingFraction:upper.length?upper.filter(i=>missing.has(i)).length/upper.length:0,upperSamples:upper.length,visibleCurveSamples:c.visibleSamples,curveCount:curves?.length||0};
    return {report,w,h,source:a,candidate:b,missing,sourceBad,candidateBad};
  }
  return {prepare,analyze};
}
if(typeof window!=='undefined')window.createContourCheck=createContourCheck;
if(typeof module!=='undefined')module.exports=createContourCheck;
