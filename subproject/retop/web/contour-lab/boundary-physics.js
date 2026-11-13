/* Switchable per-point / spatial width dynamics: acceleration moves a bounded target; actual width lags. */
function makeBoundaryPhysics(){
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),length=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 function settings(input={},base=4){
  const number=(key,fallback,min,max)=>{const value=Number(input[key]??fallback);if(!Number.isFinite(value)||value<min||value>max)throw Error('物理宽度参数无效：'+key);return value;};
  const minTarget=number('minTarget',1,.1,64),maxTarget=number('maxTarget',64,.1,64);if(minTarget>maxTarget)throw Error('目标宽度最小值不能超过最大值。');
  const mode=input.angleMode??'magnitude';if(!['magnitude','signed'].includes(mode))throw Error('转角方式无效。');
  const starts={};for(const [key,p]of Object.entries(input.starts||{})){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw Error('物理宽度起点无效。');starts[key]=p.slice();}
  const turnWidthPx=number('turnWidthPx',input.angleAcceleration==null?1:Number(input.angleAcceleration)*10,-160,160);
  return {minTarget,maxTarget,turnWidthPx,initialTarget:clamp(base,minTarget,maxTarget),initialActual:number('initialActual',base,.1,64),distanceAcceleration:number('distanceAcceleration',-.001,-8,8),useDistance:input.useDistance===true,unitDistance:number('unitDistance',80,1,512),interpolationFactor:number('interpolationFactor',.2,0,1),damping:number('damping',2,0,16),angleMode:mode,reverse:!!input.reverse,starts};
 }
 function advance(state,distance,turn,c){
  // Default: one update per sample. Optional spatial mode scales by arc length.
  const dt=c.useDistance?distance/c.unitDistance:1,angle=c.angleMode==='signed'?turn:Math.abs(turn),turnWidthDelta=c.turnWidthPx*angle/Math.PI,acceleration=c.distanceAcceleration,oldTarget=state.target;
  let nextVelocity,delta;if(c.damping>1e-8){const lost=-Math.expm1(-c.damping*dt);nextVelocity=state.velocity*(1-lost)+acceleration*lost/c.damping;delta=state.velocity*lost/c.damping+acceleration/c.damping*(dt-lost/c.damping);}else{nextVelocity=state.velocity+acceleration*dt;delta=state.velocity*dt+.5*acceleration*dt*dt;}
  const target=clamp(oldTarget+delta+turnWidthDelta,c.minTarget,c.maxTarget);if(target!==oldTarget+delta+turnWidthDelta)nextVelocity=0;
  const actual=state.actual+(target-state.actual)*c.interpolationFactor;
  return {target,actual:clamp(actual,.1,64),velocity:nextVelocity,acceleration,turnWidthDelta};
 }
 function apply(rings,base,input){
  const config=settings(input,base),output=[];
  for(const [id,ring]of rings.entries()){
   const n=ring.stations.length,position=config.starts[id];let start=0;if(position)for(let i=1;i<n;i++)if(length(ring.stations[i].p,position)<length(ring.stations[start].p,position))start=i;
   const order=Array.from({length:n},(_,k)=>(start+(config.reverse?-k:k)+n)%n),turnAt=i=>{const s=ring.stations[i],a=s.incoming,b=s.outgoing;return Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1])*(config.reverse?-1:1);};
   const initialActual=config.interpolationFactor===1?config.initialTarget:config.initialActual;let state={target:config.initialTarget,actual:initialActual,velocity:0,acceleration:0,turnWidthDelta:0},distance=0;const points=[];
   for(let k=0;k<n;k++){
    const i=order[k],turn=turnAt(i);
    // Keep the selected start as the initial condition. At every other station,
    // apply its own incoming/outgoing turn before storing the cross-section.
    if(k){const previous=order[k-1],ds=length(ring.stations[previous].p,ring.stations[i].p);distance+=ds;state=advance(state,ds,turn,config);}
    points.push({station:i,step:k,distance,targetWidth:state.target,modelWidth:state.actual,velocity:state.velocity,turnAngle:turn,acceleration:state.acceleration,turnWidthDelta:state.turnWidthDelta});
   }
   const closingDistance=length(ring.stations[order[n-1]].p,ring.stations[start].p);state=advance(state,closingDistance,turnAt(start),config);distance+=closingDistance;
   const actualMin=Math.min(initialActual,...points.map(p=>p.modelWidth)),actualMax=Math.max(initialActual,...points.map(p=>p.modelWidth));
   const extent=config.useDistance?distance:n,blendSpan=config.useDistance?Math.min(distance*.25,Math.max(12,config.unitDistance)):Math.min(n*.25,20),begin=extent-blendSpan,firstStride=config.useDistance?Math.max(points[1]?.distance??1,1e-12):1,lastStride=config.useDistance?Math.max(distance-points.at(-1).distance,1e-12):1,desiredActualSlope=points.length>1?(points[1].modelWidth-initialActual)/firstStride:0,actualSlope=(state.actual-points.at(-1).modelWidth)/lastStride,targetSlope=config.useDistance?state.velocity/config.unitDistance:state.velocity;
   for(const p of points){
    p.rawTargetWidth=p.targetWidth;p.rawActualWidth=p.modelWidth;
    const position=config.useDistance?p.distance:p.step;
    if(position>begin){const t=(position-begin)/blendSpan,h=3*t*t-2*t*t*t,g=t*t*t-t*t;p.targetWidth=clamp(p.targetWidth+(config.initialTarget-state.target)*h-targetSlope*blendSpan*g,config.minTarget,config.maxTarget);p.modelWidth=clamp(p.modelWidth+(initialActual-state.actual)*h+(desiredActualSlope-actualSlope)*blendSpan*g,actualMin,actualMax);}
    if(config.interpolationFactor===1)p.modelWidth=p.targetWidth;
    const row=ring.stations[p.station];row.half=p.modelWidth/2;row.physical=p;
   }
   output.push({id,startStation:start,start:ring.stations[start].p.slice(),reverse:config.reverse,length:distance,steps:n,...(config.useDistance?{closureBlendLength:blendSpan}:{closureBlendSteps:blendSpan}),points});
  }
  return {config,rings:output,method:(config.useDistance?'spatial':'per-point')+' base acceleration / current-station turn widening / bounded target / per-sample 0-1 linear actual-width interpolation / closed-loop return'};
 }
 function finish(mesh,model,rings){
  let constrained=0,minimum=Infinity,maximum=0;for(const [i,ring]of rings.entries()){
   const byStation=new Map(model.rings[i].points.map(p=>[p.station,p]));for(const p of model.rings[i].points){p.actualWidth=ring.stations[p.station].half*2;p.geometryLimited=Math.abs(p.actualWidth-p.modelWidth)>1e-7;if(p.geometryLimited)constrained++;minimum=Math.min(minimum,p.actualWidth);maximum=Math.max(maximum,p.actualWidth);}
   const sides=mesh.alignment==='center'?[-.5,.5]:[mesh.alignment==='outside'?-ring.filledSide:ring.filledSide];model.rings[i].targetOutlines=sides.map(side=>ring.stations.map((s,j)=>s.p.map((v,k)=>v+s.offset[k]*byStation.get(j).targetWidth*side)));
  }
  mesh.physicalWidth={...model,geometryLimitedStations:constrained,minimumActual:minimum,maximumActual:maximum};return mesh;
 }
 function chart(model,index=0){
  const ring=model?.rings[index];if(!ring)return '';const points=[...ring.points,{distance:ring.length,targetWidth:ring.points[0].targetWidth,actualWidth:ring.points[0].actualWidth}],values=points.flatMap(p=>[p.targetWidth,p.actualWidth]),min=Math.min(...values),max=Math.max(...values),pad=Math.max(.5,(max-min)*.1),lo=Math.max(0,min-pad),hi=max+pad,xy=(p,k)=>[6+p.distance/ring.length*308,90-(p[k]-lo)/(hi-lo)*74].map(v=>v.toFixed(3)).join(',');
  return '<svg viewBox="0 0 320 108" role="img" aria-label="沿线宽度，橙虚线为目标，绿实线为实际"><path d="M6 12 V90 H314" fill="none" stroke="#b6cabc"/><polyline data-width-target points="'+points.map(p=>xy(p,'targetWidth')).join(' ')+'" fill="none" stroke="#cd8848" stroke-width="1.6" stroke-dasharray="5 3"/><polyline data-width-actual points="'+points.map(p=>xy(p,'actualWidth')).join(' ')+'" fill="none" stroke="#267965" stroke-width="1.8"/><text x="7" y="10" font-size="9" fill="#657c6e">'+hi.toFixed(1)+' px</text><text x="7" y="105" font-size="9" fill="#657c6e">0</text><text x="250" y="105" font-size="9" fill="#657c6e">'+ring.length.toFixed(0)+' px</text></svg>';
 }
 return {settings,advance,apply,finish,chart};
}
if(typeof module!=='undefined')module.exports=makeBoundaryPhysics;
if(typeof window!=='undefined')window.makeBoundaryPhysics=makeBoundaryPhysics;
