// 屏幕空间光照着色器。SSGI使用前帧场景颜色与深度层级，历史无效时回退当前帧。
export const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

export const fragmentShader = `
uniform highp sampler2D tDepth;
uniform highp sampler2D tContactDepth;
uniform sampler2D tColor,tHistoryColor;
uniform highp sampler2D tHistoryDepth0,tHistoryDepth1,tHistoryDepth2,tHistoryDepth3;
uniform highp sampler2D tHistoryDepth4,tHistoryDepth5,tHistoryDepth6,tHistoryDepth7;
uniform highp sampler2D tHistoryDepth8,tHistoryDepth9,tHistoryDepth10,tHistoryDepth11;
uniform mat4 inverseProjection,projection,cameraWorld,currentView;
uniform mat4 previousView,previousProjection,previousInverseProjection,previousCameraWorld;
uniform vec2 fullSize,effectSize;
uniform vec3 lightDirection;
uniform bool contactEnabled,giEnabled,historyValid;
uniform float contactStrength,contactDistance,giStrength,giRadius,lightWeight;
uniform float contactFramePhase;
uniform int rayCount,stepCount,contactStepCount,hzbLevelCount;
varying vec2 vUv;
const float PI=3.14159265359;
vec3 positionAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
vec3 historyPositionAt(vec2 uv,float depth){vec4 p=previousInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
bool inside(vec2 uv){return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));}
float edgeFade(vec2 uv){vec2 e=min(uv,1.-uv);return smoothstep(0.,.06,min(e.x,e.y));}
vec3 historyDepthRange(vec2 uv,int level);
vec3 normalAt(vec2 uv,vec3 p){
 vec2 d=1./fullSize;
 vec3 r=positionAt(uv+vec2(d.x,0.),texture2D(tDepth,uv+vec2(d.x,0.)).r)-p;
 vec3 l=p-positionAt(uv-vec2(d.x,0.),texture2D(tDepth,uv-vec2(d.x,0.)).r);
 vec3 u=positionAt(uv+vec2(0.,d.y),texture2D(tDepth,uv+vec2(0.,d.y)).r)-p;
 vec3 b=p-positionAt(uv-vec2(0.,d.y),texture2D(tDepth,uv-vec2(0.,d.y)).r);
 vec3 n=cross(abs(r.z)<abs(l.z)?r:l,abs(u.z)<abs(b.z)?u:b);
 if(dot(n,n)<1e-14)return vec3(0.,0.,1.);
 n=normalize(n);return dot(n,-p)<0.?-n:n;
}
vec3 historyNormalAt(vec2 uv,vec3 p){
 vec2 d=1./effectSize;
 float dr=historyDepthRange(uv+vec2(d.x,0.),0).x,dl=historyDepthRange(uv-vec2(d.x,0.),0).x;
 float du=historyDepthRange(uv+vec2(0.,d.y),0).x,db=historyDepthRange(uv-vec2(0.,d.y),0).x;
 vec3 r=historyPositionAt(uv+vec2(d.x,0.),dr)-p,l=p-historyPositionAt(uv-vec2(d.x,0.),dl);
 vec3 u=historyPositionAt(uv+vec2(0.,d.y),du)-p,b=p-historyPositionAt(uv-vec2(0.,d.y),db);
 vec3 n=cross(abs(r.z)<abs(l.z)?r:l,abs(u.z)<abs(b.z)?u:b);
 if(dot(n,n)<1e-14)return vec3(0.,0.,1.);
 n=normalize(n);return dot(n,-p)<0.?-n:n;
}
// 各HZB层保存近/远深度区间及有效覆盖位；背景不污染粗层级。
vec3 historyDepthRange(vec2 uv,int level){
 vec4 encoded;
 if(level<=0)encoded=texture2D(tHistoryDepth0,uv);
 else if(level==1)encoded=texture2D(tHistoryDepth1,uv);
 else if(level==2)encoded=texture2D(tHistoryDepth2,uv);
 else if(level==3)encoded=texture2D(tHistoryDepth3,uv);
 else if(level==4)encoded=texture2D(tHistoryDepth4,uv);
 else if(level==5)encoded=texture2D(tHistoryDepth5,uv);
 else if(level==6)encoded=texture2D(tHistoryDepth6,uv);
 else if(level==7)encoded=texture2D(tHistoryDepth7,uv);
 else if(level==8)encoded=texture2D(tHistoryDepth8,uv);
 else if(level==9)encoded=texture2D(tHistoryDepth9,uv);
 else if(level==10)encoded=texture2D(tHistoryDepth10,uv);
 else encoded=texture2D(tHistoryDepth11,uv);
 float nearDepth=dot(encoded.rg*255.,vec2(256.,1.))/65535.;
 float farDepth=dot(encoded.ba*255.,vec2(256.,1.))/65535.;
 return vec3(nearDepth,farDepth,nearDepth<.99999?1.:0.);
}
// 细节层命中还要投回当前帧验证可见深度，动态物体不匹配时拒绝旧数据。
bool historyHitVisible(vec3 previousHit,vec2 previousUv,float tolerance){
 vec3 world=(previousCameraWorld*vec4(previousHit,1.)).xyz;
 vec3 current=(currentView*vec4(world,1.)).xyz;
 vec4 clip=projection*vec4(current,1.);if(clip.w<=0.)return false;
 vec2 uv=clip.xy/clip.w*.5+.5;if(!inside(uv))return false;
 float depth=texture2D(tDepth,uv).r;if(depth>=.99999)return false;
 vec3 visible=positionAt(uv,depth);
 return abs(visible.z-current.z)<=max(tolerance,abs(current.z)*.002);
}
// 仅当前帧深度的回退路径，首帧/历史拒绝时保障画面可用。
bool traceCurrent(vec3 start,vec3 direction,float distanceLimit,float bias,int sampleCount,bool allowExit,out vec2 hitUv,out vec3 hit,out float confidence,out float hitDistance){
 float previousGap=-bias;
 // 接触阴影可独立使用4–64步，SSGI当前帧回退仍传入质量档位步数。
 for(int i=1;i<=64;i++){
  if(i>sampleCount)break;
  float t=distanceLimit*float(i)/float(sampleCount);vec3 q=start+direction*t;
  vec4 clip=projection*vec4(q,1.);if(clip.w<=0.)break;
  vec3 ndc=clip.xyz/clip.w;if(abs(ndc.z)>=1.)break;
  vec2 uv=ndc.xy*.5+.5;if(!inside(uv))break;
  float depth=texture2D(tDepth,uv).r;if(depth>=.99999){previousGap=-bias;continue;}
  vec3 surface=positionAt(uv,depth);float gap=surface.z-q.z;
  float thickness=max(bias*3.,distanceLimit/float(sampleCount)*1.5);
  // 接触射线可能从轮廓进入遮挡背后，再从连续表面穿出；只接受进入会漏掉阴影内部。
  // 双向跨越仍先细化，再执行厚度检查，不把任意轮廓跳变直接接受为遮挡。
  if((gap>bias&&previousGap<=bias)||(allowExit&&gap<=bias&&previousGap>bias)){
   bool exiting=gap<=bias;
   float low=distanceLimit*float(i-1)/float(sampleCount),high=t;
   for(int k=0;k<4;k++){
    float middle=(low+high)*.5;vec3 probe=start+direction*middle;
    vec4 projected=projection*vec4(probe,1.);vec2 probeUv=projected.xy/projected.w*.5+.5;
    float probeDepth=texture2D(tDepth,probeUv).r;
    float probeGap=positionAt(probeUv,probeDepth).z-probe.z;
    bool blocked=probeDepth<.99999&&probeGap>bias;
    if(blocked!=exiting)high=middle;else low=middle;
   }
   // 进入时高端在表面背后，穿出时低端在表面背后；统一选取正深度差一侧。
   float refinedDistance=exiting?low:high;
   vec3 refined=start+direction*refinedDistance;vec4 projected=projection*vec4(refined,1.);
   hitUv=projected.xy/projected.w*.5+.5;float refinedDepth=texture2D(tDepth,hitUv).r;
   hit=positionAt(hitUv,refinedDepth);float refinedGap=hit.z-refined.z;
   // 厚度与自遮挡保护基于细化点，拒绝深度轮廓跳变及射线起点附近的伪命中。
   if(refinedDepth>=.99999||refinedGap<=bias||refinedGap>thickness||length(hit-start)<=bias*3.){previousGap=gap;continue;}
   confidence=1.-smoothstep(thickness*.4,thickness,refinedGap);hitDistance=refinedDistance;return true;
  }
  previousGap=gap;
 }
 return false;
}
// 在齐次空间裁剪短射线，避免端点越过近平面时UV翻转或除以零。
bool clipContactPlane(float a,float b,inout vec2 interval){
 if(a<0.&&b<0.)return false;
 float delta=b-a;
 if(delta>0.)interval.x=max(interval.x,-a/delta);
 if(delta<0.)interval.y=min(interval.y,-a/delta);
 return interval.x<=interval.y;
}
bool contactRaySegment(vec3 start,vec3 direction,float distanceLimit,out vec3 screenStart,out vec3 screenDelta,out float endToStartW){
 vec4 a=projection*vec4(start,1.),b=projection*vec4(start+direction*distanceLimit,1.);
 vec2 interval=vec2(0.,1.);
 if(!clipContactPlane(a.w-1e-6,b.w-1e-6,interval))return false;
 if(!clipContactPlane(a.w+a.z,b.w+b.z,interval)||!clipContactPlane(a.w-a.z,b.w-b.z,interval))return false;
 if(!clipContactPlane(a.w*.998+a.x,b.w*.998+b.x,interval)||!clipContactPlane(a.w*.998-a.x,b.w*.998-b.x,interval))return false;
 if(!clipContactPlane(a.w*.998+a.y,b.w*.998+b.y,interval)||!clipContactPlane(a.w*.998-a.y,b.w*.998-b.y,interval))return false;
 vec4 ca=mix(a,b,interval.x),cb=mix(a,b,interval.y);
 screenStart=ca.xyz/ca.w*.5+.5;screenDelta=cb.xyz/cb.w*.5+.5-screenStart;
 endToStartW=cb.w/ca.w;
 return interval.y-interval.x>1e-6;
}
// 接触专用屏幕步进：粗步只做UV/deviceDepth运算；交点用全深度双向细化。
// 粗范围向外量化，取样使用原像素对应的2×2格，奇数尺寸不会错位。
float contactBiasAt(float depth,float bias){
 // 普通透视/正交投影的深度导数；偏置随射线处的w变化，朝相机走时不能沿用起点偏置。
 float inverseW=inverseProjection[2][3]*(depth*2.-1.)+inverseProjection[3][3];
 float determinant=projection[2][2]*projection[3][3]-projection[3][2]*projection[2][3];
 return max(abs(determinant)*bias*.5*inverseW*inverseW/max(abs(1.+bias*projection[2][3]*inverseW),1e-6),1e-8);
}
bool traceContact(vec3 start,vec3 direction,float distanceLimit,float bias,int sampleCount,out vec2 hitUv,out vec3 hit,out float confidence,out float hitDistance){
 vec3 screenStart,screenDelta;float endToStartW;
 if(!contactRaySegment(start,direction,distanceLimit,screenStart,screenDelta,endToStartW))return false;
 vec4 orthogonal=projection*vec4(start-vec3(0.,0.,distanceLimit),1.);
 float startDepth=(projection*vec4(start,1.)).z/(projection*vec4(start,1.)).w*.5+.5;
 float projectedDistance=abs(orthogonal.z/orthogonal.w*.5+.5-startDepth);
 // TAA有效时叠加八相位时间采样；关闭时phase为0，保留原固定空间噪声。
 float jitter=fract(52.9829189*fract(dot(floor(screenStart.xy*fullSize),vec2(.06711056,.00583715)))+contactFramePhase*.61803398875)-.5;
 // 极低步数不额外扩大采样空洞，12步及以上使用完整固定空间相位。
 jitter*=clamp((float(sampleCount)-4.)/8.,0.,1.);
 bool previousBlocked=false;float previousProgress=0.;
 for(int i=1;i<=64;i++){
  if(i>sampleCount)break;
  float linearProgress=i==sampleCount?1.:(float(i)+jitter)/float(sampleCount);
  // 透视端点w变化大时，均匀UV会把短程采样集中在近平面；用一次标量换算保留物理步距。
  float progress=linearProgress*endToStartW/(1.-linearProgress+linearProgress*endToStartW);
  vec3 q=screenStart+screenDelta*progress;
  float depthBias=contactBiasAt(q.z,bias);
  float thickness=max(depthBias*6.,projectedDistance*.04*max(.07,progress));
  vec2 coarseUv=(floor(q.xy*fullSize/2.)+.5)/ceil(fullSize/2.);
  vec4 encoded=texture2D(tContactDepth,coarseUv);
  float nearDepth=dot(encoded.rg*255.,vec2(256.,1.))/65535.;
  float farDepth=dot(encoded.ba*255.,vec2(256.,1.))/65535.;
  float nearGap=q.z-nearDepth,farGap=q.z-farDepth;
  // 只有范围整体确定在同一侧才能略过全深度；跨越仍必须确认。
  if(nearDepth>=.99999||(nearGap<=depthBias&&!previousBlocked)){
   previousBlocked=false;previousProgress=progress;continue;
  }
  if(farGap>thickness&&previousBlocked){previousProgress=progress;continue;}
  float depth=texture2D(tDepth,q.xy).r,gap=depth<.99999?q.z-depth:-depthBias;
  bool currentBlocked=gap>depthBias;
  if(currentBlocked!=previousBlocked){
   bool exiting=!currentBlocked;float low=previousProgress,high=progress;
   // 固定细化精度，不把厚度随粗步长度增大；低采样档也能拒绝轮廓跳变。
   for(int k=0;k<8;k++){
    float middle=(low+high)*.5;vec3 probe=screenStart+screenDelta*middle;
    float d=texture2D(tDepth,probe.xy).r;bool blocked=d<.99999&&probe.z-d>contactBiasAt(probe.z,bias);
    if(blocked!=exiting)high=middle;else low=middle;
   }
   float refinedProgress=exiting?low:high;vec3 refined=screenStart+screenDelta*refinedProgress;
   hitUv=refined.xy;float d=texture2D(tDepth,hitUv).r;
   vec3 rayPoint=positionAt(hitUv,refined.z);hit=positionAt(hitUv,d);
   float refinedGap=refined.z-d;
   float refinedBias=contactBiasAt(refined.z,bias);
   float refinedThickness=max(refinedBias*6.,projectedDistance*.04*max(.07,refinedProgress));
   hitDistance=length(rayPoint-start);
   if(d<.99999&&refinedGap>refinedBias&&refinedGap<refinedThickness&&hit.z-rayPoint.z>bias
      &&length(hit-start)>bias*3.&&hitDistance<=distanceLimit+bias){
    confidence=1.-smoothstep(refinedThickness*.4,refinedThickness,refinedGap);return true;
   }
  }
  previousBlocked=currentBlocked;previousProgress=progress;
 }
 return false;
}
// 当前帧射线经相机变换投向上一帧；HZB粗筛后在最细层做区间细化和深度校验。
bool traceHistory(vec3 start,vec3 direction,float distanceLimit,float bias,out vec2 hitUv,out vec3 hit,out float confidence,out float hitDistance,out vec3 historyDirection){
 mat4 currentToPreviousView=previousView*cameraWorld;
 vec3 historyStart=(currentToPreviousView*vec4(start,1.)).xyz;
 historyDirection=normalize(mat3(currentToPreviousView)*direction);
 float previousGap=-bias;vec2 priorUv=vec2(-2.);
 for(int i=1;i<=32;i++){
  if(i>stepCount)break;
  float t=distanceLimit*float(i)/float(stepCount);vec3 q=historyStart+historyDirection*t;
  vec4 clip=previousProjection*vec4(q,1.);if(clip.w<=0.)break;
  vec3 ndc=clip.xyz/clip.w;if(abs(ndc.z)>=1.)break;
  vec2 uv=ndc.xy*.5+.5;if(!inside(uv))break;
  float screenStep=priorUv.x<0.?1.:length((uv-priorUv)*effectSize);
  int level=int(clamp(floor(log2(max(screenStep,1.))),0.,float(hzbLevelCount-1)));
  vec3 range=historyDepthRange(uv,level);
  if(range.z<.5){previousGap=-bias;priorUv=uv;continue;}
  float depth=range.x;vec3 surface=historyPositionAt(uv,depth);float gap=surface.z-q.z;
  float thickness=max(bias*3.,distanceLimit/float(stepCount)*1.5);
  if(gap>bias&&gap<thickness&&previousGap<=bias&&length(surface-historyStart)>bias*3.){
   float low=distanceLimit*float(i-1)/float(stepCount),high=t;bool valid=true;
   for(int k=0;k<4;k++){
    float middle=(low+high)*.5;vec3 probe=historyStart+historyDirection*middle;
    vec4 projected=previousProjection*vec4(probe,1.);vec2 probeUv=projected.xy/projected.w*.5+.5;
    vec3 probeRange=historyDepthRange(probeUv,0);if(probeRange.z<.5){valid=false;break;}
    float probeGap=historyPositionAt(probeUv,probeRange.x).z-probe.z;
    if(probeGap>bias)high=middle;else low=middle;
   }
   vec3 refined=historyStart+historyDirection*high;vec4 projected=previousProjection*vec4(refined,1.);
   hitUv=projected.xy/projected.w*.5+.5;vec3 refinedRange=historyDepthRange(hitUv,0);
   hit=historyPositionAt(hitUv,refinedRange.x);float refinedGap=hit.z-refined.z;
   if(valid&&refinedRange.z>.5&&refinedGap>=0.&&refinedGap<=thickness&&historyHitVisible(hit,hitUv,thickness)){
    confidence=1.-smoothstep(thickness*.4,thickness,refinedGap);hitDistance=high;return true;
   }
   previousGap=gap;
  }else previousGap=gap;
  priorUv=uv;
 }
 return false;
}
void main(){
 float depth=texture2D(tDepth,vUv).r;vec4 color=texture2D(tColor,vUv);
 if(depth>=.99999||color.a<.01){gl_FragColor=vec4(0.);return;}
 vec3 p=positionAt(vUv,depth),n=normalAt(vUv,p);
 float pixelSize=length(positionAt(vUv+vec2(1./fullSize.x,0.),depth)-p);
 float bias=max(pixelSize*.7,max(1e-4,abs(p.z)*1e-5));
 vec3 start=p+n*bias*2.;vec2 hitUv;vec3 hit;float confidence,hitDistance;float shadow=0.;vec3 bounce=vec3(0.);
 float facing=max(dot(n,lightDirection),0.);
 if(contactEnabled&&facing>0.&&lightWeight>0.){
  if(traceContact(start,lightDirection,contactDistance,bias,contactStepCount,hitUv,hit,confidence,hitDistance)){
   shadow=confidence*contactStrength*lightWeight*smoothstep(0.,.25,facing)*edgeFade(hitUv);
   shadow*=1.-smoothstep(contactDistance*.75,contactDistance,length(hit-p));
  }
 }
 if(giEnabled){
  vec3 axis=abs(n.z)<.95?vec3(0.,0.,1.):vec3(0.,1.,0.);
  vec3 tangent=normalize(cross(axis,n)),bitangent=cross(n,tangent);
  for(int j=0;j<8;j++){
   if(j>=rayCount)break;
   float u=(float(j)+.5)/float(rayCount),a=float(j)*2.399963;
   vec3 dir=tangent*(sqrt(u)*cos(a))+bitangent*(sqrt(u)*sin(a))+n*sqrt(1.-u);
   bool usedHistory=false;vec3 historyDir=dir;
   if(historyValid)usedHistory=traceHistory(start,dir,giRadius,bias,hitUv,hit,confidence,hitDistance,historyDir);
   if(!usedHistory&&!traceCurrent(start,dir,giRadius,bias,stepCount,false,hitUv,hit,confidence,hitDistance))continue;
   vec3 otherNormal=usedHistory?historyNormalAt(hitUv,hit):normalAt(hitUv,hit);
   vec3 incomingDirection=usedHistory?historyDir:dir;
   float weight=confidence*max(dot(otherNormal,-incomingDirection),0.)*edgeFade(hitUv);
   weight*=1.-smoothstep(0.,giRadius,hitDistance);
   vec4 incoming=usedHistory?texture2D(tHistoryColor,hitUv):texture2D(tColor,hitUv);float incomingWeight=1.;
   for(int k=0;k<4;k++){
    vec2 offset=k==0?vec2(1.,0.):k==1?vec2(-1.,0.):k==2?vec2(0.,1.):vec2(0.,-1.);
    if(usedHistory){
     vec2 q=hitUv+offset/effectSize*2.;vec3 sampleRange=historyDepthRange(q,0);
     if(!inside(q)||sampleRange.z<.5)continue;
     vec3 delta=historyPositionAt(q,sampleRange.x)-hit;
     float w=exp(-abs(dot(delta,otherNormal))/max(bias*3.,.001));
     incoming+=texture2D(tHistoryColor,q)*w;incomingWeight+=w;
    }else{
     vec2 q=hitUv+offset/fullSize*2.;float d=texture2D(tDepth,q).r;
     if(!inside(q)||d>=.99999)continue;
     vec3 delta=positionAt(q,d)-hit;float w=exp(-abs(dot(delta,otherNormal))/max(bias*3.,.001));
     incoming+=texture2D(tColor,q)*w;incomingWeight+=w;
    }
   }
   incoming/=incomingWeight;
   float luminance=dot(incoming.rgb,vec3(.2126,.7152,.0722));incoming.rgb/=1.+max(luminance-.6,0.);
   bounce+=incoming.rgb*weight*incoming.a;
  }
  vec3 tint=clamp(color.rgb/max(max(color.r,color.g),max(color.b,.15)),vec3(.05),vec3(1.));
  bounce=clamp(bounce/float(rayCount)*giStrength*tint,vec3(0.),vec3(1.));
 }
 gl_FragColor=vec4(bounce,clamp(shadow,0.,.85));
}`;

