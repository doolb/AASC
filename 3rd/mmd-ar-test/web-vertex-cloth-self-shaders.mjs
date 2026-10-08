export const FETCH = `precision highp float;
precision highp int;
precision highp sampler2D;
vec4 at(sampler2D t,int id){ivec2 size=textureSize(t,0);return texelFetch(t,ivec2(id%size.x,id/size.x),0);}
`;
export const REFIT_FRAGMENT = `${FETCH}
uniform sampler2D posTex,prevTex,nodeTex,primitiveTex,minTex,maxTex;
uniform int nodeCount,level;
layout(location=0) out vec4 minimum;
layout(location=1) out vec4 maximum;
void main(){
    ivec2 pixel=ivec2(gl_FragCoord.xy);int id=pixel.y*textureSize(minTex,0).x+pixel.x;
    minimum=at(minTex,id);maximum=at(maxTex,id);if(id>=nodeCount)return;
    ivec4 node=ivec4(at(nodeTex,id));
    if(node.w>=0){
        ivec4 primitive=ivec4(at(primitiveTex,node.w));vec3 lo=vec3(1e30),hi=vec3(-1e30);
        for(int k=0;k<3;k++)if(primitive[k]>=0){vec3 p=at(posTex,primitive[k]).xyz,q=at(prevTex,primitive[k]).xyz;lo=min(lo,min(p,q));hi=max(hi,max(p,q));}
        minimum.xyz=lo;maximum.xyz=hi;
    }else if(int(minimum.w)==level){minimum.xyz=min(at(minTex,node.x).xyz,at(minTex,node.y).xyz);maximum.xyz=max(at(maxTex,node.x).xyz,at(maxTex,node.y).xyz);}
}`;
export const GEOMETRY = `
vec3 barycentric(vec3 p,vec3 a,vec3 b,vec3 c){
    vec3 ab=b-a,ac=c-a,ap=p-a;float d1=dot(ab,ap),d2=dot(ac,ap);
    if(d1<=0.&&d2<=0.)return vec3(1.,0.,0.);
    vec3 bp=p-b;float d3=dot(ab,bp),d4=dot(ac,bp);
    if(d3>=0.&&d4<=d3)return vec3(0.,1.,0.);
    float vc=d1*d4-d3*d2;
    if(vc<=0.&&d1>=0.&&d3<=0.){float v=d1/(d1-d3);return vec3(1.-v,v,0.);}
    vec3 cp=p-c;float d5=dot(ab,cp),d6=dot(ac,cp);
    if(d6>=0.&&d5<=d6)return vec3(0.,0.,1.);
    float vb=d5*d2-d1*d6;
    if(vb<=0.&&d2>=0.&&d6<=0.){float w=d2/(d2-d6);return vec3(1.-w,0.,w);}
    float va=d3*d6-d5*d4;
    if(va<=0.&&d4-d3>=0.&&d5-d6>=0.){float w=(d4-d3)/(d4-d3+d5-d6);return vec3(0.,1.-w,w);}
    float den=va+vb+vc;if(abs(den)<1e-20)return vec3(1.,0.,0.);
    float v=vb/den,w=vc/den;return vec3(1.-v-w,v,w);
}
vec2 segmentParameters(vec3 a,vec3 b,vec3 c,vec3 d){
    vec3 u=b-a,v=d-c,r=a-c;float aa=dot(u,u),ee=dot(v,v),f=dot(v,r),s=0.,t=0.;
    if(aa<1e-20&&ee<1e-20)return vec2(0.);
    if(aa<1e-20)t=clamp(f/ee,0.,1.);
    else{float cc=dot(u,r);
        if(ee<1e-20)s=clamp(-cc/aa,0.,1.);
        else{float bb=dot(u,v),den=aa*ee-bb*bb;
            s=den>1e-20?clamp((bb*f-cc*ee)/den,0.,1.):0.;t=(bb*s+f)/ee;
            if(t<0.){t=0.;s=clamp(-cc/aa,0.,1.);}else if(t>1.){t=1.;s=clamp((bb-cc)/aa,0.,1.);}
        }
    }return vec2(s,t);
}
`;
export const CONTACT_FRAGMENT = `${FETCH}
${GEOMETRY}
uniform sampler2D posTex,velTex,prevTex,restTex,nodeTex,primitiveTex,minTex,maxTex;
uniform sampler2D adjacencyTex,adjacencyIdsTex,excludeTex,excludeIdsTex;
uniform ivec3 roots;
uniform int particleCount;
uniform float thickness;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outVelocity;
layout(location=2) out vec4 outPrevious;
vec3 correction;float contacts;
bool linked(int a,int b){
    ivec2 range=ivec2(at(excludeTex,a).xy);
    for(int i=0;i<range.y;i++)if(int(at(excludeIdsTex,range.x+i).x)==b)return true;
    return false;
}
void addContact(ivec4 ids,vec4 coefficients,vec3 normal,float depth,int owner){
    vec4 weights=vec4(at(posTex,ids.x).w,at(posTex,ids.y).w,at(posTex,ids.z).w,at(posTex,ids.w).w);
    float denominator=dot(weights,coefficients*coefficients);if(denominator<1e-12)return;
    for(int k=0;k<4;k++)if(ids[k]==owner && weights[k]>0. && abs(coefficients[k])>=1e-8){
        correction+=normal*(depth*coefficients[k]*weights[k]/denominator);contacts+=1.;
    }
}
void vertexFace(ivec4 ids,int owner){
    if(linked(ids.x,ids.y)||linked(ids.x,ids.z)||linked(ids.x,ids.w))return;
    vec3 rp=at(restTex,ids.x).xyz,ra=at(restTex,ids.y).xyz,rb=at(restTex,ids.z).xyz,rc=at(restTex,ids.w).xyz;
    vec3 rw=barycentric(rp,ra,rb,rc);float restGap=length(rp-(ra*rw.x+rb*rw.y+rc*rw.z));if(restGap<1e-7)return;
    vec3 p=at(posTex,ids.x).xyz,a=at(posTex,ids.y).xyz,b=at(posTex,ids.z).xyz,c=at(posTex,ids.w).xyz;
    vec3 bary=barycentric(p,a,b,c),difference=p-(a*bary.x+b*bary.y+c*bary.z),n=cross(b-a,c-a);
    float area=length(n);if(area<1e-12)return;
    vec3 op=at(prevTex,ids.x).xyz,oa=at(prevTex,ids.y).xyz,ob=at(prevTex,ids.z).xyz,oc=at(prevTex,ids.w).xyz;
    float side=dot(op-oa,cross(ob-oa,oc-oa))>=0.?1.:-1.;
    float distance=length(difference),gap=min(thickness,restGap*.5),signedDistance=dot(difference,n)/area*side;
    bool crossed=signedDistance<0.&&min(bary.x,min(bary.y,bary.z))>1e-6;
    if(!crossed&&distance>=gap)return;
    vec3 normal=crossed||distance<1e-9?n/area*side:difference/distance;
    addContact(ids,vec4(1.,-bary),normal,crossed?gap-signedDistance:gap-distance,owner);
}
void edgePair(ivec4 ids,int owner){
    if(linked(ids.x,ids.z)||linked(ids.x,ids.w)||linked(ids.y,ids.z)||linked(ids.y,ids.w))return;
    vec3 ra=at(restTex,ids.x).xyz,rb=at(restTex,ids.y).xyz,rc=at(restTex,ids.z).xyz,rd=at(restTex,ids.w).xyz;
    vec2 rt=segmentParameters(ra,rb,rc,rd);float restGap=length(mix(ra,rb,rt.x)-mix(rc,rd,rt.y));if(restGap<1e-7)return;
    vec3 a=at(posTex,ids.x).xyz,b=at(posTex,ids.y).xyz,c=at(posTex,ids.z).xyz,d=at(posTex,ids.w).xyz;
    vec2 st=segmentParameters(a,b,c,d);vec3 difference=mix(a,b,st.x)-mix(c,d,st.y);
    float distance=length(difference),gap=min(thickness,restGap*.5);if(distance>=gap)return;
    vec3 normal=distance<1e-9?cross(b-a,d-c):difference;float size=length(normal);if(size<1e-9)return;
    addContact(ids,vec4(1.-st.x,st.x,-(1.-st.y),-st.y),normal/size,gap-distance,owner);
}
void visitTree(int root,vec3 lo,vec3 hi,int queryKind,int queryId,int owner){
    if(root<0)return;int cursor=root,end=int(at(nodeTex,root).z);
    while(cursor<end){
        ivec4 node=ivec4(at(nodeTex,cursor));
        if(any(lessThan(at(maxTex,cursor).xyz,lo))||any(greaterThan(at(minTex,cursor).xyz,hi))){cursor=node.z;continue;}
        if(node.w<0){cursor=node.x;continue;}
        ivec4 primitive=ivec4(at(primitiveTex,node.w));
        if(queryKind==0)vertexFace(ivec4(queryId,primitive.xyz),owner);
        if(queryKind==1){ivec3 face=ivec3(at(primitiveTex,queryId).xyz);vertexFace(ivec4(primitive.x,face),owner);}
        if(queryKind==2 && node.w!=queryId){
            ivec2 edge=ivec2(at(primitiveTex,queryId).xy);
            edgePair(queryId<node.w?ivec4(edge,primitive.xy):ivec4(primitive.xy,edge),owner);
        }
        cursor=node.z;
    }
}
void primitiveBounds(ivec3 ids,out vec3 lo,out vec3 hi){
    lo=vec3(1e30);hi=vec3(-1e30);
    for(int k=0;k<3;k++)if(ids[k]>=0){vec3 p=at(posTex,ids[k]).xyz,q=at(prevTex,ids[k]).xyz;lo=min(lo,min(p,q));hi=max(hi,max(p,q));}
    lo-=vec3(thickness);hi+=vec3(thickness);
}
void main(){
    ivec2 pixel=ivec2(gl_FragCoord.xy);int id=pixel.y*textureSize(posTex,0).x+pixel.x;
    outPosition=at(posTex,id);outVelocity=at(velTex,id);outPrevious=at(prevTex,id);
    if(id>=particleCount||outPosition.w==0.)return;
    correction=vec3(0.);contacts=0.;vec3 lo,hi;
    primitiveBounds(ivec3(id,-1,-1),lo,hi);visitTree(roots.y,lo,hi,0,id,id);
    ivec4 range=ivec4(at(adjacencyTex,id));
    for(int k=0;k<range.y;k++){
        int primitive=int(at(adjacencyIdsTex,range.x+k).x);ivec3 face=ivec3(at(primitiveTex,primitive).xyz);
        primitiveBounds(face,lo,hi);visitTree(roots.x,lo,hi,1,primitive,id);
    }
    for(int k=0;k<range.w;k++){
        int primitive=int(at(adjacencyIdsTex,range.z+k).x);ivec3 edge=ivec3(at(primitiveTex,primitive).xyz);
        primitiveBounds(edge,lo,hi);visitTree(roots.z,lo,hi,2,primitive,id);
    }
    if(contacts>0.){
        vec3 shift=.8*correction/contacts;
        outPosition.xyz+=shift*min(1.,2.*thickness/max(1e-12,length(shift)));
    }
}`;
export const ATTACH_FRAGMENT = `${FETCH}
uniform sampler2D posTex,velTex,prevTex,targetTex,oldTargetTex,rangeTex,listTex,idsTex,coefficientsTex;
uniform int particleCount;
uniform float alpha;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outVelocity;
layout(location=2) out vec4 outPrevious;
void main(){
    ivec2 pixel=ivec2(gl_FragCoord.xy);int id=pixel.y*textureSize(posTex,0).x+pixel.x;
    outPosition=at(posTex,id);outVelocity=at(velTex,id);outPrevious=at(prevTex,id);
    if(id>=particleCount||outPosition.w==0.)return;
    ivec2 range=ivec2(at(rangeTex,id).xy);vec3 sum=vec3(0.);float count=0.;
    for(int i=0;i<range.y;i++){
        int index=int(at(listTex,range.x+i).x);ivec4 ids=ivec4(at(idsTex,index));vec4 coefficients=at(coefficientsTex,index);
        vec3 error=vec3(0.);float denominator=0.,coefficient=0.;
        for(int k=0;k<4;k++){
            vec4 p=at(posTex,ids[k]);vec3 target=mix(at(oldTargetTex,ids[k]).xyz,at(targetTex,ids[k]).xyz,alpha);
            error+=(p.xyz-target)*coefficients[k];denominator+=p.w*coefficients[k]*coefficients[k];
            if(ids[k]==id)coefficient=coefficients[k];
        }
        if(denominator<1e-12||abs(coefficient)<1e-8)continue;
        sum-=error*coefficient*outPosition.w/denominator;count+=1.;
    }
    if(count>0.)outPosition.xyz+=sum/count;
}`;
