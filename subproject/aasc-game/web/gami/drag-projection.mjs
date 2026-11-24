// 在真实纸面投影上求目标位置；只调用几何计算，不在迭代中重建 WebGL 场景。
// 保留误差最小的合法候选，避免奇异视角或纸面分区边界导致跳动。
export function solveDragTarget(initial,screen,project){
  const evaluate=target=>{
    try{
      const p=project(target),error=p?Math.hypot(p.x-screen.x,p.y-screen.y):Infinity;
      return Number.isFinite(error)?{target,p,error}:null;
    }catch{return null}
  };
  let best=evaluate(initial);
  if(!best)return initial;
  for(let step=0;step<6&&best.error>.5;step++){
    const delta=.001,a=evaluate([best.target[0]+delta,best.target[1]]),b=evaluate([best.target[0],best.target[1]+delta]);
    if(!a||!b)break;
    const xx=(a.p.x-best.p.x)/delta,yx=(a.p.y-best.p.y)/delta,xy=(b.p.x-best.p.x)/delta,yy=(b.p.y-best.p.y)/delta,det=xx*yy-xy*yx;
    if(Math.abs(det)<1e-7)break;
    const ex=screen.x-best.p.x,ey=screen.y-best.p.y;
    let dx=(ex*yy-ey*xy)/det,dy=(ey*xx-ex*yx)/det;
    const scale=Math.min(1,.5/Math.hypot(dx,dy));dx*=scale;dy*=scale;
    let next=null;
    for(const damping of [1,.5,.25]){
      const trial=evaluate([best.target[0]+dx*damping,best.target[1]+dy*damping]);
      if(trial&&trial.error<best.error){next=trial;break}
    }
    if(!next)break;
    best=next;
  }
  return best.target;
}
