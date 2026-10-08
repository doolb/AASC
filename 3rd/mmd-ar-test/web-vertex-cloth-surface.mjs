import { ClothBvh } from './web-vertex-cloth-bvh.mjs';
import { closestTriangle, interpolate, read, sub } from './web-vertex-cloth-contact.mjs';

// 聚合整个模型的候选表面，保证不同材质/自动组之间也能碰撞。界面分组保持独立元数据。
export function createClothSurface(cloths, enabled, height, colliders) {
    const count=cloths.reduce((sum,c)=>sum+c.group.pins.length,0), group={id:'surface',pins:new Uint8Array(count),
        rest:new Float32Array(count*3),inverseMass:new Float32Array(count),active:new Float32Array(count),owners:new Uint32Array(count),
        representatives:new Uint32Array(count), triangles:[],rawTriangles:[],stretch:{pairs:[],lengths:[]},bend:{pairs:[],lengths:[]}};
    const render=new Map(), layouts=[];let offset=0;
    cloths.forEach((cloth,owner)=>{
        const g=cloth.group,n=g.pins.length;layouts.push({cloth,offset});
        group.rest.set(g.rest,offset*3);group.pins.set(g.pins,offset);group.representatives.set(g.representatives,offset);
        group.owners.fill(owner,offset,offset+n);
        if(enabled.has(g.id)){group.inverseMass.set(g.inverseMass,offset);group.active.fill(1,offset,offset+n);}
        for(const name of ['stretch','bend']){
            for(const id of g[name].pairs)group[name].pairs.push(id+offset);
            for(const length of g[name].lengths)group[name].lengths.push(length);
        }
        for(const id of g.triangles)group.triangles.push(id+offset);
        for(const id of g.rawTriangles)group.rawTriangles.push(id);
        g.vertexIds.forEach((vertex,i)=>{if(!render.has(vertex))render.set(vertex,g.particleIds[i]+offset);});
        offset+=n;
    });
    for(const name of ['stretch','bend']){group[name].pairs=Uint32Array.from(group[name].pairs);group[name].lengths=Float32Array.from(group[name].lengths);}
    group.triangles=Uint32Array.from(group.triangles);group.rawTriangles=Uint32Array.from(group.rawTriangles);
    group.vertexIds=Uint32Array.from(render.keys());group.particleIds=Uint32Array.from(render.values());
    group.bvh=new ClothBvh(group);
    const neighbors=Array.from({length:count},(_,i)=>new Set([i]));
    for(let i=0;i<group.stretch.pairs.length;i+=2){const a=group.stretch.pairs[i],b=group.stretch.pairs[i+1];neighbors[a].add(b);neighbors[b].add(a);}
    const immediate=neighbors.map(set=>[...set]);
    for(let i=0;i<count;i++)for(const j of immediate[i])for(const k of immediate[j])neighbors[i].add(k);
    // 原来全固定的跨组拆点仍需排除接触，不能被当成两个相撞表面。
    const sameVertex=new Map();
    layouts.forEach(({cloth,offset})=>cloth.group.vertexIds.forEach((vertex,i)=>{
        const id=cloth.group.particleIds[i]+offset;
        if(!sameVertex.has(vertex))sameVertex.set(vertex,[]);sameVertex.get(vertex).push(id);
    }));
    for(const ids of sameVertex.values())for(const a of ids)for(const b of ids){neighbors[a].add(b);neighbors[b].add(a);}
    group.attachments=[];
    // 同物理链的脱离网格/接缝只绑定到带固定根部的表面；保存蒙皮相对偏移，不吸附改造模型形状。
    const boundary=new Uint8Array(count),edgeCounts=new Map();
    for(let i=0;i<group.triangles.length;i+=3)for(let k=0;k<3;k++){
        const a=group.triangles[i+k],b=group.triangles[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);
        const edge=edgeCounts.get(key);if(edge)edge.count++;else edgeCounts.set(key,{a,b,count:1});
    }
    for(const edge of edgeCounts.values())if(edge.count===1){boundary[edge.a]=1;boundary[edge.b]=1;}
    for(let id=0;id<count;id++){
        const owner=group.owners[id],source=cloths[owner].group;
        if(!group.inverseMass[id]||(!boundary[id]&&source.fixedCount>0))continue;
        const radius=height*(source.fixedCount===0?0.025:0.002),p=read(group.rest,id);
        let best=radius*radius,binding=null;
        const related=new Set(source.relatedGroups);
        group.bvh.query(group.bvh.roots[1],p.map(v=>v-radius),p.map(v=>v+radius),(_,face)=>{
            const hostOwner=group.owners[face[0]],host=cloths[hostOwner].group;
            if(hostOwner===owner||!host.fixedCount||!related.has(host.id))return;
            if(source.fixedCount>0&&hostOwner>=owner)return; // 边界只向一个稳定方向附着，避免互相循环。
            const points=face.slice(0,3).map(i=>read(group.rest,i)),weights=closestTriangle(p,...points);
            const d=sub(p,interpolate(points,weights)),distance=d.reduce((sum,v)=>sum+v*v,0);
            if(distance>=best)return;best=distance;binding={ids:[id,...face.slice(0,3)],coefficients:[1,...weights.map(v=>-v)]};
        });
        if(binding){
            group.attachments.push(binding);
            for(const a of binding.ids)for(const b of binding.ids){neighbors[a].add(b);neighbors[b].add(a);}
        }
    }
    group.neighbors=neighbors;
    group.colliderAllowed=cloths.map(cloth=>new Set(cloth.colliders));
    group.colliderCount=colliders.length;
    return {group,layouts};
}
