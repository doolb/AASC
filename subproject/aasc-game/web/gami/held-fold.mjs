import {corners,fold} from './fold.mjs';
import {recordCreases} from './paper-topology.mjs';

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
