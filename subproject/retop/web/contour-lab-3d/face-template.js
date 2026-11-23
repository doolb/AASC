// 从源网格的主轴与可见深度定位面部，在原低模三角网内插入眉、眼、鼻和颏部站位。
function createContourFaceTemplate(E) {
  const {dot,sub,add,mul,cross,unit}=E;
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

  function depthMap(source, axes, center) {
    const local=p=>axes.map(axis=>dot(sub(p,center),axis));
    const points=source.vertices.map(local);
    const height=points.reduce((m,p)=>Math.max(m,p[1]),-Infinity);
    const span=height-points.reduce((m,p)=>Math.min(m,p[1]),Infinity);
    const cell=span/60, bins=new Map(), mesh=E.triangulate(source);
    for(const face of mesh.faces){
      const tri=face.map(i=>points[i]);
      if(Math.max(...tri.map(p=>p[1]))<height-span*.44)continue;
      const det=turn(...tri);
      if(Math.abs(det)<span*span*1e-12)continue;
      const xy=tri.map(p=>p.map(x=>Math.floor(x/cell)));
      for(let x=Math.min(...xy.map(p=>p[0]));x<=Math.max(...xy.map(p=>p[0]));x++)
        for(let y=Math.min(...xy.map(p=>p[1]));y<=Math.max(...xy.map(p=>p[1]));y++){
          const key=x+','+y;
          if(!bins.has(key))bins.set(key,[]);
          bins.get(key).push({tri,det});
        }
    }
    function sample(x,y) {
      const q=[x,y];let best=-Infinity;
      for(const {tri:[a,b,c],det} of bins.get(Math.floor(x/cell)+','+Math.floor(y/cell))||[]){
        const u=turn(b,c,q)/det,v=turn(c,a,q)/det,w=1-u-v;
        if(Math.min(u,v,w)>=-1e-8)best=Math.max(best,u*a[2]+v*b[2]+w*c[2]);
      }
      return best;
    }
    const world=p=>axes.reduce((a,axis,k)=>add(a,mul(axis,p[k])),center.slice());
    return {local,world,sample,height,span};
  }

  function locate(source) {
    const {axes,center}=E.frame(source);let best=null;
    for(const up of [1,-1])for(const facing of [1,-1]){
      const y=mul(axes[0],up),z=mul(axes[2],facing),map=depthMap(source,[unit(cross(y,z)),y,z],center);
      const {sample,height,span}=map;
      // 头顶中线应有连续表面，分开的两只脚不能充当头部。
      if(!Number.isFinite(sample(0,height-span*.07)))continue;
      for(let k=7;k<=32;k++){
        const h=height-span*k/100;
        let left=0,right=0;
        while(left> -span*.33&&Number.isFinite(sample(left,h)))left-=span*.006;
        while(right<span*.33&&Number.isFinite(sample(right,h)))right+=span*.006;
        const width=right-left,mid=(right+left)/2;
        if(width<span*.07||width>span*.36)continue;
        for(const dx of [-.03,0,.03]){
          const x=mid+dx*width,peak=sample(x,h);
          const sides=[-1,1].map(s=>sample(x+s*.16*width,h));
          const above=sample(x,h+.14*width),below=sample(x,h-.13*width);
          if(![peak,above,below,...sides].every(Number.isFinite))continue;
          const score=(peak-Math.max(...sides)+.65*(peak-Math.max(above,below))-.35*Math.abs(sides[0]-sides[1]))/width;
          if(score>.045&&(!best||score>best.score))best={map,x,h,width,score};
        }
      }
    }
    return best;
  }

  // 以低模面为初始三角化，边界外的连接保持原样；内边只在投影四边形凸且改善最小角时翻转。
  function fit(mesh,landmark,limit,skip=()=>false) {
    if(!landmark)return null;
    const {map,x,h,width:w}=landmark,vertices=mesh.vertices.map(p=>p.slice()),uv=vertices.map(map.local);
    const faces=mesh.faces.map(f=>f.slice()),eligible=new Set();
    faces.forEach((f,i)=>{
      const p=f.map(v=>uv[v]),cx=p.reduce((a,v)=>a+v[0],0)/3,cy=p.reduce((a,v)=>a+v[1],0)/3,cz=p.reduce((a,v)=>a+v[2],0)/3;
      if(!f.some(id=>skip(vertices[id]))&&turn(...p)>0&&Math.abs(cx-x)<w*.37&&cy>h-w*.55&&cy<h+w*.52&&Math.abs(map.sample(cx,cy)-cz)<w*.095)eligible.add(i);
    });
    const fittedDepth=(px,py,radius=.018)=>{
      // 在头宽比例定义的小邻域内平均高模深度，避免单个发丝或胡须尖峰支配面部大形。
      let sum=0,total=0;
      for(const dx of [-1,0,1])for(const dy of [-1,0,1]){
        const weight=(dx===0?2:1)*(dy===0?2:1);
        const z=map.sample(px+dx*w*radius,py+dy*w*radius);
        if(Number.isFinite(z)){sum+=weight*z;total+=weight;}
      }
      return total?sum/total:NaN;
    };
    // 已有的笼点也须贴合同一深度场，否则在新站位之间会留下原笼的凹坑。
    const topology=E.topology(mesh);
    for(const [id,incident] of topology.incident.entries()){
      if(!incident.length||!incident.every(fi=>eligible.has(fi)))continue;
      const p=uv[id],z=fittedDepth(p[0],p[1]);
      if(!Number.isFinite(z)||Math.abs(p[2]-z)>w*.14)continue;
      uv[id]=[p[0],p[1],z];vertices[id]=map.world(uv[id]);
    }
    const before=faces.length,nodes=[],stations=new Map();
    // 每一排的单位是头宽，左右共用比例，深度分别读取源表面。
    const rows=[
      [-.48,[0,.16,.30]],[-.35,[0,.12,.26,.36]],[-.20,[0,.10,.22,.33]],
      [-.105,[0,.06,.14,.26]],[-.055,[0,.045,.10,.18]],
      [.00,[0,.045,.09,.18,.31]],[.055,[0,.05,.10,.20,.32]],
      [.12,[0,.075,.16,.25,.34]],[.19,[0,.08,.17,.26,.35]],
      [.25,[0,.10,.19,.28,.37]],[.34,[0,.13,.27,.38]]
    ];
    for(const [dy,offsets] of rows)for(const dx of offsets)for(const sign of dx?[-1,1]:[1]){
      if(faces.length+2>limit)continue;
      const px=x+dx*sign*w;
      const brow=(dy===.12||dy===.19)&&dx>=.07;
      const nose=(dy===-.105||dy===-.055)&&dx<=.10;
      let py=h+(dy+(dy>=.12&&dy<=.25?dx*.13:0))*w;
      if(brow||nose){
        // 顺着两侧眉缘和鼻底的深度跃变布置相邻两排点，保住折线两边的坡度。
        const from=brow?.09:-.115,to=brow?.23:-.018;
        let best=-Infinity,station=py;
        for(let j=0;j<=16;j++){
          const yy=h+(from+(to-from)*j/16)*w;
          const near=fittedDepth(px,yy+.012*w,.004),far=fittedDepth(px,yy-.012*w,.004);
          const value=near-far;
          if(value>best){best=value;station=yy;}
        }
        if(best>w*.012)py=station+((dy===.12||dy===-.105)?-.014:.014)*w;
      }
      const z=fittedDepth(px,py,(brow || nose) ? .004 : .018),q=[px,py,z];
      if(!Number.isFinite(z))continue;
      for(const fi of eligible){
        const ids=faces[fi],[a,b,c]=ids.map(id=>uv[id]),area=turn(a,b,c);
        if(Math.min(turn(a,b,q),turn(b,c,q),turn(c,a,q))<area*1e-5)continue;
        const old=ids.find(id=>Math.hypot(uv[id][0]-px,uv[id][1]-py)<w*((brow || nose) ? .009 : .019));
        if(old!==undefined){stations.set([dy,dx*sign].join(','),old);break;}
        const id=vertices.length;vertices.push(map.world(q));uv.push(q);nodes.push(id);stations.set([dy,dx*sign].join(','),id);
        faces[fi]=[ids[0],ids[1],id];eligible.add(faces.length);faces.push([ids[1],ids[2],id]);
        eligible.add(faces.length);faces.push([ids[2],ids[0],id]);break;
      }
    }
    const cosine=(a,b,c)=>{
      const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
      return (u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1);
    };
    for(let pass=0;pass<24;pass++){
      const edges=new Map(),used=new Set();let moves=0;
      for(const fi of eligible)faces[fi].forEach((a,k)=>{
        const b=faces[fi][(k+1)%3],key=E.key(a,b);
        if(!edges.has(key))edges.set(key,[]);edges.get(key).push([fi,a,b,faces[fi][(k+2)%3]]);
      });
      for(const pair of edges.values()){
        if(pair.length!==2)continue;
        const [[i,a,b,c],[j,,,d]]=pair;
        if(used.has(i)||used.has(j)||edges.has(E.key(c,d)))continue;
        if(turn(uv[c],uv[d],uv[b])<=0||turn(uv[d],uv[c],uv[a])<=0)continue;
        if(cosine(uv[a],uv[c],uv[b])+cosine(uv[a],uv[d],uv[b])>=-1e-5)continue;
        faces[i]=[c,d,b];faces[j]=[d,c,a];used.add(i);used.add(j);moves++;
      }
      if(!moves)break;
    }
    // 在前向可见的三角片内嵌入指定线段。仅翻凸的局部四边形，已经形成的结构边不再移除。
    const constraints=new Set();
    function connect(a,b){
      if(a===undefined||b===undefined||a===b)return;
      const target=E.key(a,b),p=uv[a],q=uv[b];
      const crosses=(u,v)=>turn(p,q,u)*turn(p,q,v)<0&&turn(u,v,p)*turn(u,v,q)<0;
      for(let pass=0;pass<16;pass++){
        const edges=new Map();
        for(const fi of eligible)faces[fi].forEach((u,k)=>{
          const v=faces[fi][(k+1)%3],key=E.key(u,v);
          if(!edges.has(key))edges.set(key,[]);
          edges.get(key).push([fi,u,v,faces[fi][(k+2)%3]]);
        });
        if(edges.has(target)){constraints.add(target);return;}
        let changed=false;
        for(const [key,pair] of edges){
          if(pair.length!==2||constraints.has(key))continue;
          const [[i,u,v,c],[j,,,d]]=pair;
          if(!crosses(uv[u],uv[v])||crosses(uv[c],uv[d])||edges.has(E.key(c,d)))continue;
          if(turn(uv[c],uv[d],uv[v])<=1e-12||turn(uv[d],uv[c],uv[u])<=1e-12)continue;
          faces[i]=[c,d,v];faces[j]=[d,c,u];changed=true;break;
        }
        if(!changed)return;
      }
    }
    const station=(dy,dx)=>stations.get([dy,dx].join(','));
    for(let i=1;i<rows.length;i++)connect(station(rows[i-1][0],0),station(rows[i][0],0));
    for(const [dy,offsets] of rows)for(const sign of [-1,1]){
      for(let j=1;j<offsets.length;j++)connect(station(dy,sign*offsets[j-1]),station(dy,sign*offsets[j]));
    }
    // 沿鼻梁、口角和眼眶外侧连接相邻横排，保留眉弓到面颊的纵向边列。
    for(let i=1;i<rows.length;i++)for(const sign of [-1,1]){
      const [dy,offsets]=rows[i],previous=rows[i-1];
      for(let j=1;j<Math.min(offsets.length,previous[1].length);j++)
        connect(station(previous[0],sign*previous[1][j]),station(dy,sign*offsets[j]));
    }
    if(!nodes.length)return null;
    return {vertices,faces,featureEdges:[...constraints],templateReport:{stations:nodes.length,addedTriangles:faces.length-before,noseWorld:map.world([x,h,map.sample(x,h)]),score:landmark.score}};
  }
  function portraitField({
    map,
    x,
    h,
    width: w
  }) {
    // 用头宽确定滤波半径。先填平胡须的窄槽，再平均曲面，同时在眉鼻保留源深度。
    const pitch = w / 110, startX = x - w * 0.68, startY = h - w * 0.82, nx = 151, ny = 218;
    const grid = new Float64Array(nx * ny), envelope = grid.slice(), soft = grid.slice();
    for (let y = 0; y < ny; y++)
      for (let i = 0; i < nx; i++) {
        const px = startX + i * pitch, py = startY + y * pitch, z = map.sample(px, py), mirrored = map.sample(2 * x - px, py);
        grid[y * nx + i] = Number.isFinite(mirrored) && Math.abs(z - mirrored) < w * 0.12 ? z * 0.6 + mirrored * 0.4 : z;
      }
    function roll(input, output, radius, sign) {
      const span = Math.ceil(radius / pitch);
      const offsets = [];
      for (let j = -span; j <= span; j++)
        for (let i = -span; i <= span; i++) {
          const rr = (i * i + j * j) * pitch * pitch;
          if (rr <= radius * radius)
            offsets.push([
              i,
              j,
              radius - Math.sqrt(radius * radius - rr)
            ]);
        }
      for (let y = 0; y < ny; y++)
        for (let i = 0; i < nx; i++) {
          const idx = y * nx + i, z = input[idx];
          if (!Number.isFinite(z)) {
            output[idx] = z;
            continue;
          }
          let best = sign * z;
          for (const [dx, dy, d] of offsets) {
            const ix = i + dx, iy = y + dy;
            if (ix < 0 || ix >= nx || iy < 0 || iy >= ny)
              continue;
            const v = input[iy * nx + ix];
            if (Number.isFinite(v))
              best = Math.max(best, sign * v - d);
          }
          output[idx] = sign * best;
        }
    }
    roll(grid, envelope, w * 0.13, 1);
    roll(envelope, soft, w * 0.13, -1);
    const values = soft.slice(), R = 9;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!Number.isFinite(soft[j * nx + i]))
          continue;
        const px = Math.abs((startX + i * pitch - x) / w), py = (startY + j * pitch - h) / w;
        const feature = Math.exp(-((px / 0.12) ** 2 + (py / 0.105) ** 2)) + Math.exp(-(((px - 0.18) / 0.14) ** 2 + ((py - 0.15) / 0.06) ** 2));
        const sigma = (0.032 + 0.035 * (1 - Math.min(1, feature))) * w;
        let sum = 0, t = 0;
        for (let dy = -R; dy <= R; dy += 2)
          for (let dx = -R; dx <= R; dx += 2) {
            const xx = i + dx, yy = j + dy;
            if (xx < 0 || xx >= nx || yy < 0 || yy >= ny)
              continue;
            const z = soft[yy * nx + xx];
            if (!Number.isFinite(z))
              continue;
            const weight = Math.exp(-(dx * dx + dy * dy) * pitch * pitch / (2 * sigma * sigma));
            sum += z * weight;
            t += weight;
          }
        const q = t ? sum / t : soft[j * nx + i], blend = Math.max(0, 1 - Math.min(0.8, feature));
        values[j * nx + i] = grid[j * nx + i] + (q - grid[j * nx + i]) * (0.35 + 0.65 * blend);
      }
    function depth(px, py) {
      const X = (px - startX) / pitch, Y = (py - startY) / pitch, i = Math.floor(X), j = Math.floor(Y);
      if (i < 0 || i + 1 >= nx || j < 0 || j + 1 >= ny)
        return NaN;
      const a = [
        values[j * nx + i],
        values[j * nx + i + 1],
        values[(j + 1) * nx + i],
        values[(j + 1) * nx + i + 1]
      ];
      if (!a.every(Number.isFinite))
        return NaN;
      return (a[0] * (1 - X + i) + a[1] * (X - i)) * (1 - Y + j) + (a[2] * (1 - X + i) + a[3] * (X - i)) * (Y - j);
    }
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = t => {
      t = Math.max(0, Math.min(1, t));
      return t * t * (3 - 2 * t);
    };
    const raw = (u, v) => {
      const l = map.sample(x - w * u, h + w * v), r = map.sample(x + w * u, h + w * v);
      return Number.isFinite(l) && Number.isFinite(r) ? (l + r) / 2 : NaN;
    };
    function field(px, py) {
      const u = Math.abs(px - x) / w, v = (py - h) / w;
      let q = depth(px, py);
      if (!Number.isFinite(q) || u > 0.48 || v < -0.34 || v > 0.43)
        return q;
      const noseWeight = (1 - smooth((u - 0.055) / 0.09)) * (1 - smooth((v - 0.105) / 0.12)) * smooth((v + 0.115) / 0.06);
      if (noseWeight) {
        const z = raw(u * 0.76, v - 0.025), zl = raw(0.17, v - 0.025);
        if (Number.isFinite(z) && Number.isFinite(zl))
          q = mix(q, z + Math.max(0, z - zl) * 0.065, noseWeight);
      }
      // 在额头与眼眶之间用连续的斜向折线表示眉缘，去掉单个眉毛的小雕刻。
      const browWeight = smooth((u - 0.035) / 0.06) * (1 - smooth((u - 0.25) / 0.1)) * smooth((v - 0.015) / 0.055) * (1 - smooth((v - 0.23) / 0.09));
      if (browWeight) {
        const ridge = 0.122 + 0.23 * u, t = v - ridge;
        const above = raw(u, ridge + 0.064), below = raw(u, ridge - 0.063);
        if (Number.isFinite(above) && Number.isFinite(below)) {
          const travel = smooth((t + 0.018) / 0.045);
          const brow = mix(below, above, travel);
          q = mix(q, brow, browWeight);
        }
      }
      // 从上唇与下唇之间取短凹线。唇角渐出，避免把整片胡须刻回低模。
      const lipWeight = (1 - smooth((u - 0.09) / 0.095)) * smooth((v + 0.23) / 0.025) * (1 - smooth((v + 0.15) / 0.025));
      if (lipWeight) {
        const mouth = raw(u, -0.18), chin = raw(u, -0.27);
        if (Number.isFinite(mouth) && Number.isFinite(chin)) {
          const relief = E.clamp(chin - mouth, 0, w * 0.028);
          q -= relief * lipWeight * Math.exp(-(((v + 0.18) / 0.024) ** 2));
        }
      }
      return q;
    }
    return field;
  }

  function portraitSample(point,{map,x,h,width},field) {
    const [px,py,z]=map.local(point),dx=Math.abs(px-x)/width,dy=(py-h)/width;
    const target=field(px,py),front=map.sample(px,py);
    if(!Number.isFinite(target)||!Number.isFinite(front))return null;
    // 两颊、发际和下巴边缘渐出，同一射线上的后脑与遮挡层不参与正面拟合。
    const weight=Math.min(1,(.53-dx)/.10,(dy+.70)/.12,(1.03-dy)/.10,
      1-Math.max(0,front-z-width*.04)/(width*.09));
    return weight>0?{px,py,z,target,weight}:null;
  }
  function applyPortrait(mesh,landmark,field,skip=()=>false) {
    mesh.vertices=mesh.vertices.map(point=>{
      if(skip(point))return point;
      const p=portraitSample(point,landmark,field);
      return p?landmark.map.world([p.px,p.py,p.z+(p.target-p.z)*p.weight]):point;
    });
  }
  function shading(mesh,landmark,field) {
    const {map,width}=landmark,radius=width*.018,origin=map.world([0,0,0]),anchors={};
    mesh.vertices.forEach((point,id)=>{
      const p=portraitSample(point,landmark,field);
      if(!p)return;
      const {px,py,weight}=p;
      const sx=(field(px+radius,py)-field(px-radius,py))/(2*radius);
      const sy=(field(px,py+radius)-field(px,py-radius))/(2*radius);
      if(Number.isFinite(sx)&&Number.isFinite(sy))
        anchors[id]={normal:unit(sub(map.world([-sx,-sy,1]),origin)),weight};
    });
    return {signature:E.fingerprint(mesh),anchors};
  }
  function headFrame({map,x,h,width}){
    const center=map.world([0,0,0]);
    const axes=[[1,0,0],[0,1,0],[0,0,1]].map(v=>sub(map.world(v),center));
    return {origin:map.world([x,h,map.sample(x,h)]),axes,width};
  }

  function headSideSampler(source,frame){
    const {origin,axes,width}=frame;
    const local=p=>axes.map(axis=>dot(sub(p,origin),axis)/width);
    const behindEar=([u,v,z])=>Math.abs(u)>.29&&v>-.20&&v<.68&&z<-.90;
    const earWeight=([u,v,z])=>E.clamp((Math.abs(u)-.285)/.09,0,1)
      *E.clamp((v+.19)/.13,0,1)*E.clamp((.59-v)/.13,0,1)*E.clamp((-.40-z)/.15,0,1);
    const samples=[[],[]];
    for(const face of E.topology(source).data){
      const p=local(face.center);
      if(behindEar(p))samples[Number(p[0]>0)].push({p,normal:face.normal,area:face.area});
    }
    function sheetPlane(point){
      const q=local(point);
      if(!behindEar(q))return null;
      const tensor=[0,0,0,0,0,0],near=[];
      let total=0;
      for(const sample of samples[Number(q[0]>0)]){
        const distance=E.dist(q,sample.p)/.055;
        if(distance>2.5)continue;
        const weight=sample.area*Math.exp(-.5*distance*distance),[a,b,c]=sample.normal;
        total+=weight;
        const products=[a*a,a*b,a*c,b*b,b*c,c*c];
        for(let i=0;i<6;i++)tensor[i]+=weight*products[i];
        near.push({normal:sample.normal,weight});
      }
      if(!total)return null;
      // 无符号方向矩阵可从正反两层估计同一切平面，避免正反法线相加后抵消。
      const [xx,xy,xz,yy,yz,zz]=tensor;
      let normal=[0,0,0],eigenvalue=0;
      // 在世界坐标的最大对角元上起步，垂直于任一人物主轴的薄片也能稳定求解。
      normal[[xx,yy,zz].indexOf(Math.max(xx,yy,zz))]=1;
      for(let i=0;i<12;i++){
        const [a,b,c]=normal;
        const next=[xx*a+xy*b+xz*c,xy*a+yy*b+yz*c,xz*a+yz*b+zz*c];
        eigenvalue=E.len(next);
        normal=unit(next);
      }
      const confidence=eigenvalue/total;
      if(confidence<.53)return null;
      let front=0,back=0;
      for(const sample of near){
        const alignment=dot(sample.normal,normal);
        if(alignment>.35)front+=sample.weight;
        if(alignment<-.35)back+=sample.weight;
      }
      return {normal,confidence,twoSided:Math.min(front,back)>.045*total};
    }
    function sheetSurfaceNormal(point){
      // 正反面分别拟合深度坡度，再取中面方向；尖端窄侧壁不会拉偏带面。
      const q=local(point),layers=[[],[]];
      for(const sample of samples[Number(q[0]>0)]){
        const distance=E.dist(q,sample.p)/.14,facing=dot(sample.normal,axes[2]);
        if(distance>2.5||Math.abs(facing)<.2)continue;
        const weight=sample.area*Math.abs(facing)*Math.exp(-.5*distance*distance);
        layers[Number(facing>0)].push({p:sample.p,weight});
      }
      let sum=[0,0,0];
      for(const layer of layers){
        if(layer.length<4)continue;
        let center=[0,0,0],total=0;
        for(const {p,weight} of layer){center=add(center,mul(p,weight));total+=weight;}
        center=mul(center,1/total);
        let xx=0,xy=0,yy=0,xz=0,yz=0;
        for(const {p,weight} of layer){
          const [a,b,c]=sub(p,center),k=weight/total;
          xx+=a*a*k;xy+=a*b*k;yy+=b*b*k;xz+=a*c*k;yz+=b*c*k;
        }
        const det=xx*yy-xy*xy;
        if(det<=1e-9)continue;
        const dx=(yy*xz-xy*yz)/det,dy=(xx*yz-xy*xz)/det;
        sum=add(sum,unit(sub(axes[2],add(mul(axes[0],dx),mul(axes[1],dy)))));
      }
      return E.len(sum)>0?unit(sum):null;
    }
    return mesh=>{
      const topology=E.topology(mesh),weights={},sheetCorners={},sides={},hardEdges=[];
      mesh.vertices.forEach((p,id)=>{
        const weight=earWeight(local(p));
        if(weight>0)weights[id]=weight;
      });
      const fields=topology.data.map(face=>sheetPlane(face.center));
      const visited=new Set(),vertexPlanes=new Map();
      for(let start=0;start<fields.length;start++){
        if(!fields[start]||visited.has(start))continue;
        // 沿共边传递同一侧的符号。单面头壳或孤立噪点没有两层支撑，保留原平滑组。
        const queue=[start],labels=new Map();
        visited.add(start);
        let supported=false;
        for(let j=0;j<queue.length;j++){
          const fi=queue[j],field=fields[fi],face=mesh.faces[fi];
          const alignment=dot(field.normal,topology.data[fi].normal);
          labels.set(fi,Math.abs(alignment)<.4?0:Math.sign(alignment));
          supported||=field.twoSided;
          for(let k=0;k<face.length;k++){
            const edge=topology.edges.get(E.key(face[k],face[(k+1)%face.length]));
            for(const other of edge.faces){
              const next=fields[other];
              if(!next||visited.has(other))continue;
              if(dot(next.normal,field.normal)<0)next.normal=mul(next.normal,-1);
              visited.add(other);queue.push(other);
            }
          }
        }
        const signs=new Set(labels.values());
        if(!supported||!signs.has(1)||!signs.has(-1))continue;
        const orientation=queue.reduce((s,fi)=>s+labels.get(fi)*topology.data[fi].area
          *dot(topology.data[fi].normal,axes[2]),0)<0?-1:1;
        for(const [fi,sign] of labels){
          sides[fi]=sign+2;
          if(!sign)continue;
          const panel=mul(fields[fi].normal,sign);
          sheetCorners[fi]=mesh.faces[fi].map(id=>{
            if(!vertexPlanes.has(id))vertexPlanes.set(id,sheetSurfaceNormal(mesh.vertices[id]));
            const surface=vertexPlanes.get(id);
            const normal=surface?mul(surface,sign*orientation):panel;
            return {normal:dot(normal,topology.data[fi].normal)>0?normal:panel,weight:.82};
          });
        }
      }
      for(const [key,edge] of topology.edges)if(edge.faces.length===2){
        const [a,b]=edge.faces;
        if(sides[a]!==sides[b])hardEdges.push(key);
      }
      return {frame,weights,hardEdges,sheetCorners,signature:E.fingerprint(mesh)};
    };
  }
  return {locate,fit,portraitField,applyPortrait,shading,headFrame,headSideSampler};
}
if(typeof module!=='undefined')module.exports=createContourFaceTemplate;
