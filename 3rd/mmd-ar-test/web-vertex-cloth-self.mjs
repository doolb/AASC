import { read, vertexTriangleContact, edgeEdgeContact } from './web-vertex-cloth-contact.mjs';

// CPU使用与GPU逐粒子收集等价的Jacobi累积；接触两侧均按逆质量分配纠正。
export class ClothSelfCollision {
    constructor(group,thickness){
        this.group=group;this.thickness=thickness;this.delta=new Float32Array(group.rest.length);
        this.count=new Uint32Array(group.pins.length);this.contacts=0;
    }
    excluded(a,b){return this.group.neighbors[a].has(b);}
    add(contact){
        if(!contact)return;
        const {ids,coefficients,normal,depth}=contact,w=this.group.inverseMass;
        let denominator=0;for(let k=0;k<4;k++)denominator+=w[ids[k]]*coefficients[k]*coefficients[k];
        if(denominator<1e-12)return;this.contacts++;
        for(let k=0;k<4;k++){
            const id=ids[k];if(!w[id]||Math.abs(coefficients[k])<1e-8)continue;
            const scale=depth*coefficients[k]*w[id]/denominator;
            for(let axis=0;axis<3;axis++)this.delta[id*3+axis]+=normal[axis]*scale;
            this.count[id]++;
        }
    }
    solve(p,previous){
        const g=this.group,bvh=g.bvh,t=this.thickness;
        bvh.refit(p,previous);this.delta.fill(0);this.count.fill(0);this.contacts=0;
        for(let id=0;id<g.pins.length;id++){
            const point=read(p,id),old=read(previous,id);
            const lo=point.map((v,a)=>Math.min(v,old[a])-t),hi=point.map((v,a)=>Math.max(v,old[a])+t);
            bvh.query(bvh.roots[1],lo,hi,(_,face)=>{
                if(face.slice(0,3).some(v=>this.excluded(id,v)))return;
                this.add(vertexTriangleContact([id,...face.slice(0,3)],p,previous,g.rest,t));
            });
        }
        const edgeStart=g.pins.length+g.triangles.length/3;
        for(let e=0;e<g.stretch.pairs.length;e+=2){
            const a=g.stretch.pairs[e],b=g.stretch.pairs[e+1],ids=[a,b],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
            for(const id of ids)for(let axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis],p[id*3+axis],previous[id*3+axis]);hi[axis]=Math.max(hi[axis],p[id*3+axis],previous[id*3+axis]);}
            bvh.query(bvh.roots[2],lo.map(v=>v-t),hi.map(v=>v+t),(primitive,edge)=>{
                if(primitive<=edgeStart+e/2||ids.some(id=>this.excluded(id,edge[0])||this.excluded(id,edge[1])))return;
                this.add(edgeEdgeContact([a,b,edge[0],edge[1]],p,g.rest,t));
            });
        }
        for(let id=0;id<this.count.length;id++)if(this.count[id]){
            const scale=0.8/this.count[id],length=Math.hypot(this.delta[id*3],this.delta[id*3+1],this.delta[id*3+2])*scale;
            const bounded=scale*Math.min(1,2*t/Math.max(1e-12,length));
            for(let axis=0;axis<3;axis++)p[id*3+axis]+=this.delta[id*3+axis]*bounded;
        }
    }
    attach(p,targets,oldTargets,alpha){
        this.delta.fill(0);this.count.fill(0);const w=this.group.inverseMass;
        for(const {ids,coefficients} of this.group.attachments){
            let denominator=0;const error=[0,0,0];
            for(let k=0;k<4;k++){
                const id=ids[k],c=coefficients[k];denominator+=w[id]*c*c;
                for(let axis=0;axis<3;axis++){const i=id*3+axis,target=oldTargets[i]+(targets[i]-oldTargets[i])*alpha;error[axis]+=(p[i]-target)*c;}
            }
            if(denominator<1e-12)continue;
            for(let k=0;k<4;k++){
                const id=ids[k],c=coefficients[k];if(!w[id]||Math.abs(c)<1e-8)continue;
                for(let axis=0;axis<3;axis++)this.delta[id*3+axis]-=error[axis]*c*w[id]/denominator;
                this.count[id]++;
            }
        }
        for(let id=0;id<this.count.length;id++)if(this.count[id])for(let axis=0;axis<3;axis++)p[id*3+axis]+=this.delta[id*3+axis]/this.count[id];
    }
}
