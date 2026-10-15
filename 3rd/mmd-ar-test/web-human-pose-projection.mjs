// 只读取求解后的语义骨骼；目标标记不是人物实际到达的位置。纯矩阵部分不依赖Three运行时。
export const POSE_JOINTS = [
    ['head', null], ['neck', null], ['upperBody', null], ['hips', null],
    ['leftArm', 11], ['rightArm', 12], ['leftElbow', 13], ['rightElbow', 14], ['leftWrist', 15], ['rightWrist', 16],
    ['leftLeg', 23], ['rightLeg', 24], ['leftKnee', 25], ['rightKnee', 26], ['leftAnkle', 27], ['rightAnkle', 28]
];
export const POSE_EDGES = [['head','neck'],['neck','upperBody'],['upperBody','hips'],['leftArm','rightArm'],
    ['leftArm','leftElbow'],['leftElbow','leftWrist'],['rightArm','rightElbow'],['rightElbow','rightWrist'],
    ['leftArm','leftLeg'],['rightArm','rightLeg'],['leftLeg','rightLeg'],['leftLeg','leftKnee'],['leftKnee','leftAnkle'],['rightLeg','rightKnee'],['rightKnee','rightAnkle']];
export function readActualPose(model, camera, geometry) {
    if (!camera) throw new Error('当前相机不可用');
    model.mesh.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
    const points = POSE_JOINTS.flatMap(([key, landmark]) => {
        const bone = model.bindings['bones:' + key]?.bone, world = bone?.matrixWorld.elements.slice(12, 15);
        return world?.every(Number.isFinite) ? [{ key, landmark, world }] : [];
    });
    return { token: model.token, points, view: { viewMatrix: camera.matrixWorldInverse.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
        aspect: camera.aspect || Math.abs(camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0]) || 1,
        fov: camera.fov, zoom: camera.zoom || 1, rotation: geometry?.rotation || 0 } };
}
const multiply = (m, p) => [0,1,2,3].map(i => m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]*p[3]);
export function projectPose(points, view) {
    if (view?.viewMatrix?.length !== 16 || view?.projectionMatrix?.length !== 16) throw new Error('投影相机无效');
    return points.map(point => {
        const v = multiply(view.viewMatrix, [...point.world, 1]), clip = multiply(view.projectionMatrix, v), w = clip[3];
        const x = clip[0]/w * view.aspect/2, y = -clip[1]/w/2;
        const rotation = { 0:[x,y],90:[-y,x],180:[-x,-y],270:[y,-x] }[view.rotation] || [x,y];
        return { ...point, x: rotation[0], y: rotation[1], visible: v[2] < 0 && w > 0
            && Math.abs(clip[2]/w) <= 1 && rotation.every(Number.isFinite) };
    });
}
export function fitPoseAlignment(points, width, height) {
    const visible = points.filter(p => p.visible && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (visible.length < 2) throw new Error('没有可投影的实际骨架');
    const xs = visible.map(p=>p.x), ys = visible.map(p=>p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = .82 * Math.min(width/Math.max(maxX-minX, .01), height/Math.max(maxY-minY, .01));
    return { scale, x: width/2-(minX+maxX)/2*scale, y: height/2-(minY+maxY)/2*scale };
}
export function poseScale(points) {
    if (!points.length) return 1;
    const spans = [0,1,2].map(axis => Math.max(...points.map(p=>p.world[axis]))-Math.min(...points.map(p=>p.world[axis])));
    return Math.max(.0001, Math.hypot(...spans));
}
export function poseMovement(a, b) {
    if (a.token !== b.token) return Infinity;
    return Math.max(0, ...a.points.map(p => {
        const other = b.points.find(value => value.key === p.key);
        return other ? Math.hypot(...p.world.map((v,i)=>v-other.world[i])) : Infinity;
    })) / poseScale(a.points);
}
