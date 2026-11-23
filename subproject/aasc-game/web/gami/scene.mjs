import * as T from './three.mjs';
import {bounds,corners} from './fold.mjs';
const scene=new T.Scene(), camera=new T.PerspectiveCamera(38,1,.1,90);
const renderer=new T.WebGLRenderer({canvas:document.querySelector('#view'),antialias:true});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
scene.background=new T.Color(0xc3d5cb);scene.fog=new T.FogExp2(0xcbd6c6,.028);
const vec=(x,y,z)=>new T.Vector3(x,y,z);
function mat(color,opts={}){return new T.MeshStandardMaterial({color,roughness:.82,...opts})}
function box(parent,w,h,d,x,y,z,m){
  const a=new T.Mesh(new T.BoxGeometry(w,h,d),m);a.position.set(x,y,z);a.castShadow=a.receiveShadow=true;parent.add(a);return a;
}
function random(seed){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296}}
function texture(canvas){
  const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
// 多层低频色带形成木纹，细孔、弯曲年轮和窄拼板缝沿木材长轴排列。
function wood(){
  const c=canvas(1024,768),g=c.getContext('2d'),im=g.createImageData(c.width,c.height),r=random(71);
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const plank=Math.floor(y/128),k=y+5*Math.sin(x*.006+plank)+2*Math.sin(x*.019+y*.012);
    const band=4*Math.sin(k*.11)+3*Math.sin(k*.93)+1.4*Math.sin(k*2.9)+4*Math.sin(plank*2.3);
    const pore=(r()-.5)*9, seam=y%128<2?-25:0,i=(y*c.width+x)*4;
    for(let ch=0;ch<3;ch++)im.data[i+ch]=[157,111,74][ch]+band+pore+seam;
    im.data[i+3]=255;
  }
  g.putImageData(im,0,0);return texture(c);
}
const woodMap=wood(), timber=mat(0xffffff,{map:woodMap,bumpMap:woodMap,bumpScale:.016});
box(scene,15,.24,8,0,-.12,0,timber);
const ivory=mat(0xeee1c7),frame=mat(0x9b7755),dark=mat(0x403e32);
box(scene,23,4,.24,0,-.64,-4.1,ivory);
box(scene,18,.15,.68,0,1.34,-4,ivory);
for(const x of [-7,-3.65,-.85,2.15,5.15,7])box(scene,.13,6,.18,x,4,-4.1,frame);
for(const y of [1.45,3.5,6.3])box(scene,16,.12,.17,0,y,-4.12,frame);
// 远景山脊以深浅层次和空气透视衬出窗框及桌面。
for(let k=0;k<3;k++){
  const sh=new T.Shape();sh.moveTo(-50,-10);
  for(let x=-50;x<=50;x+=.3)sh.lineTo(x,1.3+k*.95+.55*Math.sin(x*.37+k*3)+.24*Math.sin(x*.91+k));
  sh.lineTo(50,-10);const m=new T.Mesh(new T.ShapeGeometry(sh),mat([0x87997b,0x99ad98,0xafbfa8][k]));m.position.z=-10-k*4;scene.add(m);
}
scene.add(new T.HemisphereLight(0xe4efff,0xc39364,1.35));
const sun=new T.DirectionalLight(0xffe0a7,3.6);sun.position.set(-5,6,-8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-8,right:8,top:7,bottom:-7,near:.1,far:30});sun.shadow.normalBias=.012;sun.shadow.bias=-.00015;scene.add(sun);
// 将明亮窗面和室内暖色反射烘入粗糙度环境贴图，折面在背光下仍能读出色阶。
const roomLight=new T.Scene();roomLight.background=new T.Color(0x9faaa9);
const pane=new T.Mesh(new T.PlaneGeometry(9,5),new T.MeshBasicMaterial({color:new T.Color(3.4,3.1,2.5),side:T.DoubleSide}));
pane.position.set(-2,3,-5);roomLight.add(pane);
const bounce=new T.Mesh(new T.PlaneGeometry(18,18),new T.MeshBasicMaterial({color:0xb6926c,side:T.DoubleSide}));bounce.rotation.x=-Math.PI/2;bounce.position.y=-2;roomLight.add(bounce);
const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(roomLight,.08).texture;pmrem.dispose();
const fill=new T.DirectionalLight(0xffe9cc,.72);fill.position.set(2,4,5);scene.add(fill);
// 窗旁课桌静物：布面书、陶杯、铅笔与枝叶均使用实体网格投影。
const book=(x,z,w,d,color,y,angle)=>{
  const group=new T.Group();scene.add(group);group.position.set(x,y,z);group.rotation.y=angle;
  box(group,w,.14,d,0,.09,0,mat(0xe6d6ac));for(const h of [.008,.168])box(group,w+.04,.025,d+.04,0,h,0,mat(color));
};
book(-3.1,-2,1.8,1.25,0x40594d,0,-.08);book(-3.05,-2.04,1.64,1.14,0x9e6245,.19,.06);
function cylinder(r1,r2,h,m,x,y,z){
  const o=new T.Mesh(new T.CylinderGeometry(r1,r2,h,32),m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;scene.add(o);return o;
}
cylinder(.38,.27,.63,mat(0xc4a084),3,.315,-2.8);
const rng=random(55);
function twig(a,b,width){
  const delta=b.clone().sub(a),o=cylinder(width*.65,width,delta.length(),dark,0,0,0);
  o.position.copy(a).lerp(b,.5);o.quaternion.setFromUnitVectors(vec(0,1,0),delta.normalize());
}
for(let k=0;k<15;k++){
  const base=vec(3,.55,-2.8),end=vec(3+(rng()-.5)*1.6,.95+rng()*1.1,-2.8+(rng()-.5)*1.1);
  twig(base,end,.016);for(let j=0;j<4;j++){const leaf=new T.Mesh(new T.SphereGeometry(1,12,6),mat(j%2?0x758254:0x556c4b));
  leaf.position.copy(base).lerp(end,.45+j*.17);leaf.position.x+=.09*(j%2?1:-1);leaf.scale.set(.16,.035,.072);leaf.rotation.z=j%2?.53:-.53;leaf.castShadow=true;scene.add(leaf);}
}
for(let i=0;i<2;i++){const p=cylinder(.035,.035,1.48,mat(i?0xe1b662:0x566c61),2.65+i*.12,.043,1.12);p.rotation.z=Math.PI/2;p.rotation.y=.3+i*.07;}
const paperCache=new Map();
function paperTexture(color,seed){
  const key=color+seed;if(paperCache.has(key))return paperCache.get(key);
  const c=canvas(512,512),g=c.getContext('2d'),r=random(seed);
  g.fillStyle=color;g.fillRect(0,0,512,512);
  for(let i=0;i<170;i++){
    const x=r()*550-20,y=r()*550-20,rad=12+r()*110,grad=g.createRadialGradient(x,y,0,x,y,rad),ink=i%3?'255,249,222':'30,45,43';
    grad.addColorStop(0,'rgba('+ink+',.09)');grad.addColorStop(.82,'rgba('+ink+',.04)');grad.addColorStop(1,'rgba('+ink+',0)');
    g.fillStyle=grad;g.fillRect(x-rad,y-rad,rad*2,rad*2);
  }
  for(let i=0;i<22000;i++){g.fillStyle=i%2?'rgba(255,251,229,.14)':'rgba(51,39,27,.08)';g.fillRect(r()*512,r()*512,1+r()*2,.65);}
  const t=texture(c);paperCache.set(key,t);return t;
}
// 首页纸鹤由有方向的三角折面构成，正反面使用不同明度的水彩纸。
const hero=new T.Group();scene.add(hero);hero.position.set(1.18,.018,-.05);hero.scale.setScalar(.88);hero.rotation.y=-.28;
const atlas=paperTexture('#739aa4',512);
function facet(a,b,c,tint){
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([...a,...b,...c],3));
  geo.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,.55,1],2));geo.computeVertexNormals();
  const o=new T.Mesh(geo,mat(tint,{map:atlas,side:T.DoubleSide,flatShading:true}));o.castShadow=o.receiveShadow=true;hero.add(o);
}
const chest=[-.45,.58,0],tail=[.79,.55,0],belly=[.08,.04,0],ridge=[.12,.83,0];
for(const s of [-1,1]){
  const hip=[.15,.48,.39*s],wing=[.64,1.38,1.85*s],pleat=[.0,.7,.78*s],neck=[-1.13,1.48,.035*s],chin=[-.88,1.33,.10*s];
  facet(chest,hip,belly,0xd9d8c7);facet(tail,belly,hip,0xadbcb7);facet(chest,hip,ridge,0xe8e1d2);
  facet(chest,pleat,wing,0xfcf5da);facet(pleat,hip,wing,0x99b0ac);facet(hip,tail,wing,0xdbdec9);
  facet(chest,neck,chin,0xf8e7c8);facet(chest,chin,hip,0xc6d2c4);facet(neck,chin,[-1.51,1.15,0],0xf8ecd4);
  facet(tail,hip,[1.86,1.22,0],0xddd9c0);facet(ridge,tail,[1.86,1.22,0],0xa7b6b4);
}
const scenery=scene.children.filter(object=>!object.isLight);
const homeBackground=scene.background,studioBackground=new T.Color(0xabbab6),focus=vec(0,0,0);
let focusedId=null;
const works=new T.Group();scene.add(works);const aim=vec(0,0,0);let home=true,distance=5.8,yaw=.03,pitch=.96;
export function orbit(dx,dy){yaw-=dx*.007;pitch=T.MathUtils.clamp(pitch+dy*.006,-1.53,1.53);draw()}
export function zoom(n){distance=T.MathUtils.clamp(distance*n,2,13);draw()}
export function mode(isHome){home=isHome;for(const object of scenery)object.visible=home;
  scene.background=home?homeBackground:studioBackground;
  works.visible=!home;focusedId=null;draw()}
