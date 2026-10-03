# MMD刚体XPBD WebGL2实现（伪代码）

```text
已有声明 := XpbdPmxPhysics生命周期/模型空间/骨骼回写
    createXpbdBody与createXpbdJoint元数据、PMX碰撞过滤、相对气流函数
    测试端求解器选择/共享注入/模块指纹、Three renderer
新增定义 := GPUState { readSet, writeSet, previousPose, bodyMetadata, targetEndpoints }
    ConstraintState { jointColors, jointResult, contactPositionLambda, contactVelocityResult, allowedPairs, contactSlots, adjacency }
    GPUPhysics { renderer, targets, solver, packedResult, cpuPoseCache, capability, generation }
    GPUStats { passCount, gpuMs或不可用, readbackMs, frameMs, memoryBytes, effectiveBackend }

初始化 := 探测WebGL2/float renderability/实际framebuffer/纹理上限
    读取PMX类型/形状/质量/惯量/关节 -> 保守允许碰撞对和容量预算
    最多4096刚体/32768允许对/128色/64MiB；超过则明确回退CPU，不丢对
    关节图着色 -> 同色可写刚体互斥 -> 索引与邻接上传
    能力或容量不满足 -> 返回CPU后端及明确原因
    建立双缓冲与固定FBO -> 绑定姿态写入双方/前姿态 -> 速度及lambda归零
    返回包装实例；复用现有模型/动作切换事务及释放旧实例

一帧 := 保存renderer状态与当前模型空间 -> 上传前后锚点及风/重力/帧间隔
    对每个子步:
        保存前姿态 -> 阻尼/重力/风预测 -> 写另一集合 -> 交换
        插值type0完整姿态和type2位置 -> 直接全锁绑定 -> 交换
        子步lambda归零 -> GPU检测允许对AABB/形状接触及入射速度
        对每种关节颜色:
            lambda从0开始（一轮/子步）；按六轴先弹簧后限位XPBD修正 -> 约束自有槽
            按刚体收集本色修正 -> 写姿态并交换
            lambda保存到关节结果槽；接触位置lambda供速度摩擦读取
        接触对内顺序修正，跨对Jacobi按有效接触对数平均 -> 交换 -> 旋转锁轴终态投影
        从前后姿态回算速度 -> 摩擦/反弹修正 -> 关节限位速度投影
        累计诊断接触标记（无逐子步CPU读回）
    GPU打包6项刚体状态及帧内累计接触对标记 -> 一次同步读回 -> 校验有限值 -> 现有骨骼回写
    记录总帧/读回/pass/显存与可用GPU计时 -> finally恢复renderer状态

重置 := 两套状态/前姿态/锚点相位同时更新；清零线角速度与lambda
切动作/模型 := 已解析资源 -> 关闭物理 -> T-pose -> 重建并清零GPU状态 -> 次帧播放
异常 := 释放本次分配 -> 保留旧实例或CPU回退 -> 回显实际后端
上下文丢失 := 暂停GPU -> 丢失事件内释放旧句柄 -> 保留最后CPU姿态
    恢复后重新探测并从缓存姿态重建/清零，禁止在新上下文删除旧句柄
销毁 := 幂等解除事件 -> 释放自有贴图/FBO/材质/buffer -> 保留共享renderer
验证 := CPU对照误差、所有形状与关节/type2、50次切换资源、能力回退和恢复
    网页构建/指纹 -> 手机与桌面同条件性能比较 -> 实测后再决定正式迁移
状态 := 测试版后端已实现；浏览器数值/资源及集成验收见task；未迁移正式版
```
