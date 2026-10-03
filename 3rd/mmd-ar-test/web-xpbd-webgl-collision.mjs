import { common } from './web-xpbd-webgl-shaders.mjs';

// 解析球/胶囊距离、分段二次线段盒距离、OBB SAT及裁面接触。
// 每对最多8个接触（矩形与矩形裁剪的上界）；各接触有固定槽，不需要GPU原子分配。
const narrow = `
struct Shape { Body b;mat3 axes;vec3 start;vec3 end;vec3 lo;vec3 hi; };
struct Contact { vec3 a;vec3 b;vec3 n;bool valid; };
Shape shape(Body b){Shape s;s.b=b;s.axes=mat3(qr(b.q,vec3(1,0,0)),qr(b.q,vec3(0,1,0)),qr(b.q,vec3(0,0,1)));
 vec3 offset=b.shape==2?s.axes[1]*b.size.y*.5:vec3(0);s.start=b.p-offset;s.end=b.p+offset;
 vec3 extent=b.shape==1?abs(s.axes[0])*b.size.x+abs(s.axes[1])*b.size.y+abs(s.axes[2])*b.size.z:abs(offset)+vec3(b.size.x);
 s.lo=b.p-extent-vec3(b.tol);s.hi=b.p+extent+vec3(b.tol);return s;}
Contact emptyContact(){Contact c;c.a=vec3(0);c.b=vec3(0);c.n=vec3(0);c.valid=false;return c;}
Contact emitContact(vec3 a,vec3 b,vec3 n){Contact c;c.a=a;c.b=b;c.n=n;c.valid=true;return c;}
void segments(vec3 p0,vec3 p1,vec3 q0,vec3 q1,out vec3 p,out vec3 q){vec3 u=p1-p0,v=q1-q0,w=p0-q0;float aa=dot(u,u),bb=dot(v,v),uv=dot(u,v),uw=dot(u,w),vw=dot(v,w);
 float s=aa>1e-9?clamp(-uw/aa,0.0,1.0):0.0,t=0.0;
 if(bb>1e-9){float den=aa*bb-uv*uv;if(den>1e-9)s=clamp((uv*vw-uw*bb)/den,0.0,1.0);t=(uv*s+vw)/bb;
 if(t<0.0){t=0.0;s=aa>1e-9?clamp(-uw/aa,0.0,1.0):0.0;}if(t>1.0){t=1.0;s=aa>1e-9?clamp((uv-uw)/aa,0.0,1.0):0.0;}}
 p=p0+u*s;q=q0+v*t;}
Contact rounded(Shape a,Shape b,int slot){vec3 pa,pb;segments(a.start,a.end,b.start,b.end,pa,pb);float distance=length(pb-pa),radius=a.b.size.x+b.b.size.x,tol=min(a.b.tol,b.b.tol);
 if(distance>radius+tol)return emptyContact();vec3 n=distance>1e-9?(pb-pa)/distance:length(b.b.p-a.b.p)>1e-9?normalize(b.b.p-a.b.p):vec3(1,0,0);
 if(a.b.shape==2&&b.b.shape==2&&a.b.size.y>1e-9&&b.b.size.y>1e-9&&abs(dot(a.axes[1],b.axes[1]))>0.99995){
 vec3 dir=b.end-b.start;float t0=dot(b.start-a.start,a.axes[1]),t1=dot(b.end-a.start,a.axes[1]);float lo=max(0.0,min(t0,t1)),hi=min(a.b.size.y,max(t0,t1));
 if(hi-lo>max(1e-9,tol)&&abs(dot(n,a.axes[1]))<=.01){if(slot>1)return emptyContact();pa=a.start+a.axes[1]*(slot==0?lo:hi);pb=b.start+dir*clamp(dot(pa-b.start,dir)/dot(dir,dir),0.0,1.0);
 distance=length(pb-pa);if(distance>radius+tol)return emptyContact();if(distance>1e-9)n=(pb-pa)/distance;else{n-=a.axes[1]*dot(n,a.axes[1]);n=length(n)>1e-9?normalize(n):a.axes[0];}
 return emitContact(pa+n*a.b.size.x,pb-n*b.b.size.x,n);}}
 if(slot!=0)return emptyContact();return emitContact(pa+n*a.b.size.x,pb-n*b.b.size.x,n);}
void distanceSample(vec3 p,vec3 d,vec3 size,float t,inout float best,inout float bestT){vec3 v=p+t*d;vec3 error=v-clamp(v,-size,size);float ds=dot(error,error);if(ds<best){best=ds;bestT=t;}}
float segmentBox(Shape a,Shape b,out vec3 pa,out vec3 pb){vec3 p=transpose(b.axes)*(a.start-b.b.p),d=transpose(b.axes)*(a.end-a.start),size=b.b.size;
 float times[8];times[0]=0.0;times[1]=1.0;int count=2;
 for(int i=0;i<3;i++){if(abs(d[i])<1e-9)continue;for(int k=0;k<2;k++){float t=((k==0?-1.0:1.0)*size[i]-p[i])/d[i];if(t>0.0&&t<1.0){times[count]=t;count++;}}}
 for(int i=1;i<8;i++){if(i>=count)break;float t=times[i];int j=i;for(int k=0;k<8;k++){if(j<=0||times[j-1]<=t)break;times[j]=times[j-1];j--;}times[j]=t;}
 float best=1e30,bestT=0.0;for(int j=0;j<7;j++){if(j>=count-1)break;float mid=.5*(times[j]+times[j+1]),num=0.0,den=0.0;
 for(int i=0;i<3;i++){float v=p[i]+mid*d[i];if(abs(v)<=size[i])continue;num+=d[i]*(p[i]-sign(v)*size[i]);den+=d[i]*d[i];}
 distanceSample(p,d,size,times[j],best,bestT);distanceSample(p,d,size,times[j+1],best,bestT);if(den>1e-9)distanceSample(p,d,size,clamp(-num/den,times[j],times[j+1]),best,bestT);}
 pa=mix(a.start,a.end,bestT);pb=b.b.p+b.axes*clamp(p+bestT*d,-size,size);return sqrt(best);}
Contact roundedBox(Shape a,Shape b,int slot){vec3 pa,pb;float distance=segmentBox(a,b,pa,pb),radius=a.b.size.x,tol=min(a.b.tol,b.b.tol);if(distance>radius+tol)return emptyContact();vec3 n;
 if(distance>1e-9){n=(pb-pa)/distance;pa+=n*radius;}else{float best=1e30;int selected=0;float side=1.0;
 for(int i=0;i<3;i++){float center=dot(a.b.p-b.b.p,b.axes[i]);float extent=abs(dot(a.axes[1],b.axes[i]))*(a.b.shape==2?a.b.size.y*.5:0.0)+radius;
 float neg=center+extent+b.b.size[i],pos=b.b.size[i]-center+extent;if(neg<best){best=neg;selected=i;side=1.0;}if(pos<best){best=pos;selected=i;side=-1.0;}}
 n=b.axes[selected]*side;pa=(dot(a.start,n)>dot(a.end,n)?a.start:a.end)+n*radius;pb=pa-n*best;}
 // 胶囊平贴盒面时取轴段裁剪后的两端，避免单点支撑持续翻滚。
 if(a.b.shape==2&&a.b.size.y>1e-9&&abs(dot(a.axes[1],n))<=.01){int face=0;for(int i=1;i<3;i++)if(abs(dot(b.axes[i],n))>abs(dot(b.axes[face],n)))face=i;
 if(abs(dot(b.axes[face],n))>0.99999){vec3 dir=a.end-a.start;float lo=0.0,hi=1.0;bool valid=true;
 for(int i=0;i<3;i++){if(i==face)continue;float start=dot(a.start-b.b.p,b.axes[i]),change=dot(dir,b.axes[i]);if(abs(change)<=1e-9){if(abs(start)>b.b.size[i])valid=false;continue;}
 float x=(-b.b.size[i]-start)/change,y=(b.b.size[i]-start)/change;lo=max(lo,min(x,y));hi=min(hi,max(x,y));}
 if(valid&&(hi-lo)*a.b.size.y>max(1e-9,tol)){if(slot>1)return emptyContact();pa=mix(a.start,a.end,slot==0?lo:hi)+n*radius;float separation=dot(n,b.b.p)-b.b.size[face]-dot(pa,n);if(separation>tol)return emptyContact();return emitContact(pa,pa+n*separation,n);}}}
 if(slot!=0)return emptyContact();return emitContact(pa,pb,n);}
float projection(Shape a,vec3 n){return dot(a.b.size,abs(transpose(a.axes)*n));}
void edge(Shape a,int index,vec3 n,out vec3 lo,out vec3 hi){vec3 center=a.b.p;for(int i=0;i<3;i++)if(i!=index)center+=a.axes[i]*(dot(a.axes[i],n)<0.0?-1.0:1.0)*a.b.size[i];lo=center-a.axes[index]*a.b.size[index];hi=center+a.axes[index]*a.b.size[index];}
Contact boxes(Shape a,Shape b,int slot){vec3 normal=vec3(0);float best=1e30;int ref=0,ai=0,bi=0;float tol=min(a.b.tol,b.b.tol);
 for(int k=0;k<15;k++){vec3 n=k<3?a.axes[k]:k<6?b.axes[k-3]:cross(a.axes[(k-6)/3],b.axes[(k-6)%3]);float len=length(n);if(len<1e-7)continue;n/=len;
 float distance=dot(b.b.p-a.b.p,n),depth=projection(a,n)+projection(b,n)-abs(distance);if(depth<-tol)return emptyContact();
 if(depth<best){best=depth;normal=n*(distance<0.0?-1.0:1.0);ref=k<3?0:k<6?1:2;ai=k<3?k:(k-6)/3;bi=k<6?k-3:(k-6)%3;}}
 if(ref==2){if(slot>0)return emptyContact();vec3 a0,a1,b0,b1,pa,pb;edge(a,ai,normal,a0,a1);edge(b,bi,-normal,b0,b1);segments(a0,a1,b0,b1,pa,pb);return emitContact(pa,pb,normal);}
 Shape r=a,inc=b;if(ref!=0){r=b;inc=a;}int ri=ref==0?ai:bi;vec3 fn=normal*(ref==0?1.0:-1.0);int ii=0;
 for(int i=1;i<3;i++)if(abs(dot(inc.axes[i],fn))>abs(dot(inc.axes[ii],fn)))ii=i;
 vec3 center=inc.b.p+inc.axes[ii]*(dot(inc.axes[ii],fn)>0.0?-1.0:1.0)*inc.b.size[ii];int u=(ii+1)%3,v=(ii+2)%3;
 vec3 poly[12],clipped[12];for(int i=0;i<4;i++)poly[i]=center+inc.axes[u]*(i==0||i==3?-1.0:1.0)*inc.b.size[u]+inc.axes[v]*(i<2?-1.0:1.0)*inc.b.size[v];int count=4;
 for(int i=0;i<3;i++){if(i==ri)continue;for(int k=0;k<2;k++){vec3 n=r.axes[i]*(k==0?-1.0:1.0);float limit=dot(n,r.b.p)+r.b.size[i];int nextCount=0;
 for(int j=0;j<12;j++){if(j>=count)break;vec3 first=poly[j],second=poly[(j+1)%count];float d0=dot(n,first)-limit,d1=dot(n,second)-limit;
 if(d0<=0.0)clipped[nextCount++]=first;if((d0<0.0&&d1>0.0)||(d0>0.0&&d1<0.0))clipped[nextCount++]=mix(first,second,d0/(d0-d1));}
 count=nextCount;for(int j=0;j<12;j++){if(j>=count)break;poly[j]=clipped[j];}}}
 if(slot>=count)return emptyContact();vec3 p=poly[slot];float sep=dot(fn,p)-dot(fn,r.b.p)-r.b.size[ri];if(sep>tol)return emptyContact();vec3 projected=p-fn*sep;
 if(ref==0)return emitContact(projected,p,normal);return emitContact(p,projected,normal);}
Contact detect(Body a,Body b,int slot){Shape x=shape(a),y=shape(b);if(any(greaterThan(x.lo,y.hi))||any(greaterThan(y.lo,x.hi)))return emptyContact();
 if(a.shape==1&&b.shape==1)return boxes(x,y,slot);if(a.shape!=1&&b.shape!=1)return rounded(x,y,slot);
 if(a.shape!=1)return roundedBox(x,y,slot);Contact c=roundedBox(y,x,slot);vec3 p=c.a;c.a=c.b;c.b=p;c.n=-c.n;return c;}
`;
export const contactShader = common + narrow + `
void main(){int idx=pixelIndex(),ci=idx/3,slot=ci%8,pair=ci/8,f=idx%3;if(pair>=uPairCount){outputValue=vec4(0);return;}
 vec2 ids=fetchData(uPairs,pair).xy;Body a=body(int(ids.x)),b=body(int(ids.y));Contact c=detect(a,b,slot);if(!c.valid){outputValue=vec4(0);return;}
 vec3 va=a.v+cross(a.w,c.a-a.p),vb=b.v+cross(b.w,c.b-b.p);
 outputValue=f==0?vec4(qr(qi(a.q),c.a-a.p),1):f==1?vec4(qr(qi(b.q),c.b-b.p),dot(vb-va,c.n)):vec4(c.n,0);
}`;
// 接触对各自顺序求自身的支撑点；跨对采用Jacobi汇总，避免多个片段覆盖同一个刚体。
export const contactSolve = common + `
uniform sampler2D uPreviousCorrections;
void main(){int idx=pixelIndex(),pair=idx/7,f=idx%7;if(pair>=uPairCount){outputValue=vec4(0);return;}
 vec2 ids=fetchData(uPairs,pair).xy;Body a=body(int(ids.x)),b=body(int(ids.y));Body initialA=a,initialB=b;float lambdas[8];float hasContact=0.0;
 for(int i=0;i<8;i++){lambdas[i]=0.0;vec4 ca=fetchData(uContacts,(pair*8+i)*3);if(ca.w<.5)continue;hasContact=1.0;
 vec4 cb=fetchData(uContacts,(pair*8+i)*3+1);vec3 n=fetchData(uContacts,(pair*8+i)*3+2).xyz;
 vec3 pa=point(a,ca.xyz),pb=point(b,cb.xyz),ga=-cross(pa-a.p,n),gb=cross(pb-b.p,n);float tol=min(a.tol,b.tol);
 float friction=.5*(clamp(a.props.z,0.0,10.0)+clamp(b.props.z,0.0,10.0));
 if(uMode==0){float error=dot(pb-pa,n)+tol;float lambda=error<=-1e-6?correct(a,b,n,ga,gb,error,0.0,0.0):0.0;lambdas[i]=lambda;
 if(lambda>0.0&&friction>0.0){pa=point(a,ca.xyz);pb=point(b,cb.xyz);vec3 tangent=(pb-(b.pp+qr(b.pq,cb.xyz)))-(pa-(a.pp+qr(a.pq,ca.xyz)));tangent-=n*dot(tangent,n);float len=length(tangent);
 if(len>1e-6){tangent/=len;ga=-cross(pa-a.p,tangent);gb=cross(pb-b.p,tangent);vec3 ia=inertia(a,ga),ib=inertia(b,gb);float weight=a.im+b.im+dot(ga,ia)+dot(gb,ib);
 if(weight>EPS&&len/weight<friction*lambda)movePair(a,b,tangent,ia,ib,-len/weight);}}
 }else{
 float lambda=fetchData(uPreviousCorrections,pair*7+4+i/4)[i%4];lambdas[i]=lambda;
 vec3 rel=b.v+cross(b.w,pb-b.p)-a.v-cross(a.w,pa-a.p);float vn=dot(rel,n),sep=dot(pb-pa,n);
 float threshold=max(max(.5,2.0*length(uGravity)*uH),tol/uH);float restitution=abs(cb.w)>threshold?.5*(clamp(a.props.w,0.0,1.0)+clamp(b.props.w,0.0,1.0)):0.0;
 float target=sep<=0.0?max(-cb.w*restitution,0.0):sep/uH;vec3 tangent=rel-n*vn;float speed=length(tangent);vec3 change=n*(target-vn);
 if(speed>1e-6)change-=tangent*min(friction*lambda/uH,speed)/speed;float len=length(change);
 if(len>1e-6){change/=len;ga=-cross(pa-a.p,change);gb=cross(pb-b.p,change);impulse(a,b,change,ga,gb,len);}
 }}
 if(f==4||f==5){int k=(f-4)*4;outputValue=vec4(lambdas[k],lambdas[k+1],lambdas[k+2],lambdas[k+3]);return;}
 if(f==6){outputValue=vec4(hasContact,0,0,0);return;}
 if(uMode!=0){outputValue=vec4(f==0?a.v-initialA.v:f==1?a.w-initialA.w:f==2?b.v-initialB.v:b.w-initialB.w,hasContact);return;}
 vec4 da=qm(a.q,qi(initialA.q)),db=qm(b.q,qi(initialB.q));if(da.w<0.0)da=-da;if(db.w<0.0)db=-db;
 outputValue=vec4(f==0?a.p-initialA.p:f==1?2.0*da.xyz:f==2?b.p-initialB.p:2.0*db.xyz,hasContact);
}`;
export const contactGather = common + `
uniform sampler2D uCorrections;
void main(){int idx=pixelIndex(),id=idx/6,f=idx%6;if(id>=uCount){outputValue=vec4(0);return;}Body b=body(id);vec4 range=fetchData(uRanges,id);vec3 dp=vec3(0),dr=vec3(0);float weight=0.0;
 for(int i=0;i<int(range.y);i++){int pair=int(fetchData(uAdj,int(range.x)+i).x);vec2 ids=fetchData(uPairs,pair).xy;int offset=int(ids.x)==id?0:2;
 vec4 delta=fetchData(uCorrections,pair*7+offset);if(delta.w<.5)continue;dp+=delta.xyz;dr+=fetchData(uCorrections,pair*7+offset+1).xyz;weight+=1.0;}
 if(b.immovable<.5&&weight>0.0){float relaxation=1.0/weight;if(uMode==0){b.p+=dp*relaxation;b.q=rotated(b.q,dr,relaxation);}else{b.v+=dp*relaxation;b.w+=dr*relaxation;}}
 outputValue=field(b,f);
}`;