// 深度引导上采样，颜色/alpha只在原场景有深度的位置参与。
export const compositeChunk = `
uniform sampler2D screenLightingTexture;
uniform bool screenLightingEnabled;
uniform float screenAoEnabled;
uniform vec2 screenLightingSize,screenLightingFullSize;
vec3 screenNormalAt(vec2 uv,vec3 p){
 vec2 d=1./screenLightingFullSize;
 vec3 r=edgePosition(uv+vec2(d.x,0.),texture2D(tDepth,uv+vec2(d.x,0.)).r)-p;
 vec3 l=p-edgePosition(uv-vec2(d.x,0.),texture2D(tDepth,uv-vec2(d.x,0.)).r);
 vec3 u=edgePosition(uv+vec2(0.,d.y),texture2D(tDepth,uv+vec2(0.,d.y)).r)-p;
 vec3 b=p-edgePosition(uv-vec2(0.,d.y),texture2D(tDepth,uv-vec2(0.,d.y)).r);
 vec3 n=cross(abs(r.z)<abs(l.z)?r:l,abs(u.z)<abs(b.z)?u:b);
 if(dot(n,n)<1e-14)return vec3(0.,0.,1.);
 n=normalize(n);return dot(n,-p)<0.?-n:n;
}
vec4 resolveScreenLighting(vec2 uv,float depth){
 vec2 pixel=uv*screenLightingSize-.5,base=floor(pixel),f=fract(pixel);
 vec3 p=edgePosition(uv,depth),n=screenNormalAt(uv,p);vec4 sum=vec4(0.);float total=0.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 q=(base+vec2(float(x),float(y))+.5)/screenLightingSize;
  float d=texture2D(tDepth,q).r;if(d>=.99999)continue;
  vec3 other=edgePosition(q,d),otherNormal=screenNormalAt(q,other);
  float gap=max(abs(dot(other-p,n)),abs(dot(other-p,otherNormal)));
  float w=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
  float footprint=length(edgePosition(uv+1./screenLightingSize,depth)-p);
  w*=exp(-gap/max(.002,footprint*.65))*pow(max(dot(n,otherNormal),0.),16.);
  sum+=texture2D(screenLightingTexture,q)*w;total+=w;
 }
 return total>1e-5?sum/total:vec4(0.);
}
`;

