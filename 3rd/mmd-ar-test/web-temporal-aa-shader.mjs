export const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
// 输入与历史均为线性预乘RGBA；历史深度用独立RGBA8保存，避免颜色滤波污染深度。
export const resolveShader = `
uniform sampler2D tCurrent,tHistory,tHistoryDepth;
uniform highp sampler2D tDepth;
uniform mat4 inverseProjection,cameraWorld,previousView,previousProjection,previousInverseProjection;
uniform vec2 inputSize,outputSize;
uniform float historyWeight;
uniform bool historyValid,upscaleEnabled;
varying vec2 vUv;
#include <packing>
vec3 positionAt(vec2 uv,float depth,mat4 inverse){vec4 p=inverse*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
vec2 clampInputUv(vec2 uv){vec2 halfTexel=.5/inputSize;return clamp(uv,halfTexel,vec2(1.)-halfTexel);}
vec4 reconstructCurrent(vec2 uv,out vec2 depthUv,out float depth){
 if(!upscaleEnabled){depthUv=clampInputUv(uv);depth=texture2D(tDepth,depthUv).r;return texture2D(tCurrent,uv);}
 vec2 pixel=uv*inputSize-.5,base=floor(pixel),f=fract(pixel);
 float nearestDepth=1.;vec2 nearestUv=clampInputUv((floor(uv*inputSize)+.5)/inputSize);
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 q=clampInputUv((base+vec2(float(x),float(y))+.5)/inputSize);float d=texture2D(tDepth,q).r;
  float wx=x==0?1.-f.x:f.x,wy=y==0?1.-f.y:f.y;
  // 零空间权重的相邻前景不属于当前像素，不能把背景中心的深度或颜色替换掉。
  if(wx*wy>1e-6&&d<nearestDepth){nearestDepth=d;nearestUv=q;}
 }
 depthUv=nearestUv;depth=nearestDepth;
 vec3 referencePosition=nearestDepth<.99999?positionAt(nearestUv,nearestDepth,inverseProjection):vec3(0.);
 float tolerance=max(abs(referencePosition.z)*.015,.002);
 vec4 foreground=vec4(0.),background=vec4(0.);float foregroundWeight=0.,coverage=0.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 q=clampInputUv((base+vec2(float(x),float(y))+.5)/inputSize);float sampleDepth=texture2D(tDepth,q).r;
  float wx=x==0?1.-f.x:f.x,wy=y==0?1.-f.y:f.y;float weight=wx*wy;
  vec4 color=texture2D(tCurrent,q);
  if(sampleDepth>=.99999){background+=color*weight;continue;}
  // 深度相似度只规范化前景内部颜色；前景/背景的空间覆盖比例仍由原双线性权重决定。
  coverage+=weight;
  vec3 samplePosition=positionAt(q,sampleDepth,inverseProjection);
  float guidedWeight=weight*exp(-abs(samplePosition.z-referencePosition.z)/tolerance);
  foreground+=color*guidedWeight;foregroundWeight+=guidedWeight;
 }
 vec4 foregroundColor=foregroundWeight>1e-6?foreground/foregroundWeight:texture2D(tCurrent,nearestUv);
 return background+foregroundColor*coverage;
}
void main(){
 vec2 outputUv=clamp(vUv,.5/outputSize,vec2(1.)-.5/outputSize);vec2 depthUv;float depth;
 vec4 current=reconstructCurrent(outputUv,depthUv,depth);vec3 position=depth<.99999?positionAt(depthUv,depth,inverseProjection):vec3(0.);
 if(!historyValid||historyWeight<=0.){gl_FragColor=current;return;}
 vec2 oldUv=outputUv;float expectedZ=0.;
 if(depth<.99999){
  vec4 oldPosition=previousView*cameraWorld*vec4(position,1.);
  vec4 clip=previousProjection*oldPosition;
  if(clip.w<=0.){gl_FragColor=current;return;}
  vec3 oldNdc=clip.xyz/clip.w;
  if(abs(oldNdc.z)>1.){gl_FragColor=current;return;}
  oldUv=oldNdc.xy*.5+.5;expectedZ=oldPosition.z;
 }
 if(any(lessThan(oldUv,vec2(0.)))||any(greaterThan(oldUv,vec2(1.)))){gl_FragColor=current;return;}
 float oldDepth=unpackRGBAToDepth(texture2D(tHistoryDepth,oldUv));
 if((depth>=.99999)!=(oldDepth>=.99999)){gl_FragColor=current;return;}
 if(depth<.99999){
  vec3 oldPosition=positionAt(oldUv,oldDepth,previousInverseProjection);
  vec2 neighborUv=clampInputUv(depthUv+vec2(1./inputSize.x,0.));float neighborDepth=texture2D(tDepth,neighborUv).r;
  vec3 neighbor=neighborDepth<.99999?positionAt(neighborUv,neighborDepth,inverseProjection):position;
  float tolerance=max(abs(expectedZ)*.002,length(neighbor-position)*.75);
  if(abs(oldPosition.z-expectedZ)>max(tolerance,1e-4)){gl_FragColor=current;return;}
 }
 vec4 minimum=current,maximum=current;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 q=clampInputUv(outputUv+vec2(float(x),float(y))/inputSize);
  vec4 neighborColor=texture2D(tCurrent,q);minimum=min(minimum,neighborColor);maximum=max(maximum,neighborColor);
 }
 vec4 old=texture2D(tHistory,oldUv);
 if(abs(old.a-current.a)>.75){gl_FragColor=current;return;}
 old=clamp(old,minimum,maximum);
 // 运动颜色变化降低权重，配合深度拒绝；不使用物体或骨骼运动矢量。
 float change=max(max(abs(old.r-current.r),abs(old.g-current.g)),abs(old.b-current.b));
 float weight=historyWeight*(1.-smoothstep(.08,.35,change));
 weight*=1.-smoothstep(.1,.7,abs(old.a-current.a));
 gl_FragColor=mix(current,old,weight);
 if(gl_FragColor.a<1e-6)gl_FragColor=vec4(0.);
}`;
export const depthShader = `uniform highp sampler2D tDepth;varying vec2 vUv;
#include <packing>
void main(){gl_FragColor=packDepthToRGBA(min(texture2D(tDepth,vUv).r,.99999994));}`;
export const presentShader = `uniform sampler2D tColor;uniform vec2 outputSize;uniform bool edgeAaEnabled;varying vec2 vUv;
float edgeLuma(vec4 color){return dot(color.rgb,vec3(.299,.587,.114))+color.a*.05;}
vec2 clampOutputUv(vec2 uv){vec2 halfTexel=.5/outputSize;return clamp(uv,halfTexel,vec2(1.)-halfTexel);}
vec4 edgeFilteredColor(vec2 uv){
 vec2 texel=1./outputSize;vec4 center=texture2D(tColor,uv);
 vec4 north=texture2D(tColor,clampOutputUv(uv+vec2(0.,-texel.y)));
 vec4 south=texture2D(tColor,clampOutputUv(uv+vec2(0.,texel.y)));
 vec4 west=texture2D(tColor,clampOutputUv(uv+vec2(-texel.x,0.)));
 vec4 east=texture2D(tColor,clampOutputUv(uv+vec2(texel.x,0.)));
 vec4 nw=texture2D(tColor,clampOutputUv(uv+vec2(-texel.x,-texel.y)));
 vec4 ne=texture2D(tColor,clampOutputUv(uv+vec2(texel.x,-texel.y)));
 vec4 sw=texture2D(tColor,clampOutputUv(uv+vec2(-texel.x,texel.y)));
 vec4 se=texture2D(tColor,clampOutputUv(uv+texel));
 float lumaM=edgeLuma(center),lumaN=edgeLuma(north),lumaS=edgeLuma(south),lumaW=edgeLuma(west),lumaE=edgeLuma(east);
 float lumaNW=edgeLuma(nw),lumaNE=edgeLuma(ne),lumaSW=edgeLuma(sw),lumaSE=edgeLuma(se);
 float lumaMin=min(lumaM,min(min(lumaN,lumaS),min(lumaW,lumaE)));
 lumaMin=min(lumaMin,min(min(lumaNW,lumaNE),min(lumaSW,lumaSE)));
 float lumaMax=max(lumaM,max(max(lumaN,lumaS),max(lumaW,lumaE)));
 lumaMax=max(lumaMax,max(max(lumaNW,lumaNE),max(lumaSW,lumaSE)));
 float threshold=max(1./32.,lumaMax*.125);if(lumaMax-lumaMin<threshold)return center;
 // 用横纵梯度估计边缘法线并旋转为切线，避免斜边四角亮度项相消。
 vec2 gradient=vec2(lumaE-lumaW,lumaS-lumaN);vec2 direction=vec2(-gradient.y,gradient.x);
 float reduce=max((lumaNW+lumaNE+lumaSW+lumaSE)*(.25*.125),1./128.);
 float reciprocal=1./(min(abs(direction.x),abs(direction.y))+reduce);
 direction=clamp(direction*reciprocal,vec2(-8.),vec2(8.))*texel;
 vec4 alongA=.5*(texture2D(tColor,clampOutputUv(uv+direction*(1./3.-.5)))
     +texture2D(tColor,clampOutputUv(uv+direction*(2./3.-.5))));
 vec4 alongB=alongA*.5+.25*(texture2D(tColor,clampOutputUv(uv+direction*-.5))
     +texture2D(tColor,clampOutputUv(uv+direction*.5)));
 float lumaB=edgeLuma(alongB);
 return lumaB<lumaMin||lumaB>lumaMax?alongA:alongB;
}
void main(){
 vec4 color=edgeAaEnabled?edgeFilteredColor(vUv):texture2D(tColor,vUv);
 gl_FragColor=vec4(color.a>1e-6?color.rgb/color.a:vec3(0.),color.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=gl_FragColor.a;
}`;
