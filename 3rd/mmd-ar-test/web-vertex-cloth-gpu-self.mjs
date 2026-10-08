import { GLSL3, NoBlending, RawShaderMaterial, Vector3 } from 'three';
import { QUAD_VERTEX } from './web-vertex-cloth-gpu-shaders.mjs';
import { REFIT_FRAGMENT, CONTACT_FRAGMENT, ATTACH_FRAGMENT } from './web-vertex-cloth-self-shaders.mjs';
import { packVectors } from './web-vertex-cloth-gpu-data.mjs';

// 在GPU重拟合固定BVH并逐粒子收集接触，无全粒子读回、浮点原子写或固定候选截断。
export class GpuClothSelfCollision {
    constructor(entry){
        this.entry=entry;this.owner=entry.owner;const g=entry.group,bvh=g.bvh,make=n=>this.owner.texture(n);
        this.nodes=make(bvh.nodes.length);this.primitives=make(bvh.primitives.length);
        bvh.nodes.forEach((node,i)=>this.nodes.image.data.set([node.left,node.right,node.escape,node.primitive],i*4));
        bvh.primitives.forEach((primitive,i)=>this.primitives.image.data.set(primitive,i*4));
        this.initialMin=make(bvh.nodes.length);this.initialMax=make(bvh.nodes.length);
        this.initialMin.image.data.set(bvh.min);this.initialMax.image.data.set(bvh.max);
        this.boundsA=this.owner.createTarget(bvh.nodes.length,2);this.boundsB=this.owner.createTarget(bvh.nodes.length,2);
        this.rest=make(g.pins.length);packVectors(this.rest,g.rest);
        const lists=Array.from({length:g.pins.length},()=>({faces:[],edges:[]}));
        bvh.primitives.forEach((primitive,index)=>{
            if(primitive[3]===0)return;
            for(const id of primitive.slice(0,3))if(id>=0)lists[id][primitive[3]===1?'faces':'edges'].push(index);
        });
        this.adjacency=make(g.pins.length);this.adjacencyIds=make(lists.reduce((sum,list)=>sum+list.faces.length+list.edges.length,0));
        let cursor=0;
        lists.forEach((list,i)=>{
            this.adjacency.image.data.set([cursor,list.faces.length,cursor+list.faces.length,list.edges.length],i*4);
            for(const id of [...list.faces,...list.edges]){this.adjacencyIds.image.data[cursor*4]=id;cursor++;}
        });
        this.exclude=make(g.pins.length);this.excludeIds=make(g.neighbors.reduce((sum,set)=>sum+set.size,0));cursor=0;
        g.neighbors.forEach((set,i)=>{this.exclude.image.data.set([cursor,set.size,0,0],i*4);for(const id of set){this.excludeIds.image.data[cursor*4]=id;cursor++;}});
        const uniform=value=>({value});
        this.refitMaterial=this.material(REFIT_FRAGMENT,{posTex:uniform(null),prevTex:uniform(null),
            nodeTex:uniform(this.nodes),primitiveTex:uniform(this.primitives),minTex:uniform(null),maxTex:uniform(null),
            nodeCount:uniform(bvh.nodes.length),level:uniform(0)});
        this.contactMaterial=this.material(CONTACT_FRAGMENT,{posTex:uniform(null),velTex:uniform(null),prevTex:uniform(null),
            restTex:uniform(this.rest),nodeTex:uniform(this.nodes),primitiveTex:uniform(this.primitives),minTex:uniform(null),maxTex:uniform(null),
            adjacencyTex:uniform(this.adjacency),adjacencyIdsTex:uniform(this.adjacencyIds),excludeTex:uniform(this.exclude),excludeIdsTex:uniform(this.excludeIds),
            roots:uniform(new Vector3(...bvh.roots)),particleCount:uniform(g.pins.length),thickness:uniform(entry.cloth.solver.thickness*2)});
        const range=make(g.pins.length),ids=make(g.attachments.length),coefficients=make(g.attachments.length),list=make(g.attachments.length*4);
        const byParticle=Array.from({length:g.pins.length},()=>[]);
        g.attachments.forEach((attachment,i)=>{ids.image.data.set(attachment.ids,i*4);coefficients.image.data.set(attachment.coefficients,i*4);for(const id of attachment.ids)byParticle[id].push(i);});
        cursor=0;byParticle.forEach((items,i)=>{range.image.data.set([cursor,items.length,0,0],i*4);for(const id of items){list.image.data[cursor*4]=id;cursor++;}});
        this.attachMaterial=this.material(ATTACH_FRAGMENT,{posTex:uniform(null),velTex:uniform(null),prevTex:uniform(null),
            targetTex:uniform(entry.targets),oldTargetTex:uniform(entry.oldTargets),alpha:uniform(0),particleCount:uniform(g.pins.length),
            rangeTex:uniform(range),listTex:uniform(list),idsTex:uniform(ids),coefficientsTex:uniform(coefficients)});
    }
    material(fragmentShader,uniforms){return this.owner.keep(new RawShaderMaterial({glslVersion:GLSL3,vertexShader:QUAD_VERTEX,fragmentShader,uniforms,
        depthTest:false,depthWrite:false,blending:NoBlending,toneMapped:false}));}
    pass(material){
        const e=this.entry,u=material.uniforms;u.posTex.value=e.ping.texture[0];u.velTex.value=e.ping.texture[1];u.prevTex.value=e.ping.texture[2];
        this.owner.quad.material=material;this.owner.renderer.setRenderTarget(e.pong);this.owner.renderer.render(this.owner.scene,this.owner.camera);
        [e.ping,e.pong]=[e.pong,e.ping];
    }
    attach(alpha){if(!this.entry.group.attachments.length)return;this.attachMaterial.uniforms.alpha.value=alpha;this.pass(this.attachMaterial);}
    *steps(){
        const u=this.refitMaterial.uniforms,e=this.entry;u.posTex.value=e.ping.texture[0];u.prevTex.value=e.ping.texture[2];
        let current=this.bounds || [this.initialMin,this.initialMax];
        for(let level=e.group.bvh.maxDepth;level>=0;level--){
            u.level.value=level;u.minTex.value=current[0];u.maxTex.value=current[1];
            this.owner.quad.material=this.refitMaterial;
            const output=current===this.boundsA.texture?this.boundsB:this.boundsA;
            this.owner.renderer.setRenderTarget(output);this.owner.renderer.render(this.owner.scene,this.owner.camera);current=output.texture; yield;
        }
        this.bounds=current;this.contactMaterial.uniforms.minTex.value=current[0];this.contactMaterial.uniforms.maxTex.value=current[1];
        // 自碰撞按4行拆分；每片仍读取同一ping，所有片完成后才交换。
        const material=this.contactMaterial,uContact=material.uniforms,r=this.owner.renderer;
        uContact.posTex.value=e.ping.texture[0];uContact.velTex.value=e.ping.texture[1];uContact.prevTex.value=e.ping.texture[2];
        for(let y=0;y<e.pong.height;y+=4){
            this.owner.quad.material=material;
            // renderTarget的scissor以纹理像素计，不能乘屏幕devicePixelRatio。
            e.pong.scissor.set(0,y,e.pong.width,Math.min(4,e.pong.height-y));e.pong.scissorTest=true;
            r.setRenderTarget(e.pong);
            try{r.render(this.owner.scene,this.owner.camera);}finally{e.pong.scissorTest=false;r.setScissorTest(false);}
            yield;
        }
        [e.ping,e.pong]=[e.pong,e.ping];
    }
}