// 深度/法线保边滤波，按模式只处理SSGI RGB或接触alpha，另一通道保持中心值。
export const filterShader = `
uniform sampler2D tInput;
uniform highp sampler2D tDepth;
uniform mat4 inverseProjection;
uniform vec2 fullSize,effectSize,filterAxis;
uniform int blurRadius;
uniform bool filterContact;
varying vec2 vUv;
vec3 positionAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
bool inside(vec2 uv){return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));}
vec3 normalAt(vec2 uv,vec3 p){
 vec2 d=1./fullSize;
 vec3 r=positionAt(uv+vec2(d.x,0.),texture2D(tDepth,uv+vec2(d.x,0.)).r)-p;
 vec3 l=p-positionAt(uv-vec2(d.x,0.),texture2D(tDepth,uv-vec2(d.x,0.)).r);
 vec3 u=positionAt(uv+vec2(0.,d.y),texture2D(tDepth,uv+vec2(0.,d.y)).r)-p;
 vec3 b=p-positionAt(uv-vec2(0.,d.y),texture2D(tDepth,uv-vec2(0.,d.y)).r);
 vec3 n=cross(abs(r.z)<abs(l.z)?r:l,abs(u.z)<abs(b.z)?u:b);
 if(dot(n,n)<1e-14)return vec3(0.,0.,1.);
 n=normalize(n);return dot(n,-p)<0.?-n:n;
}
void main(){
 float depth=texture2D(tDepth,vUv).r;
 if(depth>=.99999){gl_FragColor=vec4(0.);return;}
 vec3 p=positionAt(vUv,depth),n=normalAt(vUv,p);
 float footprint=length(positionAt(vUv+1./effectSize,depth)-p),tolerance=max(.001,footprint*.65);
 vec4 center=texture2D(tInput,vUv);float sigma=max(float(blurRadius)*.5,.5);
 vec4 sum=vec4(0.);float total=0.;
 for(int i=-5;i<=5;i++){
  if(abs(i)>blurRadius)continue;
  vec2 q=vUv+filterAxis*float(i)/effectSize;if(!inside(q))continue;
  float d=texture2D(tDepth,q).r;if(d>=.99999)continue;
  vec3 other=positionAt(q,d),otherNormal=normalAt(q,other),delta=other-p;
  float plane=max(abs(dot(delta,n)),abs(dot(delta,otherNormal)));
  float w=exp(-float(i*i)/(2.*sigma*sigma)-plane/tolerance)*pow(max(dot(n,otherNormal),0.),16.);
  sum+=texture2D(tInput,q)*w;total+=w;
 }
 vec4 filtered=total>1e-5?sum/total:center;
 gl_FragColor=vec4(filterContact?center.rgb:filtered.rgb,filterContact?filtered.a:center.a);
}`;

