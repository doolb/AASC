// GLSL共用声明：PMX坐标和CPU后端一致。每个输出像素只有一个写入者，所有读取来自上一张贴图。
export const common = `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uState, uMeta, uTargets, uJoints, uResult, uPairs, uContacts, uAdj, uRanges, uMap;
uniform int uCount, uJointCount, uPairCount, uColor, uMode, uWidth;
uniform float uH, uAlpha;
uniform vec3 uGravity, uWindDirection;
uniform vec3 uWind; // 平均强度、模拟中点时刻、阵风比例
uniform mat4 uWindMatrix;
out vec4 outputValue;
const float EPS=1e-10;
vec4 fetchData(sampler2D t,int index) { ivec2 d=textureSize(t,0);return texelFetch(t,ivec2(index%d.x,index/d.x),0); }
int pixelIndex(){return int(gl_FragCoord.x)+int(gl_FragCoord.y)*uWidth;}
vec4 qi(vec4 q){return vec4(-q.xyz,q.w);}
vec4 qm(vec4 a,vec4 b){return vec4(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
vec3 qr(vec4 q,vec3 v){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
vec4 qs(vec4 a,vec4 b,float t){float d=dot(a,b);if(d<0.0){b=-b;d=-d;}
 if(d>0.9995)return normalize(mix(a,b,t));float angle=acos(clamp(d,-1.0,1.0));return (sin((1.0-t)*angle)*a+sin(t*angle)*b)/sin(angle);}
vec4 rotated(vec4 q,vec3 v,float scale){float len=length(v)*abs(scale);if(len<EPS)return q;
 return normalize(q+0.5*qm(vec4(v*scale*min(1.0,0.5/len),0.0),q));}
vec3 eulerXYZ(vec4 q){float m13=2.0*(q.x*q.z+q.w*q.y);float y=asin(clamp(m13,-1.0,1.0));
 if(abs(m13)<0.9999999)return vec3(atan(2.0*(q.w*q.x-q.y*q.z),1.0-2.0*(q.x*q.x+q.y*q.y)),y,atan(2.0*(q.w*q.z-q.x*q.y),1.0-2.0*(q.y*q.y+q.z*q.z)));
 return vec3(atan(2.0*(q.y*q.z+q.w*q.x),1.0-2.0*(q.x*q.x+q.z*q.z)),y,0.0);}
struct Body { int id;vec3 p;vec4 q;vec3 v;vec3 w;vec3 pp;vec4 pq;float im;vec3 ii;float immovable;float driven;int shape;vec3 size;float mass;vec4 props;float tol; };
Body body(int id){Body b;b.id=id;b.p=fetchData(uState,id*6).xyz;b.q=fetchData(uState,id*6+1);
 b.v=fetchData(uState,id*6+2).xyz;b.w=fetchData(uState,id*6+3).xyz;b.pp=fetchData(uState,id*6+4).xyz;b.pq=fetchData(uState,id*6+5);
 vec4 m=fetchData(uMeta,id*7),i=fetchData(uMeta,id*7+1),s=fetchData(uMeta,id*7+2);
 b.im=m.x;b.immovable=m.y;b.driven=m.z;b.shape=int(m.w);b.ii=i.xyz;b.tol=i.w;b.size=s.xyz;b.mass=s.w;b.props=fetchData(uMeta,id*7+3);return b;}
vec4 field(Body b,int f){if(f==0)return vec4(b.p,0);if(f==1)return b.q;if(f==2)return vec4(b.v,0);if(f==3)return vec4(b.w,0);if(f==4)return vec4(b.pp,0);return b.pq;}
vec3 inertia(Body b,vec3 v){return qr(b.q,qr(qi(b.q),v)*b.ii);}
vec3 point(Body b,vec3 p){return b.p+qr(b.q,p);}
void velocities(inout Body b){b.v=(b.p-b.pp)/uH;vec4 d=qm(b.q,qi(b.pq));if(d.w<0.0)d=-d;b.w=d.xyz*(2.0/uH);}
void movePair(inout Body a,inout Body b,vec3 n,vec3 ia,vec3 ib,float dl){a.p-=n*a.im*dl;b.p+=n*b.im*dl;a.q=rotated(a.q,ia,dl);b.q=rotated(b.q,ib,dl);}
float correct(inout Body a,inout Body b,vec3 n,vec3 ga,vec3 gb,float error,float compliance,float lambda){
 vec3 ia=inertia(a,ga),ib=inertia(b,gb);float weight=dot(n,n)*(a.im+b.im)+dot(ga,ia)+dot(gb,ib);
 if(weight<EPS)return 0.0;float alpha=compliance/(uH*uH),dl=(-error-alpha*lambda)/(weight+alpha);movePair(a,b,n,ia,ib,dl);return dl;}
void impulse(inout Body a,inout Body b,vec3 n,vec3 ga,vec3 gb,float change){vec3 ia=inertia(a,ga),ib=inertia(b,gb);
 float weight=dot(n,n)*(a.im+b.im)+dot(ga,ia)+dot(gb,ib);if(weight<EPS)return;float dl=change/weight;
 a.v-=n*a.im*dl;b.v+=n*b.im*dl;a.w+=ia*dl;b.w+=ib*dl;}
vec3 axis(int i){vec3 n=vec3(0);n[i]=1.0;return n;}
`;
export const integrate = common + `
void main(){int idx=pixelIndex(),id=idx/6,f=idx%6;if(id>=uCount){outputValue=vec4(0);return;}Body b=body(id);b.pp=b.p;b.pq=b.q;
 if(b.immovable<0.5){
 vec3 force=vec3(0),torque=vec3(0);
 if(uWind.x>0.0){vec3 wp=(uWindMatrix*vec4(b.p,1)).xyz;float phase=dot(wp,vec3(.19,.11,.23));
 float strength=max(0.0,uWind.x*(1.0+uWind.z*(.65*sin(6.2831853*.4*uWind.y+phase)+.35*sin(6.2831853*.73*uWind.y+1.37*phase))));
 vec3 r=b.driven>.5?qr(b.q,fetchData(uMeta,id*7+4).xyz):vec3(0);vec3 rel=sqrt(20.0*strength)*uWindDirection-b.v-cross(b.w,r);float speed=length(rel);
 if(speed>1e-12){vec3 n=qr(qi(b.q),rel/speed);float area=3.14159265*b.size.x*b.size.x;
 if(b.shape==1)area=4.0*dot(abs(n),vec3(b.size.y*b.size.z,b.size.x*b.size.z,b.size.x*b.size.y));
 if(b.shape==2)area+=2.0*b.size.x*b.size.y*sqrt(max(0.0,1.0-n.y*n.y));
 float mobility=1.0/max(b.mass,1e-30);if(b.driven>.5){vec3 lr=qr(qi(b.q),r);mobility=dot(vec3(lr.y*lr.y+lr.z*lr.z,lr.x*lr.x+lr.z*lr.z,lr.x*lr.x+lr.y*lr.y),b.ii);}
 float drag=.5*area*speed;force=rel*drag/(1.0+uH*mobility*drag);
 if(b.driven>.5){vec3 local=qr(qi(b.q),cross(r,force));vec3 limits=vec3(b.ii.x>0.0?12.0/b.ii.x:0.0,b.ii.y>0.0?12.0/b.ii.y:0.0,b.ii.z>0.0?12.0/b.ii.z:0.0);torque=qr(b.q,clamp(local,-limits,limits));}}
 }
 b.v*=pow(1.0-clamp(b.props.x,0.0,1.0),uH);b.w*=pow(1.0-clamp(b.props.y,0.0,1.0),uH);
 if(b.im>0.0)b.v+=(uGravity+force*b.im)*uH;b.w+=inertia(b,torque)*uH;
 if(b.driven<.5)b.p+=b.v*uH;b.q=rotated(b.q,b.w,uH);
 }
 vec4 meta=fetchData(uMeta,id*7+4);
 if(meta.w>.5||b.driven>.5){b.p=mix(fetchData(uTargets,id*4).xyz,fetchData(uTargets,id*4+2).xyz,uAlpha);b.v=(b.p-b.pp)/uH;
 if(meta.w>.5){b.q=qs(fetchData(uTargets,id*4+1),fetchData(uTargets,id*4+3),uAlpha);vec4 d=normalize(qm(b.q,qi(b.pq)));if(d.w<0.0)d=-d;float len=length(d.xyz);b.w=len>1e-10?d.xyz*2.0*atan(len,d.w)/(len*uH):vec3(0);}}
 outputValue=field(b,f);
}`;
export const bindings = common + `void main(){int idx=pixelIndex(),id=idx/6,f=idx%6;if(id>=uCount){outputValue=vec4(0);return;}Body b=body(id);vec4 binding=fetchData(uMeta,id*7+5);
 if(binding.w>0.0){Body a=body(int(binding.w)-1);b.q=normalize(qm(a.q,fetchData(uMeta,id*7+6)));b.p=point(a,binding.xyz);velocities(b);}outputValue=field(b,f);}`;
export const recoverVelocity = common + `void main(){int idx=pixelIndex(),id=idx/6,f=idx%6;if(id>=uCount){outputValue=vec4(0);return;}Body b=body(id);if(b.immovable<.5)velocities(b);outputValue=field(b,f);}`;
export const copy = common + `void main(){int i=pixelIndex();outputValue=fetchData(uState,i);}`;
