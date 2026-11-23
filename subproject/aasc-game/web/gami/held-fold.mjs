import {corners,fold} from './fold.mjs';
import {recordCreases,validPaperTopology} from './paper-topology.mjs';

// 待压平状态只保存重建参数；原始面片始终保持不变，避免反复拖动造成几何误差。
export function heldFaces(item){
  const h=item.heldFold;
  return h?fold(item.faces,h.starts,h.dest,h.angle,h.curl):item.faces;
}

// 继续拖动时从已保存的弯曲量起算，向回拖也能减小弯曲，避免每次松手后只增不减。
export function adjustedCurl(held,target){
  // 从吸附形状重新拖开时，以目标的相对位移抬起纸瓣，而非继续保持零弯曲。
  if(held.snapped)return Math.min(.42,Math.hypot(target[0]-held.dest[0],target[1]-held.dest[1])*.45);
  const [start]=held.starts;
  const distance=p=>Math.hypot(p[0]-start[0],p[1]-start[1]);
  return Math.max(0,Math.min(.42,held.curl+(distance(target)-distance(held.dest))*.45));
}

export function validHeldFold(item){
  const h=item.heldFold;
  if(h===undefined)return true;
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<10000);
  if(!h||!Array.isArray(h.starts)||h.starts.length!==1||!h.starts.every(point)||!point(h.dest))return false;
  if(!['corner','edge'].includes(h.kind)||!Number.isInteger(h.index)||h.index<0||h.index>=corners(item.faces).length)return false;
  if(h.mode!==undefined&&!['fold','precrease'].includes(h.mode))return false;
  if(h.pick!==undefined&&!point(h.pick))return false;
  if(h.other!==undefined&&!point(h.other))return false;
  if(h.material!==undefined&&!point(h.material))return false;
  if(h.snapped!==undefined&&h.snapped!==true)return false;
  if(h.snapTarget!==undefined&&(!h.snapped||!point(h.snapTarget)))return false;
  if(![180,-180].includes(h.angle)||!Number.isFinite(h.curl)||h.curl<0||h.curl>.42)return false;
  try{heldFaces(item);return true}catch{return false}
}

export function flattenHeldFold(item){
  const h=item.heldFold;
  if(!h)return false;
  const faces=fold(item.faces,h.starts,h.dest,h.angle);
  recordCreases(item,h.starts,h.dest);
  item.faces=faces;item.folded=true;delete item.heldFold;delete item.layers;delete item.layerSpacingVersion;
  return true;
}

// 预折痕只改变材料分区。逐个原面裁分并继承该面层位移，不用折后面片顺序推断原层次。
export function precreaseFold(item,starts,dest){
  fold(item.faces,starts,dest,180); // 复用公共平面、有效折线及多角互不重叠校验。
  const next=structuredClone(item),pieces=[];
  recordCreases(next,starts,dest);
  const clip=(face,distance)=>{
    const out=[];
    face.forEach((a,i)=>{
      const b=face[(i+1)%face.length],da=distance(a),db=distance(b);
      if(da>=-1e-9)out.push(a.slice());
      if(da*db<0&&Math.min(Math.abs(da),Math.abs(db))>1e-9)out.push(a.map((v,k)=>v+(b[k]-v)*da/(da-db)));
    });
    const area=Math.abs(out.reduce((sum,a,i)=>{const b=out[(i+1)%out.length];return sum+a[3]*b[4]-a[4]*b[3]},0));
    return area>1e-10?out:null;
  };
  item.faces.forEach((face,index)=>{
    let parts=[face];
    for(const start of starts){
      const dx=start[0]-dest[0],dy=start[1]-dest[1],x=(start[0]+dest[0])/2,y=(start[1]+dest[1])/2;
      const distance=p=>(p[0]-x)*dx+(p[1]-y)*dy;
      parts=parts.flatMap(part=>{
        const ds=part.map(distance);
        if(Math.min(...ds)>=-1e-9||Math.max(...ds)<=1e-9)return [part.map(p=>p.slice())];
        return [clip(part,distance),clip(part,p=>-distance(p))].filter(Boolean);
      });
    }
    for(const face of parts)pieces.push({face,index});
  });
  next.faces=pieces.map(p=>p.face);
  if(item.layers)next.layers=pieces.map(p=>item.layers[p.index].slice());
  delete next.heldFold;
  if(!validPaperTopology(next))throw Error('折痕分区过多，请减少此纸的折叠次数');
  Object.assign(item,next);delete item.heldFold;
  return true;
}
// 原面片一直保留，取消整轮弯折不会删除之前已确认的折痕。
export function cancelHeldFold(item){
  if(!item.heldFold)return false;
  delete item.heldFold;return true;
}