// SceneColor Reduction 通过对应深度层过滤跨物体颜色混合。
export const colorReductionShader = `
uniform sampler2D tInput;
uniform highp sampler2D tDepthInput;
uniform bool depthIsRaw;
uniform mat4 inverseProjection;
uniform vec2 inputSize,outputSize;
varying vec2 vUv;
float unpackDepth16(vec2 encoded){vec2 bytes=encoded*255.;return (bytes.x*256.+bytes.y)/65535.;}
float readDepth(vec2 uv){vec4 value=texture2D(tDepthInput,uv);return depthIsRaw?value.r:unpackDepth16(value.rg);}
float viewZ(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.z/p.w;}
void main(){
 vec2 footprint=inputSize/outputSize,base=floor(vUv*outputSize)*footprint;
 vec2 uv0=(base+footprint*vec2(.25,.25))/inputSize,uv1=(base+footprint*vec2(.75,.25))/inputSize;
 vec2 uv2=(base+footprint*vec2(.25,.75))/inputSize,uv3=(base+footprint*vec2(.75,.75))/inputSize;
 vec4 c0=texture2D(tInput,uv0),c1=texture2D(tInput,uv1),c2=texture2D(tInput,uv2),c3=texture2D(tInput,uv3);
 float d0=readDepth(uv0),d1=readDepth(uv1),d2=readDepth(uv2),d3=readDepth(uv3);
 float z0=viewZ(uv0,d0),z1=viewZ(uv1,d1),z2=viewZ(uv2,d2),z3=viewZ(uv3,d3);
 float referenceZ=-1e20,validCount=0.;
 if(d0<.99999){referenceZ=max(referenceZ,z0);validCount+=1.;}
 if(d1<.99999){referenceZ=max(referenceZ,z1);validCount+=1.;}
 if(d2<.99999){referenceZ=max(referenceZ,z2);validCount+=1.;}
 if(d3<.99999){referenceZ=max(referenceZ,z3);validCount+=1.;}
 if(validCount<.5){gl_FragColor=(c0+c1+c2+c3)*.25;return;}
 float tolerance=max(.01,abs(referenceZ)*.025);
 float w0=d0<.99999?exp(-abs(z0-referenceZ)/tolerance):0.;
 float w1=d1<.99999?exp(-abs(z1-referenceZ)/tolerance):0.;
 float w2=d2<.99999?exp(-abs(z2-referenceZ)/tolerance):0.;
 float w3=d3<.99999?exp(-abs(z3-referenceZ)/tolerance):0.;
 float total=w0+w1+w2+w3;
 gl_FragColor=(c0*w0+c1*w1+c2*w2+c3*w3)/max(total,1e-6);
}`;

