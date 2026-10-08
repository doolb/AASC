import { boneOrigins } from './web-editor-document.mjs';
// 代理对象始终位于绑定姿态的模型坐标中，编辑不反写运行中的刚体。
export function createEditorView(bridge,onSelect,onTransform){
    const {THREE:T,scene,renderer,camera}=bridge.context;const root=new T.Group(),gizmo=new T.Group();scene.add(root);root.add(gizmo);
    const ray=new T.Raycaster(),pointer=new T.Vector2(),canvas=renderer.domElement,previousPointer=canvas.style.pointerEvents;let mesh=null,origins=[],objects=[],selected=[],kind='rigidBodies',mode='move',drag=null,doc=null,onlySelected=true;
    const disposeObject=o=>{o.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});o.removeFromParent();};
    function origin(index){const b=doc.rigidBodies[index];return new T.Vector3(...b.position).add(new T.Vector3(...(origins[b.boneIndex]||[0,0,0])));}
    const selectedPoint=()=>kind==='rigidBodies'?origin(selected[0]):new T.Vector3(...doc.constraints[selected[0]].position);
    function syncGizmo(){gizmo.visible=selected.length>0;if(gizmo.visible)gizmo.position.copy(selectedPoint());}
    function update(nextMesh,nextDoc,nextKind,nextSelected){
        mesh=nextMesh;doc=nextDoc;kind=nextKind;selected=nextSelected;origins=boneOrigins(mesh,T);
        mesh.updateMatrixWorld(true);root.matrixAutoUpdate=false;root.matrix.copy(mesh.matrixWorld);root.matrixWorldNeedsUpdate=true;
        for(const o of objects)disposeObject(o);objects=[];
        doc[kind].forEach((item,index)=>{
            let geometry;
            if(kind==='constraints')geometry=new T.SphereGeometry(.10,8,6);
            else geometry=({0:()=>new T.SphereGeometry(item.width,12,8),1:()=>new T.BoxGeometry(item.width*2,item.height*2,item.depth*2),2:()=>new T.CapsuleGeometry(item.width,Math.max(.001,item.height),4,8)})[item.shapeType]();
            const material=new T.MeshBasicMaterial({color:selected.includes(index)?0xffb347:kind==='constraints'?0x67e8f9:0x8cc6ff,wireframe:kind==='rigidBodies',depthTest:false,transparent:true,opacity:selected.includes(index)?1:.5});
            const object=new T.Mesh(geometry,material);object.position.copy(kind==='rigidBodies'?origin(index):new T.Vector3(...item.position));object.rotation.set(...item.rotation,'XYZ');object.userData.editorIndex=index;object.renderOrder=990;object.visible=!onlySelected||!selected.length||selected.includes(index);root.add(object);objects.push(object);
        });syncGizmo();
    }
    for(let axis=0;axis<3;axis++){
        const direction=new T.Vector3();direction.setComponent(axis,1);const arrow=new T.ArrowHelper(direction,new T.Vector3(),1.4,[0xff5555,0x55ee88,0x5588ff][axis],.25,.12);
        arrow.traverse(o=>{o.userData.editorAxis=axis;if(o.material){o.material.depthTest=false;o.renderOrder=1000;}});gizmo.add(arrow);
    }
    function pick(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);ray.params.Line.threshold=.1;return ray.intersectObjects([...(gizmo.visible?gizmo.children:[]),...objects.filter(o=>o.visible)],true);}
    function down(event){if(!root.visible||event.button!==0)return;const hits=pick(event);const axisHit=hits.find(h=>h.object.userData.editorAxis!=null);
        if(axisHit&&selected.length){event.stopImmediatePropagation();event.preventDefault();const point=selectedPoint(),axis=axisHit.object.userData.editorAxis;
            const a=root.localToWorld(point.clone()).project(camera),b=point.clone();b.setComponent(axis,b.getComponent(axis)+1);root.localToWorld(b).project(camera);
            const rect=canvas.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,axis,dx:(b.x-a.x)*rect.width/2,dy:-(b.y-a.y)*rect.height/2};canvas.setPointerCapture(event.pointerId);return;}
        const hit=hits.find(h=>h.object.userData.editorIndex!=null);if(hit){event.stopImmediatePropagation();onSelect(hit.object.userData.editorIndex,event.ctrlKey||event.metaKey);}}
    function move(event){if(!drag)return;event.stopImmediatePropagation();const dx=event.clientX-drag.x,dy=event.clientY-drag.y;const length=drag.dx**2+drag.dy**2;
        const amount=mode==='rotate'?(dx-dy)*.008:length>1?(dx*drag.dx+dy*drag.dy)/length:0;
        onTransform(drag.axis,amount,mode,false);}
    function up(event){if(!drag)return;event.stopImmediatePropagation();drag=null;onTransform(0,0,mode,true);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
    canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',up,true);canvas.addEventListener('pointercancel',up,true);
    return {update,setOnlySelected(value){onlySelected=value;},setMode(value){mode=value;},setVisible(value){root.visible=value;canvas.style.pointerEvents=value?'auto':previousPointer;},dispose(){canvas.style.pointerEvents=previousPointer;canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',up,true);canvas.removeEventListener('pointercancel',up,true);disposeObject(root);}};
}
