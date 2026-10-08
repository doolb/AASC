// WebGL2片元计算：每个像素独占一个粒子；着色批次内自由粒子只关联一条约束。
export const QUAD_VERTEX = `precision highp float;
in vec3 position;
void main(){ gl_Position=vec4(position.xy,0.,1.); }`;
export const COMPUTE_FRAGMENT = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D posTex, velTex, prevTex, targetTex, oldTargetTex, rotationTex;
uniform sampler2D edgeTex, colliderTex, particleMetaTex, colliderMaskTex;
uniform int mode, particleCount, colliderCount;
uniform float h, alpha, thickness, targetFraction;
uniform vec3 gravity, wind;
uniform float windStrength;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outVelocity;
layout(location=2) out vec4 outPrevious;
vec4 at(sampler2D t,int id){ ivec2 s=textureSize(t,0); return texelFetch(t,ivec2(id%s.x,id/s.x),0); }
vec3 rotateOffset(vec3 v,vec4 q){return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
void main(){
    ivec2 pixel=ivec2(gl_FragCoord.xy); int id=pixel.y*textureSize(posTex,0).x+pixel.x;
    if(id>=particleCount){outPosition=vec4(0.);outVelocity=vec4(0.);outPrevious=vec4(0.);return;}
    vec4 p=at(posTex,id); vec3 v=at(velTex,id).xyz, old=at(prevTex,id).xyz;
    if(mode==0){ p=at(targetTex,id); v=vec3(0.);old=p.xyz; }
    if(mode==1 && p.w>0.){vec4 q=at(rotationTex,id);vec3 target=at(oldTargetTex,id).xyz;p.xyz=target+rotateOffset(p.xyz-target,q);v=rotateOffset(v,q);old=p.xyz;}
    if(mode==2){
        old=p.xyz;
        if(p.w==0.) p.xyz=mix(at(oldTargetTex,id).xyz,at(targetTex,id).xyz,alpha);
        else {
            vec3 delta=at(targetTex,id).xyz-at(oldTargetTex,id).xyz;
            vec3 target=mix(at(oldTargetTex,id).xyz,at(targetTex,id).xyz,alpha);
            p.xyz+=delta*targetFraction+v*h;
            p.xyz+=(target-p.xyz)*(1.-exp(-20.*h));
        }
    }
    if(mode==3 && p.w>0.){
        vec4 edge=at(edgeTex,id);
        if(edge.w>0.){
            vec4 b=at(posTex,int(edge.x));vec3 d=p.xyz-b.xyz;float len=length(d);
            vec3 ta=mix(at(oldTargetTex,id).xyz,at(targetTex,id).xyz,alpha);
            vec3 tb=mix(at(oldTargetTex,int(edge.x)).xyz,at(targetTex,int(edge.x)).xyz,alpha);
            if(len>1e-10) p.xyz-=d*((len-length(ta-tb))/(p.w+b.w+edge.z/(h*h))/len)*p.w;
        }
    }
    if(mode==4){
        vec3 contact=vec3(0.),surface=vec3(0.);
        if(p.w>0.) for(int k=0;k<colliderCount;k++){
            int owner=int(at(particleMetaTex,id).x);
            if(at(colliderMaskTex,owner*colliderCount+k).x<.5)continue;
            int ci=k*8;vec4 center=at(colliderTex,ci),size=at(colliderTex,ci+1);
            vec3 lo=at(colliderTex,ci+6).xyz-vec3(thickness),hi=at(colliderTex,ci+7).xyz+vec3(thickness);
            if(any(lessThan(p.xyz,lo))||any(greaterThan(p.xyz,hi))) continue;
            mat3 rot=mat3(at(colliderTex,ci+2).xyz,at(colliderTex,ci+3).xyz,at(colliderTex,ci+4).xyz);
            vec3 local=transpose(rot)*(p.xyz-center.xyz),n=vec3(0.);float depth=0.;
            if(center.w==1.){
                vec3 extent=size.xyz+vec3(thickness),pen=extent-abs(local);
                if(any(lessThanEqual(pen,vec3(0.))))continue;
                if(pen.x<=pen.y&&pen.x<=pen.z){n.x=local.x>=0.?1.:-1.;depth=pen.x;}
                else if(pen.y<=pen.z){n.y=local.y>=0.?1.:-1.;depth=pen.y;}
                else{n.z=local.z>=0.?1.:-1.;depth=pen.z;}
            }else{
                if(center.w==2.)local.y-=clamp(local.y,-size.y*.5,size.y*.5);
                float len=length(local),radius=size.x+thickness;
                if(len>=radius)continue;
                n=len>1e-10?local/len:vec3(1.,0.,0.);depth=radius-len;
            }
            n=rot*n;p.xyz+=n*depth;contact+=n;surface=at(colliderTex,ci+5).xyz;
        }
    }
    if(mode==5){
        vec3 delta=(at(targetTex,id).xyz-at(oldTargetTex,id).xyz)*targetFraction;
        v=p.w>0.?(p.xyz-old-delta)/h*exp(-30.*h):vec3(0.);
        if(any(isnan(p.xyz))||any(isinf(p.xyz))||any(isnan(v))||any(isinf(v))){
            p.xyz=mix(at(oldTargetTex,id).xyz,at(targetTex,id).xyz,alpha);v=vec3(0.);old=p.xyz;
        }
    }
    outPosition=p;outVelocity=vec4(v,0.);outPrevious=vec4(old,0.);
}`;

// 一个渲染顶点写一个像素，保留材质/UV拆点及原始硬边法线。
export const SCATTER_VERTEX = `precision highp float;
precision highp int;
precision highp sampler2D;
in float particleId;
in float particleActive;
in vec2 outputPixel;
in vec2 faceRange;
in vec3 sourceNormal;
uniform sampler2D posTex, normalFacesTex, restNormalsTex, morphNormalTex;
uniform vec2 outputSize;
out float finalActive;
out vec3 finalPosition;
out vec3 finalNormal;
vec4 at(sampler2D t,int id){ivec2 s=textureSize(t,0);return texelFetch(t,ivec2(id%s.x,id/s.x),0);}
vec3 rotateNormal(vec3 from,vec3 to,vec3 n){
    float w=dot(from,to)+1.;vec3 xyz;
    if(w<1e-6){ w=0.;xyz=abs(from.x)>abs(from.z)?vec3(-from.y,from.x,0.):vec3(0.,-from.z,from.y); }
    else xyz=cross(from,to);
    float len=length(vec4(xyz,w));if(len<1e-10)return n;
    xyz/=len;w/=len;return n+2.*cross(xyz,cross(xyz,n)+w*n);
}
void main(){
    finalActive=particleActive;
    finalPosition=at(posTex,int(particleId)).xyz;
    vec3 base=sourceNormal+texelFetch(morphNormalTex,ivec2(outputPixel),0).xyz;
    vec3 sum=vec3(0.);
    for(int k=0;k<int(faceRange.y);k++){
        int fi=int(faceRange.x)+k;ivec3 face=ivec3(at(normalFacesTex,fi).xyz);
        vec3 a=at(posTex,face.x).xyz,b=at(posTex,face.y).xyz,c=at(posTex,face.z).xyz;
        vec3 n=cross(b-a,c-a);float area=length(n);
        if(area>1e-9)sum+=rotateNormal(at(restNormalsTex,fi).xyz,n/area,base)*area;
    }
    finalNormal=length(sum)>1e-9?normalize(sum):normalize(base);
    gl_Position=vec4((outputPixel+.5)/outputSize*2.-1.,0.,1.);gl_PointSize=1.;
}`;
export const SCATTER_FRAGMENT = `precision highp float;
in float finalActive;
in vec3 finalPosition;
in vec3 finalNormal;
layout(location=0) out vec4 positionOut;
layout(location=1) out vec4 normalOut;
void main(){positionOut=vec4(finalPosition,finalActive);normalOut=vec4(finalNormal,finalActive);}`;
