# 3D 视图 - 实现文档

## 概述

基于 Three.js 的 3D 场景，用于可视化展示执行者集群的拓扑结构。

## Viewer 对象结构

```
Viewer:
  scene              THREE.Scene
  camera             THREE.PerspectiveCamera
  renderer           THREE.WebGLRenderer
  controls           OrbitControls

  // 数据
  actors             Actor[]
  buildings          Building[]
  objects            THREE.Object3D[]      // ground, connections 等共享对象

  // 网格集合
  buildingMeshes     Map<id, Group>        // 建筑网格 (含内部 actor)
  actorMeshes        Map<id, Group>        // 执行者网格引用 (是 building 的 child)
  torusMeshes        Set<Mesh>             // 环形几何体(旋转动画), 统一管理

  // 快速查询 Map (O(1) 查找替代 Array.find)
  buildingMap        Map<id, Building>
  actorMap           Map<id, Actor>

  // 时钟 & 状态
  clock              THREE.Clock
  autoRotate         bool
  showBuildings      bool
  frameCount         int
  lastTime           number
```

## 生命周期

```
init():
  - 创建 scene / camera / renderer / controls
  - setupLights() / setupGrid() / setupInteraction()
  - loadPreset('actors')
  - startActorUpdates()
  - animate()

loadPreset(preset):
  - clearScene()                    // 清除全部场景对象
  - 切换 scale/distance
  - createSolarSystem / createEarth / createCity / createActorsScene
  - 重置 camera

createActorsScene():
  - 创建 ground
  - fetchAndDisplayActors()          // 首次加载

fetchAndDisplayActors():
  if document.hidden: return
  try:
    GET /api/actors
    if success:
      clearActorObjects()            // 释放旧网格
      actors = data.actors
      buildBuildings()
      displayBuildings()
  catch: retry with backoff
```

## 场景构建

```
buildBuildings():
  - buildings = []                   // 重置
  - 按 ip+role 分组 actors 为 buildings
  - 重建 buildingMap / actorMap     // 供 O(1) 查询

displayBuildings():
  - 按 type(server/display/control) 在环形布局中放置建筑
  - 每个 building:
    createBuildingMesh(building, x, z):
      - Group (userData.objectId = building.id)
      - 地板 + 墙壁×5 + 门 + 状态灯光 + 文本 label
      - 内部 actors:
        createActorMesh(actor, x, z, size, parentGroup):
          - Group (userData.actorId = actor.id)
          - 主体几何体(取决于 role: octahedron/cone/box)
          - TorusGeometry 光环 (加入 torusMeshes 统一管理)
          - parentGroup.add(group)  // 成为 building 的 child
      - scene.add(group)
      - buildingMeshes.set(id, group)
  - createConnections(): 从 server 到其他建筑的曲线连线

clearActorObjects():
  - buildingMeshes: scene.remove + traverse dispose + clear
  - actorMeshes: clear
  - objects: 过滤移除 TubeGeometry(连线), 保留其他
  - actors = [], torusMeshes.clear(), buildingMap.clear(), actorMap.clear()
```

## 动画循环

```
animate():
  rAF -> this.animate()

  if document.hidden:                // 页签隐藏时完全跳过
    clock.getDelta()                 // 消耗时间防止跳帧
    return

  delta = clock.getDelta()
  elapsed = clock.getElapsedTime()

  controls.update()

  // building 旋转 (server 建筑缓慢自转)
  buildingMeshes.forEach(mesh, id):
    building = buildingMap.get(id)   // O(1)
    if building.type == 'server':
      mesh.rotation.y = elapsed * 0.05

  // actor 旋转 (server 角色自转)
  actorMeshes.forEach(mesh, id):
    actor = actorMap.get(id)         // O(1)
    if actor.role == 'server':
      mesh.rotation.y = elapsed * 0.3

  // 光环统一旋转 (不遍历 children)
  torusMeshes.forEach(mesh):
    mesh.rotation.z = elapsed * 2

  renderer.render(scene, camera)

  // FPS 计数 & 信息更新
```

## 交互

```
mousemove -> checkHover(event):
  - raycaster.intersectObjects(buildingMeshes + actorMeshes, recursive=true)
  - 命中时根据 userData.objectId/actorId 显示 tooltip
  - 更新 cursor 样式

click -> focusOnObject(obj):
  - controls.target = 对应 mesh 的位置
```

## 数据更新

```
refreshActors():                    // 手动或自动 (5s 定时)
  -> fetchAndDisplayActors()

startActorUpdates():
  - 5s 定时循环，失败时指数退避 (max 60s)
  - 仅 currentScale == 'actors' && !document.hidden 时执行

stopActorUpdates():
  - 清理定时器
```

## 性能设计

| 机制 | 说明 |
|------|------|
| document.hidden 检查 | 页签隐藏时完全不执行 animate 和 refresh，避免无用计算 |
| Map 查询 | buildingMap/actorMap O(1) 取代 Array.find O(n) |
| torusMeshes Set | 统一管理环形动画，避免每帧遍历 children |
| clearActorObjects | 增量清理，只释放 actor/building 相关对象，保留 ground/lights |
| 自动刷新退避 | 失败时指数退避，减少无用请求 |
