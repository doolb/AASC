// 屏幕空间短射线：只处理当前深度层，所有循环都有固定上限。
export const vertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
export const fragmentShader = `
uniform highp sampler2D tDepth;
uniform sampler2D tColor;
uniform mat4 inverseProjection, projection;
uniform vec2 fullSize;
uniform vec3 lightDirection;
uniform bool contactEnabled, giEnabled;
uniform float contactStrength, contactDistance, giStrength, giRadius, lightWeight;
uniform int rayCount, stepCount;
varying vec2 vUv;
const float PI=3.14159265359;
vec3 positionAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
bool inside(vec2 uv){return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));}
float edgeFade(vec2 uv){vec2 e=min(uv,1.-uv);return smoothstep(0.,.06,min(e.x,e.y));}
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
// 返回第一次由前向后跨越可见深度的命中；厚度限定避免远处表面漏光。
bool trace(vec3 start,vec3 direction,float distanceLimit,float bias,out vec2 hitUv,out vec3 hit,out float confidence){
 float previousGap=-bias;
 for(int i=1;i<=32;i++){
  if(i>stepCount)break;
  float t=distanceLimit*float(i)/float(stepCount);
  vec3 q=start+direction*t;
  vec4 clip=projection*vec4(q,1.);if(clip.w<=0.)break;
  vec3 ndc=clip.xyz/clip.w;if(abs(ndc.z)>=1.)break;
  vec2 uv=ndc.xy*.5+.5;if(!inside(uv))break;
  float depth=texture2D(tDepth,uv).r;if(depth>=.99999){previousGap=-bias;continue;}
  vec3 surface=positionAt(uv,depth);float gap=surface.z-q.z;
  float thickness=max(bias*3.,distanceLimit/float(stepCount)*1.5);
  if(gap>bias&&gap<thickness&&previousGap<=bias&&length(surface-start)>bias*3.){
   // 细化跨越区间，减少射线步长造成的阶梯与不稳定命中位置。
   float low=distanceLimit*float(i-1)/float(stepCount),high=t;
   for(int k=0;k<4;k++){
    float middle=(low+high)*.5;vec3 probe=start+direction*middle;
    vec4 projected=projection*vec4(probe,1.);vec2 probeUv=projected.xy/projected.w*.5+.5;
    float probeDepth=texture2D(tDepth,probeUv).r;
    float probeGap=positionAt(probeUv,probeDepth).z-probe.z;
    if(probeDepth<.99999&&probeGap>bias)high=middle;else low=middle;
   }
   vec3 refined=start+direction*high;vec4 projected=projection*vec4(refined,1.);
   hitUv=projected.xy/projected.w*.5+.5;
   float refinedDepth=texture2D(tDepth,hitUv).r;
   hit=positionAt(hitUv,refinedDepth);
   float refinedGap=hit.z-refined.z;
   if(refinedDepth>=.99999||refinedGap<0.||refinedGap>thickness){previousGap=gap;continue;}
   confidence=1.-smoothstep(thickness*.4,thickness,refinedGap);
   return true;
  }
  previousGap=gap;
 }
 return false;
}
void main(){
 float depth=texture2D(tDepth,vUv).r;vec4 color=texture2D(tColor,vUv);
 if(depth>=.99999||color.a<.01){gl_FragColor=vec4(0.);return;}
 vec3 p=positionAt(vUv,depth),n=normalAt(vUv,p);
 float pixelSize=length(positionAt(vUv+vec2(1./fullSize.x,0.),depth)-p);
 float bias=max(pixelSize*.7,max(1e-4,abs(p.z)*1e-5));
 vec3 start=p+n*bias*2.;vec2 hitUv;vec3 hit;float confidence;float shadow=0.;vec3 bounce=vec3(0.);
 float facing=max(dot(n,lightDirection),0.);
 if(contactEnabled&&facing>0.&&lightWeight>0.){
  if(trace(start,lightDirection,contactDistance,bias,hitUv,hit,confidence)){
   shadow=confidence*contactStrength*lightWeight*smoothstep(0.,.25,facing)*edgeFade(hitUv);
   shadow*=1.-smoothstep(contactDistance*.75,contactDistance,length(hit-p));
  }
 }
 if(giEnabled){
  vec3 axis=abs(n.z)<.95?vec3(0.,0.,1.):vec3(0.,1.,0.);
  vec3 tangent=normalize(cross(axis,n)),bitangent=cross(n,tangent);
  // 固定低差异方向，避免逐帧随机噪声；无历史反馈，不积累重影。
  for(int j=0;j<8;j++){
   if(j>=rayCount)break;
   float u=(float(j)+.5)/float(rayCount),a=float(j)*2.399963;
   vec3 dir=tangent*(sqrt(u)*cos(a))+bitangent*(sqrt(u)*sin(a))+n*sqrt(1.-u);
   if(trace(start,dir,giRadius,bias,hitUv,hit,confidence)){
    vec3 otherNormal=normalAt(hitUv,hit);
    float weight=confidence*max(dot(otherNormal,-dir),0.)*edgeFade(hitUv);
    weight*=1.-smoothstep(0.,giRadius,length(hit-p));
    // 命中处先做深度引导的小邻域平均，孤立高光不直接扩散到整条射线。
    vec4 incoming=texture2D(tColor,hitUv);float incomingWeight=1.;
    for(int k=0;k<4;k++){
     vec2 offset=k==0?vec2(1.,0.):k==1?vec2(-1.,0.):k==2?vec2(0.,1.):vec2(0.,-1.);
     vec2 q=hitUv+offset/fullSize*2.;float d=texture2D(tDepth,q).r;
     if(!inside(q)||d>=.99999)continue;
     vec3 delta=positionAt(q,d)-hit;
     float w=exp(-abs(dot(delta,otherNormal))/max(bias*3.,.001));
     incoming+=texture2D(tColor,q)*w;incomingWeight+=w;
    }
    incoming/=incomingWeight;
    float luminance=dot(incoming.rgb,vec3(.2126,.7152,.0722));
    incoming.rgb/=1.+max(luminance-.6,0.);
    bounce+=incoming.rgb*weight*incoming.a;
   }
  }
  // 颜色缓冲代替反照率的实验近似；限幅避免多次叠加及高光过曝扩散。
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

// 两遍可分离双边滤波，背景与法线突变处不跨边扩散。
export const filterShader = `
uniform sampler2D tInput;
uniform highp sampler2D tDepth;
uniform mat4 inverseProjection;
uniform vec2 fullSize,effectSize,filterAxis;
varying vec2 vUv;
vec3 positionAt(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
bool inside(vec2 uv){return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));}
float edgeFade(vec2 uv){vec2 e=min(uv,1.-uv);return smoothstep(0.,.06,min(e.x,e.y));}
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
 float footprint=length(positionAt(vUv+1./effectSize,depth)-p);
 float tolerance=max(.001,footprint*.65);
 vec4 sum=vec4(0.);float total=0.;
 for(int i=-2;i<=2;i++){
  vec2 q=vUv+filterAxis*float(i)/effectSize;if(!inside(q))continue;
  float d=texture2D(tDepth,q).r;if(d>=.99999)continue;
  vec3 other=positionAt(q,d),otherNormal=normalAt(q,other),delta=other-p;
  float plane=max(abs(dot(delta,n)),abs(dot(delta,otherNormal)));
  float w=exp(-float(i*i)/2.-plane/tolerance)*pow(max(dot(n,otherNormal),0.),16.);
  sum+=texture2D(tInput,q)*w;total+=w;
 }
 gl_FragColor=total>1e-5?sum/total:texture2D(tInput,vUv);
}`;
