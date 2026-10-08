// 闭包桥接只暴露给编辑器，不依赖场景扫描或Three原型补丁。
export function createEditorBridge(context) {
    const { THREE,renderer,camera,scene,ambientOcclusion }=context;
    return { context,
        cameraView:()=>({position:camera.position.toArray(),quaternion:camera.quaternion.toArray()}),
        setCameraView(view){
            if(!view || !Array.isArray(view.position) || view.position.length!==3 || !Array.isArray(view.quaternion) || view.quaternion.length!==4 || ![...view.position,...view.quaternion].every(Number.isFinite))throw new Error('相机数据无效');
            context.editorCameraControl.view={position:[...view.position],quaternion:[...view.quaternion]};
        },
        resetCameraView(){context.editorCameraControl.view=null;},
        attachExternalCharacter(root){
            if(!root?.isObject3D)throw new Error('Blender角色场景无效');
            const savedCamera=this.cameraView();
            const savedCameraControl=context.editorCameraControl.view?{
                position:[...context.editorCameraControl.view.position],quaternion:[...context.editorCameraControl.view.quaternion]
            }:null;
            const hidden=new Map();let restored=false;
            const hideCurrent=()=>{
                const current=context.currentPivot;
                if(!current||current===root)return;
                if(!hidden.has(current))hidden.set(current,current.visible);
                current.visible=false;
            };
            const fit=()=>{
                context.editorCameraControl.view=null;
                context.fitCameraToModel?.(root);
                context.fitShadowCamera?.(root);
                context.editorCameraControl.view=this.cameraView();
            };
            hideCurrent();scene.add(root);context.applyShadowFlags?.(root);fit();
            return {
                refresh:()=>{if(restored)return false;hideCurrent();if(root.parent!==scene)scene.add(root);return true;},
                restore:()=>{
                    if(restored)return;restored=true;root.removeFromParent();
                    for(const [model,visible]of hidden)if(model.parent)model.visible=visible;
                    const current=context.currentPivot||context.mesh;
                    context.editorCameraControl.view=null;
                    context.fitCameraToModel?.(current);
                    context.fitShadowCamera?.(current);
                    camera.position.fromArray(savedCamera.position);camera.quaternion.fromArray(savedCamera.quaternion);camera.updateMatrixWorld(true);
                    context.editorCameraControl.view=savedCameraControl;
                }
            };
        },
        face(direction){const box=new THREE.Box3().setFromObject(context.mesh),center=box.getCenter(new THREE.Vector3());const distance=Math.max(box.getSize(new THREE.Vector3()).length(),1)*1.5;
            camera.position.copy(center).add(new THREE.Vector3(...direction).multiplyScalar(distance));camera.lookAt(center);this.setCameraView(this.cameraView());},
        rest(){const mesh=context.mesh;if(!mesh?.isSkinnedMesh)throw new Error('请选择PMX角色');mesh.pose();mesh.updateMatrixWorld(true);},
        read(){const mesh=context.mesh;if(!mesh?.geometry?.userData?.MMD)throw new Error('当前角色不是可编辑PMX');return {mesh,profile:context.profile};},
        async capture(width,height,transparent){
            width=Math.round(Number(width));height=Math.round(Number(height));
            const limit=Math.min(4096,renderer.capabilities.maxTextureSize);
            if(!Number.isFinite(width+height)||width<64||height<64||width>limit||height>limit)throw new Error(`图片尺寸范围64～${limit}`);
            const size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio(),aspect=camera.aspect;
            const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
            try {
                renderer.setPixelRatio(1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
                renderer.setClearColor(transparent?0x000000:0x20232b,transparent?0:1);
                ambientOcclusion.render();
                // 绘制后立即发起读取，兼容preserveDrawingBuffer=false。
                return await new Promise((resolve,reject)=>renderer.domElement.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG生成失败')),'image/png'));
            } finally {renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);camera.aspect=aspect;camera.updateProjectionMatrix();renderer.setClearColor(clear,alpha);}
        },
        seek(seconds){const object=context.helper?.objects?.get(context.mesh);const mixer=object?.mixer;if(!mixer)return false;
            mixer.setTime(Math.max(0,Number(seconds)||0));object.physics?.reset();context.mesh.updateMatrixWorld(true);return true;}
    };
}
