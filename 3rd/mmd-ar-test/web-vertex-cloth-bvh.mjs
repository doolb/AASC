// 固定拓扑的栈外BVH：节点记录跳过整个子树的索引，GPU无需递归或固定长度栈。
export class ClothBvh {
    constructor(group) {
        this.primitives=[]; this.nodes=[]; this.roots=[]; this.maxDepth=0;
        const kinds=[Array.from({length:group.pins.length},(_,i)=>[i,-1,-1,0]),
            Array.from({length:group.triangles.length/3},(_,i)=>[...group.triangles.subarray(i*3,i*3+3),1]),
            Array.from({length:group.stretch.pairs.length/2},(_,i)=>[...group.stretch.pairs.subarray(i*2,i*2+2),-1,2])];
        const center=primitive=>[0,1,2].map(axis=>{
            const ids=primitive.slice(0,3).filter(id=>id>=0);return ids.reduce((sum,id)=>sum+group.rest[id*3+axis],0)/ids.length;
        });
        const build=(ids,depth)=>{
            const index=this.nodes.length,node={left:-1,right:-1,escape:0,primitive:-1,depth};this.nodes.push(node);
            this.maxDepth=Math.max(this.maxDepth,depth);
            if(ids.length===1)node.primitive=ids[0];
            else {
                const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
                for(const id of ids)for(let a=0;a<3;a++){min[a]=Math.min(min[a],centers[id][a]);max[a]=Math.max(max[a],centers[id][a]);}
                const sizes=max.map((v,a)=>v-min[a]),axis=sizes.indexOf(Math.max(...sizes));
                ids.sort((a,b)=>centers[a][axis]-centers[b][axis]);const middle=ids.length>>1;
                node.left=build(ids.slice(0,middle),depth+1);node.right=build(ids.slice(middle),depth+1);
            }
            node.escape=this.nodes.length;return index;
        };
        const centers=[];
        for(const list of kinds){
            const start=this.primitives.length;for(const primitive of list){this.primitives.push(primitive);centers.push(center(primitive));}
            this.roots.push(list.length?build(Array.from({length:list.length},(_,i)=>start+i),0):-1);
        }
        this.min=new Float32Array(this.nodes.length*4);this.max=new Float32Array(this.nodes.length*4);
        this.refit(group.rest,group.rest);
    }
    refit(p,previous) {
        for(let index=this.nodes.length-1;index>=0;index--){
            const node=this.nodes[index],start=index*4;
            for(let axis=0;axis<3;axis++){
                let low=Infinity,high=-Infinity;
                if(node.primitive>=0){
                    for(const id of this.primitives[node.primitive].slice(0,3))if(id>=0){low=Math.min(low,p[id*3+axis],previous[id*3+axis]);high=Math.max(high,p[id*3+axis],previous[id*3+axis]);}
                }else{low=Math.min(this.min[node.left*4+axis],this.min[node.right*4+axis]);high=Math.max(this.max[node.left*4+axis],this.max[node.right*4+axis]);}
                this.min[start+axis]=low;this.max[start+axis]=high;
            }
            this.min[start+3]=node.depth;
        }
    }
    query(root,low,high,visit) {
        if(root<0)return;
        const end=this.nodes[root].escape;let index=root;
        while(index<end){
            const node=this.nodes[index],i=index*4;
            if([0,1,2].some(a=>this.max[i+a]<low[a]||this.min[i+a]>high[a])){index=node.escape;continue;}
            if(node.primitive>=0){visit(node.primitive,this.primitives[node.primitive]);index=node.escape;}
            else index=node.left;
        }
    }
}
