export const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
// 输入与历史均为线性预乘RGBA；历史深度用独立RGBA8保存，避免颜色滤波污染深度。
export const resolveShader = `
uniform sampler2D tCurrent,tHistory,tHistoryDepth;
uniform highp sampler2D tDepth;
uniform mat4 inverseProjection,cameraWorld,previousView,previousProjection,previousInverseProjection;
uniform vec2 size;
uniform float historyWeight;
uniform bool historyValid;
varying vec2 vUv;
#include <packing>
vec3 positionAt(vec2 uv,float depth,mat4 inverse){vec4 p=inverse*vec4(uv*2.-1.,depth*2.-1.,1.);return p.xyz/p.w;}
void main(){
 vec4 current=texture2D(tCurrent,vUv);
 if(!historyValid||historyWeight<=0.){gl_FragColor=current;return;}
 float depth=texture2D(tDepth,vUv).r;
 vec2 oldUv=vUv;float expectedZ=0.;
 if(depth<.99999){
  vec3 position=positionAt(vUv,depth,inverseProjection);
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
  vec3 neighbor=positionAt(vUv+vec2(1./size.x,0.),depth,inverseProjection);
  float tolerance=max(abs(expectedZ)*.002,length(neighbor-positionAt(vUv,depth,inverseProjection))*.75);
  if(abs(oldPosition.z-expectedZ)>max(tolerance,1e-4)){gl_FragColor=current;return;}
 }
 vec4 minimum=current,maximum=current;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec4 neighbor=texture2D(tCurrent,clamp(vUv+vec2(float(x),float(y))/size,.5/size,1.-.5/size));
  minimum=min(minimum,neighbor);maximum=max(maximum,neighbor);
 }
 vec4 old=texture2D(tHistory,oldUv);
 if(abs(old.a-current.a)>.75){gl_FragColor=current;return;}
 old=clamp(old,minimum,maximum);
 // 运动颜色变化降低权重，配合深度拒绝；首版没有骨骼运动矢量。
 float change=max(max(abs(old.r-current.r),abs(old.g-current.g)),abs(old.b-current.b));
 float weight=historyWeight*(1.-smoothstep(.08,.35,change));
 weight*=1.-smoothstep(.1,.7,abs(old.a-current.a));
 gl_FragColor=mix(current,old,weight);
 if(gl_FragColor.a<1e-6)gl_FragColor=vec4(0.);
}`;
export const depthShader = `uniform highp sampler2D tDepth;varying vec2 vUv;
#include <packing>
void main(){gl_FragColor=packDepthToRGBA(min(texture2D(tDepth,vUv).r,.99999994));}`;
export const presentShader = `uniform sampler2D tColor;varying vec2 vUv;
void main(){
 vec4 color=texture2D(tColor,vUv);
 gl_FragColor=vec4(color.a>1e-6?color.rgb/color.a:vec3(0.),color.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=gl_FragColor.a;
}`;