export function draw(){
  const w=innerWidth,h=innerHeight,mobile=w/h<.92;
  const ratio=Math.min(devicePixelRatio,1.65);
  if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
  if(renderer.domElement.width!==Math.floor(w*ratio)||renderer.domElement.height!==Math.floor(h*ratio))renderer.setSize(w,h,false);
  camera.aspect=w/h;
  if(home){
    aim.set(mobile?1.18:0,mobile?.0:.54,0);camera.position.set(mobile?2.25:1.5,mobile?4.9:3.05,mobile?7.8:6.3);
    camera.setViewOffset(w,h,0,mobile?h*.12:0,w,h);
  }else{
    camera.clearViewOffset();aim.copy(focus);camera.position.set(distance*Math.cos(pitch)*Math.sin(yaw),distance*Math.sin(pitch),distance*Math.cos(pitch)*Math.cos(yaw)).add(aim);
  }
  camera.lookAt(aim);camera.updateProjectionMatrix();renderer.render(scene,camera);
}
const ray=new T.Raycaster(),plane=new T.Plane(vec(0,1,0),0);
export function pointer(e){
  ray.setFromCamera(new T.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);
  const q=Math.abs(ray.ray.direction.y)<.006?null:ray.ray.intersectPlane(plane,vec(0,0,0));const hit=ray.intersectObjects(works.children,true).find(v=>v.object.userData.id);
  return {world:q?[q.x,q.z]:null,id:hit?.object.userData.id};
}
// 以屏幕像素计算容差，旋转视角、缩放或切换触控设备时都能准确对齐。
export function facingSign(){return camera.position.y>=0?1:-1}
export function projectedCorner(item,p){
  const group=works.children.find(o=>o.userData.id===item.id);
  const pos=group.localToWorld(vec(p[0],0,p[1])).project(camera);
  const ndc=new T.Vector2(pos.x,pos.y);
  ray.setFromCamera(ndc,camera);
  const first=ray.intersectObjects(works.children,true).find(hit=>hit.object.userData.id);
  return {x:(1+pos.x)*innerWidth/2,y:(1-pos.y)*innerHeight/2,visible:Math.abs(pos.z)<1&&(!first||first.object.userData.id===item.id)};
}
function clear(){
  works.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose()});works.clear();
}
function line(group,a,b,color){
  const geo=new T.BufferGeometry().setFromPoints([a,b]);group.add(new T.Line(geo,new T.LineBasicMaterial({color})));
}
export function show(desk,id,preview,selection,grid,tool,snapped){
  clear();
  for(const item of desk.items){
    const group=new T.Group(),faces=item.id===id&&preview?preview:item.faces;
    group.userData.id=item.id;
    group.position.set(item.x,0,item.y);group.rotation.y=item.rot;works.add(group);
    const tex=paperTexture(item.front,item.seed),back=paperTexture(item.back,item.seed+1);
    for(const side of [0,1]){
      const pos=[],uv=[];
      faces.forEach((f,k)=>{
        for(let i=1;i<f.length-1;i++)for(const p of [f[0],f[i+1],f[i]]){
          pos.push(p[0],p[2]+k*.001,p[1]);uv.push(p[3],p[4]);
        }
      });
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
      const mesh=new T.Mesh(geo,mat(0xffffff,{map:side?back:tex,bumpMap:tex,bumpScale:.003,side:side?T.BackSide:T.FrontSide,shadowSide:T.DoubleSide}));
      mesh.castShadow=mesh.receiveShadow=true;mesh.userData.id=item.id;group.add(mesh);
    }
    if(item.id!==id)continue;
    if(focusedId!==id){
      const center=new T.Box3().setFromObject(group).getCenter(vec(0,0,0));
      focus.copy(center);focusedId=id;
    }
    if(snapped){
      const indicator=new T.Mesh(new T.SphereGeometry(.048,16,12),new T.MeshBasicMaterial({color:0xff952f,depthTest:false}));
      indicator.position.set(snapped[0],0,snapped[1]);indicator.renderOrder=3;group.add(indicator);
    }
    if(item.placed||preview)continue;
    const points=corners(item.faces), level=.037+faces.length*.001;
    if(tool==='cut'&&grid){
      const [a,b,c,d]=bounds(faces),[rows,cols]=grid;
      for(let k=1;k<rows;k++){const y=b+(d-b)*k/rows;line(group,vec(a,level,y),vec(c,level,y),0x4c5d4e)}
      for(let k=1;k<cols;k++){const x=a+(c-a)*k/cols;line(group,vec(x,level,b),vec(x,level,d),0x4c5d4e)}
    }
    if(tool==='fold')points.forEach((p,i)=>{
      const active=selection.includes(i),marker=new T.Mesh(new T.SphereGeometry(active?.046:.032,12,8),mat(active?0xd76b3a:0xffedb2));marker.material.depthTest=false;marker.renderOrder=2;marker.userData.id=item.id;marker.position.set(p[0],0,p[1]);group.add(marker);
    });
  }
  draw();
}
addEventListener('resize',draw);draw();