// 深度归约保存near/far 16-bit范围；空层用near=1、far=0哨兵，不把背景混入有效层。
export const depthReductionShader = `
uniform sampler2D tInput;
uniform bool sourceIsDepth;
uniform vec2 inputSize,outputSize;
varying vec2 vUv;
vec2 packDepth16(float depth){float value=floor(clamp(depth,0.,1.)*65535.);return vec2(floor(value/256.),mod(value,256.))/255.;}
float unpackDepth16(vec2 encoded){vec2 bytes=encoded*255.;return (bytes.x*256.+bytes.y)/65535.;}
vec4 readDepth(vec2 uv){
 if(sourceIsDepth){float d=texture2D(tInput,uv).r;return vec4(d,d,d<.99999?1.:0.,1.);}
 vec4 encoded=texture2D(tInput,uv);float nearestDepth=unpackDepth16(encoded.rg),farthestDepth=unpackDepth16(encoded.ba);
 return vec4(nearestDepth,farthestDepth,nearestDepth<.99999?1.:0.,1.);
}
void main(){
 vec2 footprint=inputSize/outputSize,base=floor(vUv*outputSize)*footprint;
 vec2 offsets[4];offsets[0]=vec2(.25,.25);offsets[1]=vec2(.75,.25);offsets[2]=vec2(.25,.75);offsets[3]=vec2(.75,.75);
 float nearestDepth=1.,farthestDepth=0.,valid=0.;
 for(int i=0;i<4;i++){
  vec2 offset=i==0?vec2(.25,.25):i==1?vec2(.75,.25):i==2?vec2(.25,.75):vec2(.75,.75);
  vec2 uv=(base+footprint*offset)/inputSize;vec4 sampleValue=readDepth(uv);
  if(sampleValue.b>.5){nearestDepth=min(nearestDepth,sampleValue.r);farthestDepth=max(farthestDepth,sampleValue.g);valid=1.;}
 }
 vec2 nearestPacked=packDepth16(valid>.5?nearestDepth:1.),farthestPacked=packDepth16(valid>.5?farthestDepth:0.);
 gl_FragColor=vec4(nearestPacked,farthestPacked);
}`;

// 当前帧接触粗深度：精确覆盖2×2原像素，奇数边缘夹紧，near向下/far向上量化。
// 背景参与far范围，混合格不会被错误视作完整前景而裁掉薄发片。
export const contactDepthReductionShader = `
uniform highp sampler2D tInput;
uniform vec2 inputSize;
varying vec2 vUv;
vec2 packCode(float code){return vec2(floor(code/256.),mod(code,256.))/255.;}
void main(){
 vec2 base=floor(gl_FragCoord.xy)*2.;float nearDepth=1.,farDepth=0.;
 for(int i=0;i<4;i++){
  vec2 offset=vec2(float(i-i/2*2),float(i/2));
  vec2 uv=(min(base+offset,inputSize-1.)+.5)/inputSize;
  float d=texture2D(tInput,uv).r;nearDepth=min(nearDepth,d);farDepth=max(farDepth,d);
 }
 // 乘法也会舍入：在整数码边界留一码余量，保证解码范围仍包住真实float32深度。
 float nearCode=nearDepth>=.99999?65535.:max(0.,floor(nearDepth*65535.)-1.);
 float farCode=min(65535.,ceil(farDepth*65535.)+1.);
 gl_FragColor=vec4(packCode(nearCode),packCode(farCode));
}`;
