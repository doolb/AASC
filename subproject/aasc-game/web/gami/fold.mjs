// 顶点依次保存桌面横向、纵向、高度以及母纸纹理坐标。裁分后沿用插值坐标。
export function sheet(x=-1,y=-1,w=2,h=2,u=0,v=0,du=1,dv=1){
  return [[[x,y,0,u,v],[x+w,y,0,u+du,v],[x+w,y+h,0,u+du,v+dv],[x,y+h,0,u,v+dv]]];
}
export function bounds(faces){
  const pts=faces.flat(), xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
export function corners(faces){
  const pts=faces.flat().map(p=>p.slice(0,2)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const half=list=>{
    const out=[];
    for(const p of list){
      while(out.length>=2){
        const a=out.at(-2),b=out.at(-1);
        if((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>1e-7)break;
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0,-1);
  };
  return [...half(pts),...half(pts.reverse())];
}
function area(face){
  return Math.abs(face.reduce((s,a,i)=>{const b=face[(i+1)%face.length];return s+a[0]*b[1]-a[1]*b[0]},0))/2;
}
function clip(face,dist){
  const out=[];
  face.forEach((a,i)=>{
    const b=face[(i+1)%face.length], da=dist(a),db=dist(b);
    if(da>=-1e-9)out.push(a);
    if(da*db<0 && Math.min(Math.abs(da),Math.abs(db))>1e-9)out.push(a.map((n,k)=>n+(b[k]-n)*da/(da-db)));
  });
  return area(out)>1e-9?out:[];
}
export function fold(faces,starts,target,degrees){
  if(faces.flat().some(p=>Math.abs(p[2])>.00001))throw Error('立体纸形可直接摆放，或撤销后继续折。');
  const axes=starts.map(a=>{
    const dx=a[0]-target[0],dy=a[1]-target[1],len=Math.hypot(dx,dy);
    if(len<1e-5)throw Error('请把目标移离起点');
    const nx=dx/len,ny=dy/len;
    return {nx,ny,dist:p=>(p[0]-(a[0]+target[0])/2)*nx+(p[1]-(a[1]+target[1])/2)*ny};
  });
  let fixed=faces;const moved=[];
  const angle=degrees*Math.PI/180;
  for(const axis of axes){
    const {dist,nx,ny}=axis;
    const flap=faces.map(f=>clip(f,dist)).filter(f=>f.length);
    if(!flap.length || !faces.some(f=>clip(f,p=>-dist(p)).length))throw Error('折线需要穿过纸面');
    for(const prev of axes.slice(0,axes.indexOf(axis)))if(flap.some(f=>clip(f,prev.dist).length))throw Error('纸瓣重叠，请分步折叠');
    fixed=fixed.map(f=>clip(f,p=>-dist(p))).filter(f=>f.length);
    moved.push(...flap.reverse().map(f=>f.map(([x,y,z,u,v])=>{
      const d=dist([x,y]), offset=d*(Math.cos(angle)-1);
      return [x+offset*nx,y+offset*ny,d*Math.sin(angle),u,v];
    })));
  }
  return degrees<0?[...moved,...fixed]:[...fixed,...moved];
}
export function cut(faces,rows,cols){
  if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows*cols<2||rows*cols>64)throw Error('请输入正整数，共 2 至 64 片');
  const [x,y,X,Y]=bounds(faces),[a,,c]=faces[0];
  return Array.from({length:rows*cols},(_,i)=>{
    const r=Math.floor(i/cols),k=i%cols,w=(X-x)/cols,h=(Y-y)/rows;
    return sheet(x+k*w,y+r*h,w,h,a[3]+k*(c[3]-a[3])/cols,a[4]+r*(c[4]-a[4])/rows,(c[3]-a[3])/cols,(c[4]-a[4])/rows);
  });
}

// 已锁定的角使用较宽释放范围，防止手指轻微抖动导致目标跳变。
export function snapIndex(distances,radius,previous){
  if(previous>=0&&distances[previous]<=radius*1.5)return previous;
  const nearest=Math.min(...distances);
  return nearest<=radius?distances.indexOf(nearest):-1;
}
