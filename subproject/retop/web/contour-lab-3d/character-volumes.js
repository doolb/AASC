/* 人物中远档的体积分区。从沿高度的分支、腰部收缩和前表面深度识别躯干及装备。 */
function createContourCharacterVolumes(E){
  function partition(source,ctx,solid,limit){
    if(limit<16)return null;
    const {dim,step,lo,data}=solid;
    const bands=Array.from({length:dim[0]},()=>new Map());
    for(const v of data){
      const [h,x]=v.cell;bands[h].set(x,(bands[h].get(x)||0)+1);
    }
    function intervals(layer){
      const ranges=[];let start=null;
      for(let x=0;x<=dim[1];x++){
        if(layer.has(x)){start??=x;continue;}
        if(start!==null&&x-start>=3)ranges.push([start,x-1]);start=null;
      }
      return ranges;
    }
    const slices=bands.map(intervals);
    if(slices.filter(parts=>parts.length===3).length<3||slices.filter(parts=>parts.length===2).length<3)return null;
    const factory=typeof createContourFaceTemplate==='function'?createContourFaceTemplate:require('./face-template.js');
    const face=factory(E).locate(source);
    if(!face)return null;
    const map=face.map,span=map.span,base=map.height-span;
    const origin=map.world([0,base,0]),axes=[0,1,2].map(k=>{
      const q=[0,base,0];q[k]+=span;return E.unit(E.sub(map.world(q),origin));
    });
    const coords=(x,y,z)=>axes.map(a=>((x-origin[0])*a[0]+(y-origin[1])*a[1]+(z-origin[2])*a[2])/span);
    const up=E.dot(ctx.f.axes[0],axes[1])>0?1:-1;
    const row=t=>slices[Math.round(E.clamp(up>0?t:1-t,0,1)*(dim[0]-1))];
    const worldX=i=>((lo[1]+(i+.5)*step)*E.dot(ctx.f.axes[1],axes[0])+E.dot(E.sub(ctx.f.center,origin),axes[0]))/span;
    const ranges=t=>row(t).map(([a,b])=>[worldX(a),worldX(b)].sort((x,y)=>x-y)).sort((a,b)=>a[0]-b[0]);
    const paired=t=>ranges(t).length===2,third=t=>ranges(t).length===3;
    if(![.09,.13,.17,.21].some(paired)||![.32,.36,.40,.44,.48].some(third))return null;
    // 前表面深度图只作分区证据。包覆计算稍后直接使用原件的全部面。
    const pitch=1/192,width=193,height=193,depth=new Float32Array(width*height).fill(-Infinity);
    const at=(x,y)=>depth[Math.round(E.clamp(y,0,1)/pitch)*width+Math.round(E.clamp(x+.5,0,1)/pitch)];
    const vertices=source.vertices.map(p=>coords(...p));
    for(const f of source.faces)for(let i=1;i+1<f.length;i++){
      const [a,b,c]=[f[0],f[i],f[i+1]].map(j=>vertices[j]),u=E.sub(b,a),v=E.sub(c,a),det=u[0]*v[1]-v[0]*u[1];
      if(Math.abs(det)<1e-12)continue;
      const left=Math.max(0,Math.ceil((Math.min(a[0],b[0],c[0])+.5)/pitch)),right=Math.min(width-1,Math.floor((Math.max(a[0],b[0],c[0])+.5)/pitch));
      const bottom=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])/pitch)),top=Math.min(height-1,Math.floor(Math.max(a[1],b[1],c[1])/pitch));
      for(let y=bottom;y<=top;y++)for(let x=left;x<=right;x++){
        const dx=x*pitch-.5-a[0],dy=y*pitch-a[1],s=(dx*v[1]-dy*v[0])/det,t=(u[0]*dy-u[1]*dx)/det;
        if(s>=0&&t>=0&&s+t<=1)depth[y*width+x]=Math.max(depth[y*width+x],a[2]+s*u[2]+t*v[2]);
      }
    }
    function extremum(start,end,evalAt){
      let best=start,value=-Infinity;
      for(let h=start;h<=end;h+=pitch){const v=evalAt(h);if(v>value){best=h;value=v;}}
      return best;
    }
    const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a[Math.floor(a.length/2)]??0;};
    const abs= Math.abs;
    const triple=Array.from({length:20},(_,i)=>.28+i*.013).map(ranges).filter(a=>a.length===3);
    if(!triple.length)return null;
    const mid=median(triple.map(a=>(a[1][0]+a[1][1])/2));
    const trunkWidth=median(triple.map(a=>(a[1][1]-a[1][0])/2));
    const chin=extremum(.55,.75,h=>at(mid,h+.009)-at(mid,h-.009));
    const armsMerge=extremum(.40,Math.min(.57,chin-.055),h=>third(h)?h:0);
    const shoulderTop=extremum(chin+.025,Math.min(.78,chin+.13),h=>{
      const a=ranges(h-.012),b=ranges(h+.012);return (a.at(-1)?.[1]??0)-(b.at(-1)?.[1]??0);
    });
    const armGap=median(triple.map(a=>(a[2][0]-a[0][1]+a[1][1]-a[1][0])/4));
    const splitArm=Array.from({length:193},(_,i)=>{
      const sections=ranges(i/192);
      if(sections.length===3&&sections[1][0]<mid&&sections[1][1]>mid){
        return [(sections[0][1]+sections[1][0])/2,(sections[1][1]+sections[2][0])/2];
      }
      return null;
    });
    const front=h=>median([-.72,-.4,-.15,.15,.4,.72].map(v=>at(mid+v*trunkWidth,h)));
    const pouchLo=extremum(.31,Math.min(.47,chin-.12),h=>front(h+.012)-front(h-.012));
    const pouchHi=extremum(pouchLo+.045,Math.min(chin-.035,pouchLo+.17),h=>front(h-.012)-front(h+.012));
    const raised=front(pouchLo+.018)-front(pouchLo-.018)>.012&&front(pouchHi-.018)-front(pouchHi+.018)>.012;
    const waist=extremum(.28,Math.min(.42,pouchLo-.008),h=>{
      const part=ranges(h).find(p=>p[0]<=mid&&p[1]>=mid);return part?-(part[1]-part[0]):-Infinity;
    });
    const crotch=extremum(.16,Math.min(.33,waist-.035),h=>paired(h)?h:0)+.012;
    // 用高模投影的左右轮廓测肢体宽度，避开相邻躯干，只在可辨识的分支上选关节。
    function limbWidth(h,arm){
      const sections=ranges(h);
      if(sections.length!==(arm?3:2))return NaN;
      const bands=[sections[0],sections.at(-1)];
      const widths=bands.map(([l,r])=>{
        let lo=Infinity,hi=-Infinity;
        for(let x=l-pitch;x<=r+pitch;x+=pitch)if(Number.isFinite(at(x,h))){
          lo=Math.min(lo,x);hi=Math.max(hi,x);
        }
        return hi-lo;
      });
      return widths.every(Number.isFinite)?(widths[0]+widths[1])*.5:NaN;
    }
    function constriction(start,end,reference,arm){
      let best=reference,bestScore=-Infinity;
      for(let h=start;h<=end;h+=pitch){
        const width=limbWidth(h,arm),below=limbWidth(h-.015,arm),above=limbWidth(h+.015,arm);
        if(![width,above,below].every(Number.isFinite))continue;
        const score=(above+below)*.5-width-.12*Math.abs(h-reference);
        if(score>bestScore){best=h;bestScore=score;}
      }
      return best;
    }
    const ankle=constriction(crotch*.24,crotch*.51,crotch*.34,false);
    const wrist=constriction(armsMerge-.14,armsMerge-.075,armsMerge-.108,true);
    const waistBand=ranges(waist).find(([l,r])=>l<=mid&&r>=mid);
    const hipStart=waistBand?E.clamp((waistBand[1]-waistBand[0])*.45,trunkWidth*.80,trunkWidth*.96):trunkWidth*.86;
    const faceWidth=face.width/span;
    const jaw=h=>chin+Math.min(.058,.042*h*h);
    const cuts=[];
    if(raised){
      const y=(pouchLo+pouchHi)/2;
      for(const x of Array.from({length:Math.ceil(trunkWidth*2/pitch)},(_,i)=>mid-trunkWidth+(i+1)*pitch)){
        const env=k=>median([-.018,0,.018].map(d=>at(k,y+d)));
        const gap=Math.min(env(x-.018),env(x+.018))-env(x);
        if(gap>.004&&x>mid-trunkWidth*.83&&x<mid+trunkWidth*.83)cuts.push({x,gap});
      }
    }
    const seams=[];
    const basicCount=18,capacity=Math.max(0,Math.min(4,limit-basicCount));
    for(const c of cuts.sort((a,b)=>b.gap-a.gap)){
      if(seams.length>=capacity-1)break;
      if(seams.every(x=>abs(x-c.x)>Math.max(.026,trunkWidth*.25)))seams.push(c.x);
    }
    seams.sort((a,b)=>a-b);
    const names=new Map(),groups=[];
    function key(x,y,z){
      const dx=x-mid,side=dx<0?'L':'R',lateral=abs(dx);
      const blend=E.clamp((y-armsMerge)/(shoulderTop-armsMerge||1),0,1);
      const armStart=armGap*(1-blend)+trunkWidth*.62*blend;
      const gap=splitArm[Math.round(E.clamp(y,0,1)*192)];
      const arm=gap?(x<gap[0]||x>gap[1]):lateral>armStart;
      if(y>.22&&y<shoulderTop&&arm){
        const cuff=armsMerge-.065;
        if(y<wrist)return 'hand-'+side;
        if(y<cuff+.023)return 'wrist-'+side;
        if(y<armsMerge+.028)return 'forearm-'+side;
        return 'sleeve-'+side;
      }
      if((y>=jaw(lateral/(faceWidth*.5))&&lateral<Math.max(faceWidth*.68,trunkWidth*.93))||y>=shoulderTop){
        return y>(face.h-base)/span+faceWidth*.31?'crown':'head';
      }
      if(y>=chin-.016&&lateral<trunkWidth*.62)return 'neck';
      if(limit>=24&&y>crotch*.77&&y<waist+.005&&lateral>hipStart)return 'hip-pocket-'+side;
      if(y<crotch)return (y<ankle?'boot-':'leg-')+side;
      if(raised&&capacity>0&&y>=pouchLo-.018&&y<=pouchHi+.02&&lateral<trunkWidth*1.30){
        const u=E.clamp((y-pouchLo)/(pouchHi-pouchLo),0,1);
        const refX=mid+Math.sign(dx)*Math.min(lateral,trunkWidth*.93);
        const floor=at(refX,pouchLo-.025)*(1-u)+at(refX,pouchHi+.027)*u;
        if(z>(Number.isFinite(floor)?floor-.018:front(pouchLo-.023)-.035)){const idx=seams.filter(v=>v<x).length;return 'front-pouch-'+idx;}
      }
      if(y<waist)return 'pelvis';
      if(y<pouchLo+.006)return 'waist';
      return 'chest';
    }
    function nameAt(x,y,z){return key(...coords(x,y,z));}
    for(let i=0;i<data.length;i++){
      const name=nameAt(...data[i].center);
      if(!names.has(name)){names.set(name,groups.length);groups.push([]);}
      groups[names.get(name)].push(i);
    }
    if(groups.length>limit||!names.has('chest')||!names.has('pelvis'))return null;
    const locate=(x,y,z)=>names.get(nameAt(x,y,z))??names.get('chest');
    return {groups,names:[...names.keys()],locate,axes:[axes[0],E.mul(axes[2],-1),axes[1]],regions:{waist,crotch,chin,pouchLo,pouchHi,seams,raised}};
  }
  return {partition};
}
if(typeof module!=='undefined')module.exports=createContourCharacterVolumes;
