// 在同一高模的多张横截面上寻找稳定闭环。低预算下沿这类闭环保留纵向转折。
function createContourProfileSurface(E) {
  function nearest(p,loop) {
    let distance=Infinity,point=null;
    for(let j=0;j<loop.length;j++){
      const a=loop[j],b=loop[(j+1)%loop.length],x=b[0]-a[0],y=b[1]-a[1];
      const u=E.clamp(((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1),0,1);
      const q=[a[0]+x*u,a[1]+y*u],d=Math.hypot(q[0]-p[0],q[1]-p[1]);
      if(d<distance){point=q;distance=d;}
    }
    return {distance,point};
  }

  function contours(triangles,points,height) {
    const nodes=new Map(),neighbors=new Map();
    for(const f of triangles){
      const hits=[];
      for(let k=0;k<3;k++){
        const a=f[k],b=f[(k+1)%3],p=points[a],q=points[b];
        if((p[2]>height)===(q[2]>height))continue;
        const t=(height-p[2])/(q[2]-p[2]),key=E.key(a,b);
        nodes.set(key,[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);hits.push(key);
      }
      if(hits.length!==2)continue;
      hits.forEach((node,i)=>{
        if(!neighbors.has(node))neighbors.set(node,[]);
        neighbors.get(node).push(hits[1-i]);
      });
    }
    const seen=new Set(),loops=[];
    for(const start of nodes.keys()){
      if(seen.has(start))continue;
      let v=start,closed=true;
      const loop=[];
      while(!seen.has(v)){
        seen.add(v);loop.push(nodes.get(v));
        const next=neighbors.get(v)||[];
        if(next.length!==2){closed=false;break;}
        v=next.find(id=>!seen.has(id))??start;
      }
      if(closed&&v===start&&loop.length>10)loops.push(loop);
    }
    return loops;
  }

  function simplifyRing(loop,error) {
    const ids=[0,Math.floor(loop.length/3),Math.floor(2*loop.length/3)];
    for(;;){
      let largest=error,insert=-1;
      for(let k=0;k<ids.length;k++){
        const a=ids[k],b=ids[(k+1)%ids.length];
        for(let i=(a+1)%loop.length;i!==b;i=(i+1)%loop.length){
          const d=nearest(loop[i],[loop[a],loop[b]]).distance;
          if(d>largest){largest=d;insert=i;}
        }
      }
      if(insert<0)return ids.map(i=>loop[i]);
      ids.push(insert);ids.sort((a,b)=>a-b);
    }
  }

  function loftBand(source, section, frame) {
    const {lo, hi, loop} = section, {axis, tangent, bitangent, center, spacing} = frame;
    const v = source.vertices.map(p => p.slice()), to2 = p => [
        E.dot(p, tangent),
        E.dot(p, bitangent)
      ], level = p => E.dot(E.sub(p, center), axis), levels = v.map(level), z0 = section.rows ? lo : lo + (hi - lo) * 0.24, z1 = section.rows ? hi : hi - (hi - lo) * 0.2;
    const tri = E.triangulate(source), data = tri.faces.map(f => ({
        f,
        lo: Math.min(...f.map(i => levels[i])),
        hi: Math.max(...f.map(i => levels[i]))
      }));
    const cuts = data.map(d => d.lo < z1 && d.hi > z0), adj = E.topology(tri), seen = new Set();
    let region = null, score = Infinity;
    // 截面平面也可能穿过手臂，按面邻接只选与装备参考轮廓相符的连通块。
    for (let i = 0; i < cuts.length; i++) {
      if (!cuts[i] || seen.has(i))
        continue;
      const ids = [i];
      seen.add(i);
      for (let j = 0; j < ids.length; j++) {
        const f = tri.faces[ids[j]];
        for (let k = 0; k < 3; k++) {
          const a = f[k], b = f[(k + 1) % 3];
          if (Math.min(levels[a], levels[b]) >= z1 || Math.max(levels[a], levels[b]) <= z0)
            continue;
          for (const n of adj.edges.get(E.key(a, b)).faces)
            if (cuts[n] && !seen.has(n)) {
              ids.push(n);
              seen.add(n);
            }
        }
      }
      const mid = ids.filter(i => data[i].lo <= (lo + hi) / 2 && data[i].hi >= (lo + hi) / 2);
      if (!mid.length)
        continue;
      const xy = mid.map(i => to2(v[data[i].f[0]])), d = loop.reduce((s, p) => s + xy.reduce((best, q) => Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity), 0) / loop.length;
      if (d < score) {
        score = d;
        region = new Set(ids);
      }
    }
    if (!region || score > spacing)
      return null;
    // 在源三角形内部精确裁剪，两端的相邻面通过同一个交点索引连接。
    const faces = [], edges = [
        new Map(),
        new Map()
      ], cache = new Map();
    function cross(a, b, h, k) {
      const key = k + ',' + E.key(a, b);
      if (cache.has(key))
        return cache.get(key);
      const t = (h - levels[a]) / (levels[b] - levels[a]), idx = v.length;
      v.push(E.add(v[a], E.mul(E.sub(v[b], v[a]), t)));
      levels.push(h);
      cache.set(key, idx);
      return idx;
    }
    function clip(f, h, k) {
      const ids = [], keep = a => k ? levels[a] >= h : levels[a] <= h;
      for (let i = 0; i < 3; i++) {
        const a = f[i], b = f[(i + 1) % 3];
        if (keep(a))
          ids.push(a);
        if (keep(a) !== keep(b))
          ids.push(cross(a, b, h, k));
      }
      if (ids.length < 3)
        return;
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i], b = ids[(i + 1) % ids.length];
        if (levels[a] === h && levels[b] === h)
          edges[k].set(b, a);
      }
      for (let i = 1; i + 1 < ids.length; i++)
        faces.push([
          ids[0],
          ids[i],
          ids[i + 1]
        ]);
    }
    data.forEach(({f}, i) => {
      if (!region.has(i))
        faces.push(f);
      else {
        clip(f, z0, 0);
        clip(f, z1, 1);
      }
    });
    function cycle(edges) {
      const ids = [], first = edges.keys().next().value;
      let p = first;
      do {
        if (p === undefined || ids.length >= edges.size)
          return null;
        ids.push(p);
        p = edges.get(p);
      } while (p !== first);
      return ids.length === edges.size ? ids : null;
    }
    const ends = edges.map(cycle);
    if (ends.some(r => !r || r.length * loop.length > 1000000))
      return null;
    const origin = E.dot(center, axis), world = (p, h) => E.add(E.mul(axis, origin + h), E.add(E.mul(tangent, p[0]), E.mul(bitangent, p[1])));
    const addRing = (h, outline=loop) => outline.map(p => {
      const id = v.length;
      v.push(world(p, p[2]??h));
      return id;
    });
    const rings = section.rows ? section.rows.map(row=>addRing(row.h,row.loop)) : [
      addRing(z0 + (z1 - z0) * 0.08),
      addRing(z1 - (z1 - z0) * 0.08)
    ];
    const area = r => r.reduce((s, i, k) => {
      const p = to2(v[i]), q = to2(v[r[(k + 1) % r.length]]);
      return s + p[0] * q[1] - p[1] * q[0];
    }, 0);
    // 两端条带均从已保留面的反向边开始，公共中间段只生成一次。
    if (area(ends[0]) * area(rings[0]) < 0)
      rings.forEach(r => r.reverse());
    function bridge(a, b) {
      const pa = to2(v[a[0]]);
      let start = 0, dist = Infinity;
      b.forEach((id, k) => {
        const q = to2(v[id]), d = Math.hypot(pa[0] - q[0], pa[1] - q[1]);
        if (d < dist) {
          dist = d;
          start = k;
        }
      });
      b = b.slice(start).concat(b.slice(0, start));
      // 动态规划以最短跨环边构成单调三角带，防止两个轮廓长度不同而累积错位。
      const n = a.length, m = b.length, cost = new Float64Array((n + 1) * (m + 1)), via = new Uint8Array(cost.length);
      cost.fill(Infinity);
      cost[0] = 0;
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= m; j++) {
          if (!i && !j)
            continue;
          const k = i * (m + 1) + j, da = i ? cost[k - m - 1] : Infinity, db = j ? cost[k - 1] : Infinity;
          via[k] = da <= db ? 1 : 2;
          cost[k] = Math.min(da, db) + E.dist(v[a[i % n]], v[b[j % m]]) ** 2;
        }
      let i = n, j = m;
      while (i || j) {
        if (via[i * (m + 1) + j] === 1) {
          faces.push([
            a[(i - 1) % n],
            a[i % n],
            b[j % m]
          ]);
          i--;
        } else {
          faces.push([
            a[i % n],
            b[j % m],
            b[(j - 1) % m]
          ]);
          j--;
        }
      }
    }
    bridge(ends[0], rings[0]);
    for(let row=1;row<rings.length;row++){
      const lower=rings[row-1],upper=rings[row];
      for(let i=0;i<lower.length;i++){
        const j=(i+1)%lower.length;
        faces.push([lower[i],lower[j],upper[i]],[lower[j],upper[j],upper[i]]);
      }
    }
    bridge(rings.at(-1), ends[1].slice().reverse());
    // 将上下截面推近稳定带边缘，带外通过短区间渐变恢复真实衣物与袋底的位置。
    const lower = lo + (hi - lo) * 0.1, upper = hi - (hi - lo) * 0.11, newZ = z => {
        if (z < z0)
          return z + (lower - z0) * E.clamp((z - (lo - spacing * 0.5)) / (z0 - lo + spacing * 0.5), 0, 1);
        if (z > z1)
          return z + (upper - z1) * E.clamp((hi + spacing * 0.5 - z) / (hi + spacing * 0.5 - z1), 0, 1);
        return lower + (z - z0) * (upper - lower) / (z1 - z0);
      };
    for (let i = 0; !section.rows && i < v.length; i++) {
      const p = to2(v[i]), z = i < levels.length ? levels[i] : level(v[i]);
      if (z < lo - spacing * 0.5 || z > hi + spacing * 0.5)
        continue;
      const d = nearest(p, loop).distance;
      v[i] = E.add(v[i], E.mul(axis, (newZ(z) - z) * E.clamp((spacing * 1.5 - d) / spacing, 0, 1)));
    }
    const remap = new Map(), vertices = [], result = faces.map(f => f.map(i => {
        if (!remap.has(i)) {
          remap.set(i, vertices.length);
          vertices.push(v[i]);
        }
        return remap.get(i);
      }));
    return {
      vertices,
      faces: result,
      rails: rings.flat().map(i => remap.get(i)),
      rows: rings.map(row=>row.map(i=>remap.get(i))),
      spacing,
      sourceToShape: source.vertices.map((_, i) => remap.has(i) ? remap.get(i) : -1)
    };
  }

  function build(source,features,budget,landmark,manualEdges=[]) {
    const {axes,center}=E.frame(source),top=E.topology(source),tri=E.triangulate(source);
    const spacing=Math.sqrt(top.data.reduce((s,d)=>s+d.area,0)/budget);
    const candidates=features.patches.filter(p=>Math.abs(E.dot(p.normal,axes[0]))>.99);
    const scored=candidates.map(p=>({axis:p.normal,area:top.data.reduce((s,d)=>
      s+d.area*Math.max(0,(Math.abs(E.dot(d.normal,p.normal))-.95)/.05),0)}));
    if(!scored.length)return null;
    const axis=scored.sort((a,b)=>b.area-a.area)[0].axis;
    const tangent=E.unit(E.cross(axis,axes[1])),bitangent=E.cross(axis,tangent);
    const points=source.vertices.map(v=>[E.dot(v,tangent),E.dot(v,bitangent),E.dot(E.sub(v,center),axis)]);
    const bins=new Map(),pitch=spacing*.2;
    for(const d of top.data){
      const k=Math.round(E.dot(E.sub(d.center,center),axis)/pitch);
      const w=d.area*Math.max(0,(Math.abs(E.dot(d.normal,axis))-.85)/.15);
      bins.set(k,(bins.get(k)||0)+w);
    }
    const peaks=[];
    for(const [k,w] of [...bins].sort((a,b)=>b[1]-a[1])){
      if(w<=spacing**2*2||peaks.length===8)break;
      if(peaks.every(v=>Math.abs(v-k)>8))peaks.push(k);
    }
    const heights=peaks.map(k=>k*pitch).sort((a,b)=>a-b),rings=[];
    for(let i=1;i<heights.length;i++){
      const lo=heights[i-1],hi=heights[i],span=hi-lo;
      if(span<spacing*1.6||span>spacing*6)continue;
      const slices=[.18,.35,.5,.65,.82].map(k=>contours(tri.faces,points,lo+span*k));
      for(const loop of slices[2]){
        const others=[0,1,3,4].map(j=>slices[j].map(r=>({r,d:nearest(loop[0],r).distance})).sort((a,b)=>a.d-b.d)[0]?.r);
        if(others.some(r=>!r))continue;
        const drift=loop.map(p=>others.map(r=>nearest(p,r).distance).sort((a,b)=>a-b)[2]).sort((a,b)=>a-b);
        if(drift[Math.floor(drift.length*.8)]<=spacing*.42)rings.push({lo,hi,loop:simplifyRing(loop,spacing*.12)});
      }
    }
    if(!rings.length)return null;
    if(landmark){
      // 选择头部下方、有足够横向跨度的闭环。衣袖与鞋底的独立小截面继续采用普通截面约束。
      const eligible=rings.filter(r=>{
        const middle=(r.hi+r.lo)*.5+E.dot(center,axis);
        const local=r.loop.map(p=>landmark.map.local(E.add(E.mul(axis,middle),E.add(E.mul(tangent,p[0]),E.mul(bitangent,p[1])))));
        const y=local.reduce((s,p)=>s+p[1],0)/local.length,span=Math.max(...local.map(p=>p[0]))-Math.min(...local.map(p=>p[0]));
        return y<landmark.h-landmark.width*.65&&y>landmark.h-landmark.width*1.5&&span>landmark.width&&r.loop.length*2<budget/6;
      }).sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo));
      const previous=eligible.length?E.audit(source):null;
      const manualVertices=manualEdges.flatMap(edge=>edge.split(':').map(Number));
      for(const section of eligible){
        const loft=loftBand(source,section,{axis,tangent,bitangent,center,spacing});
        if(!loft||manualVertices.some(v=>loft.sourceToShape[v]<0))continue;
        const result=E.audit(loft);
        if(result.valid&&result.components===previous.components&&result.boundaryLoops===previous.boundaryLoops
          &&String(result.euler)===String(previous.euler))return {...loft,rings:1};
      }
    }
    const vertices=points.map((p,i)=>{
      let best=Infinity,out=source.vertices[i].slice();
      for(const r of rings){
        const dz=Math.max(0,r.lo-p[2],p[2]-r.hi);
        if(dz>spacing*.25)continue;
        const {point:q,distance:d}=nearest(p,r.loop);
        if(d>=best||d>spacing*.8)continue;
        const w=(1-dz/(spacing*.25))*E.clamp((spacing*.8-d)/(spacing*.35),0,1);
        out=E.add(source.vertices[i],E.add(E.mul(tangent,w*(q[0]-p[0])),E.mul(bitangent,w*(q[1]-p[1]))));
        best=d;
      }
      return out;
    });
    return {vertices,faces:source.faces,rings:rings.length};
  }
  // 沿人体高度寻找互不相交的环形区间。分叉与指间仍由原网格承担，只替换具有两个端环的区域。
  function bodyBands(source,shape,landmark,budget,locked,grid){
    if(budget<800)return null;
    const origin=landmark.map.world([0,0,0]),direction=i=>{
      const v=[0,0,0];v[i]=1;return E.unit(E.sub(landmark.map.world(v),origin));
    };
    // 主轴与导入轴几乎重合时使用导入轴，消除轻微左右不对称引起的截面倾斜。
    const snap=v=>{
      const k=v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)));
      return Math.abs(v[k])>.998?v.map((n,i)=>i===k?Math.sign(n):0):v;
    };
    const axis=snap(direction(1)),front=snap(direction(2)),tangent=E.unit(E.cross(axis,front)),bitangent=E.cross(axis,tangent);
    const points=source.vertices.map(p=>[E.dot(p,tangent),E.dot(p,bitangent),E.dot(p,axis)]);
    const low=points.reduce((v,p)=>Math.min(v,p[2]),Infinity),high=points.reduce((v,p)=>Math.max(v,p[2]),-Infinity),height=high-low;
    const center=E.mul(axis,low),spacing=Math.sqrt(E.topology(source).data.reduce((s,d)=>s+d.area,0)/budget);
    const frame={axis,tangent,bitangent,center,spacing:Math.max(spacing,.045*height)};
    const triangles=E.triangulate(source).faces,cache=new Map();
    function slice(t){
      if(cache.has(t))return cache.get(t);
      const result=contours(triangles,points,low+t*height).map(loop=>{
        const xs=loop.map(p=>p[0]),ys=loop.map(p=>p[1]),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
        return {loop,x:(xmin+xmax)/2,y:(ymin+ymax)/2,width:xmax-xmin};
      }).filter(r=>r.width>height*.045);
      cache.set(t,result);return result;
    }
    const foot=slice(.18).sort((a,b)=>a.x-b.x);
    if(foot.length!==2)return null;
    const mid=(foot[0].x+foot[1].x)/2;
    function outline(t,side){
      const loops=slice(t);
      if(side===0)return loops.filter(r=>Math.abs(r.x-mid)<height*.10).sort((a,b)=>b.width-a.width)[0];
      return loops.filter(r=>side*(r.x-mid)>height*.035).sort((a,b)=>side*(b.x-a.x))[0];
    }
    function sample(r,columns){
      const ring=[];
      for(let j=0;j<columns;j++){
        const a=2*Math.PI*j/columns,dx=Math.cos(a),dy=Math.sin(a);let radius=0;
        r.loop.forEach((p,i)=>{
          const q=r.loop[(i+1)%r.loop.length],ex=q[0]-p[0],ey=q[1]-p[1],det=dx*ey-dy*ex;
          if(Math.abs(det)<1e-12)return;
          const x=p[0]-r.x,y=p[1]-r.y,t=(x*ey-y*ex)/det,u=(x*dy-y*dx)/det;
          if(u>=0&&u<=1&&t>radius)radius=t;
        });
        if(!radius)return null;
        ring.push([r.x+radius*dx,r.y+radius*dy]);
      }
      return ring;
    }
    const cage=E.fastQEM(shape,Math.min(shape.faces.length,Math.round(budget*1.9)),E.bounds(source).diagonal,
      {lockedKeys:locked.map(i=>E.key(i,i)),areaPower:.5,positionRegularization:.12});
    const pos=p=>p.join(','),protectedPoints=new Set(locked.map(i=>pos(shape.vertices[i])));
    const bands=[];let mesh=cage;
    function addBand(name,lo,hi,steps,count,sides){
      const columns=Math.max(6,2*Math.round(count*Math.sqrt(budget/2122)/2));
      const rows=sides.map(side=>steps.map(t=>{
        const curve=outline(t,side),loop=curve&&sample(curve,columns);return loop&&{h:t*height,loop};
      }));
      if(rows.some(side=>side.some(r=>!r)))return;
      // 在相邻站位的安全间距内搜索高模截面变化最快的位置，允许裤脚与肩线随表面倾斜。
      for(let k=0;k<sides.length;k++)for(let i=0;i<steps.length;i++){
        const t=steps[i],reach=.42*Math.min(t-(steps[i-1]??lo),(steps[i+1]??hi)-t);
        const offsets=[-1,-.5,0,.5,1],samples=offsets.map(d=>{
          const contour=outline(t+d*reach,sides[k]);return contour&&sample(contour,columns);
        });
        if(samples.some(r=>!r))continue;
        const shift=samples[2].map((_,j)=>{
          const rate=[0,1,2,3].map(n=>Math.hypot(samples[n+1][j][0]-samples[n][j][0],samples[n+1][j][1]-samples[n][j][1]));
          const peak=Math.max(...rate),floor=Math.min(...rate);
          return peak-floor>height*reach*.16?(rate.indexOf(peak)-1.5)/2:0;
        });
        rows[k][i].loop=shift.map((v,j)=>{
          const weighted=.6*v+.2*shift[(j+1)%columns]+.2*shift[(j+columns-1)%columns];
          const f=weighted*2+2,a=Math.floor(f),b=Math.min(4,a+1),p=samples[a][j],q=samples[b][j];
          return [p[0]+(q[0]-p[0])*(f-a),p[1]+(q[1]-p[1])*(f-a),(t+weighted*reach)*height];
        });
      }
      // 左右相近的径向采样共用截面相位；真实不对称的大形单独贴合。
      if(sides.length===2)for(let i=0;i<steps.length;i++)for(let j=0;j<columns;j++){
        const a=rows[0][i].loop[j],b=rows[1][i].loop[(columns*1.5-j)%columns];
        if(Math.hypot(a[0]+b[0]-2*mid,a[1]-b[1])>height*.012)continue;
        a[0]=(a[0]+2*mid-b[0])/2;b[0]=2*mid-a[0];b[1]=a[1]=(a[1]+b[1])/2;
        if(a.length===3&&b.length===3)b[2]=a[2]=(a[2]+b[2])/2;
      }
      let next=mesh;const added=[];
      for(let i=0;i<sides.length;i++){
        const ref=outline((lo+hi)/2,sides[i]);if(!ref)return;
        const reference=sample(ref,columns);if(!reference)return;
        const result=loftBand(next,{lo:lo*height,hi:hi*height,loop:reference,rows:rows[i]},frame);
        if(!result)return;
        if(next.vertices.some((p,j)=>protectedPoints.has(pos(p))&&result.sourceToShape[j]<0))return;
        const audit=E.audit(result);if(!audit.valid||String(audit.euler)!==String(E.audit(next).euler)||grid.intersections(result))return;
        const rings=result.rows.map(row=>row.map(id=>result.vertices[id]));
        added.push({name,side:sides[i],rings});next=result;
      }
      mesh=next;bands.push(...added);
      for(const band of added)for(const row of band.rings)for(const p of row)protectedPoints.add(pos(p));
    }
    addBand('leg',.031,.266,[.041,.059,.087,.112,.146,.196,.248],12,[-1,1]);
    addBand('sleeve',.357,.485,[.369,.392,.421,.452,.475],10,[-1,1]);
    addBand('waist',.284,.378,[.297,.326,.363],18,[0]);
    addBand('upperTorso',.515,.645,[.533,.581,.628],20,[0]);
    addBand('crown',.867,.959,[.879,.910,.946],14,[0]);
    if(!bands.length)return null;
    const pins=mesh.vertices.flatMap((p,i)=>protectedPoints.has(pos(p))?[i]:[]);
    return {mesh,pins,bands};
  }

  function shading(mesh,shape){
    if(!shape.rails?.length)return null;
    const count=shape.rails.length/2,points=shape.rails.map(i=>shape.vertices[i]);
    const middle=points.slice(0,count).map((p,i)=>E.mul(E.add(p,points[count+i]),.5));
    const center=E.mul(middle.reduce(E.add,[0,0,0]),1/count);
    const axis=E.unit(E.sub(points[count],points[0]));
    const start=E.dot(E.sub(points[0],center),axis),height=-2*start;
    if(height<=0)return null;

    // 在一对转角之间共用同一截面法线，避免上下三角面采到不同袋盖或纽扣造成明暗跳变。
    const normals=middle.map((p,i)=>{
      const incoming=E.unit(E.sub(p,middle[(i+count-1)%count]));
      const outgoing=E.unit(E.sub(middle[(i+1)%count],p));
      return E.unit(E.cross(E.add(incoming,outgoing),axis));
    });
    const outward=normals.reduce((sum,n,i)=>sum+E.dot(n,E.sub(middle[i],center)),0)<0?-1:1;
    const anchors={};
    mesh.vertices.forEach((p,id)=>{
      const z=E.dot(E.sub(p,center),axis),along=(z-start)/height;
      if(along<=-.25||along>=1.25)return;
      const projected=E.sub(p,E.mul(axis,z));
      let distance=shape.spacing*.56,side=null;
      for(let i=0;i<count;i++){
        const j=(i+1)%count,edge=E.sub(middle[j],middle[i]);
        const t=E.clamp(E.dot(E.sub(projected,middle[i]),edge)/(E.dot(edge,edge)||1),0,1);
        const d=E.dist(projected,E.add(middle[i],E.mul(edge,t)));
        if(d>=distance)continue;
        distance=d;
        side=E.unit(E.add(E.mul(normals[i],1-t),E.mul(normals[j],t)));
      }
      if(!side)return;
      const bevel=(2*along-1)*Math.tan(Math.PI/8);
      const normal=E.unit(E.add(E.mul(side,outward),E.mul(axis,bevel)));
      const weight=.9*E.clamp((shape.spacing*.56-distance)/(shape.spacing*.4),0,1)
        *Math.min(1,(along+.25)/.25,(1.25-along)/.25);
      anchors[id]={normal,weight};
    });
    return {signature:E.fingerprint(mesh),anchors};
  }
  return {build,shading,bodyBands};
}
if(typeof module!=='undefined')module.exports=createContourProfileSurface;
