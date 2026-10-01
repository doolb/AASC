# 自测功能实现文档

## MMD AR骨骼大小、名称、点选与碰撞累计（2026-10-01，已实现并验证）

```text
selection模块10项 -> 真Three、可观察Canvas与真Ammo
  倍率默认/端点/无效值/真实实例半径，骨骼与物理参数不变
  中文固定字号、唯一Canvas、DPR/尺寸变化、空名及相机/屏幕裁剪
  关闭/隐藏即清屏，关闭无额外名称绘制；换模型/幂等销毁释放轴与Canvas
  点选/空白/等距前方优先，多绑定/无绑定骨骼与局部轴父级变换
  刚体过滤压缩有效count，空集合隐藏，不重建资源，取消恢复全量
  真Ammo每子步累计直接对手，不递归链；1000+次读取不改速度/native对象数，4MiB探针复用
  跨子步短暂接触保留；读取异常不打断物理；重建/取消清除回调与累计
  偏好损坏/受限、范围钳制、面板状态与清空按钮
原有骨骼8/刚体9/子步6/切换8/生命周期6/稳定性9 -> 与selection10合计56项通过
面板回归 -> 控件ID和分组、大小范围、开关默认关闭、原交互/滚动保留
真实网页 -> 大小端点/名称/高亮/三轴/实际轻点/拖动/CDP真实双指/取消恢复全量
  刷新恢复设置；PMX切换清选择，VMD保留选择且物理替换清累计；Canvas数量稳定
构建 -> npm run build:web:mmd-ar-test；31生成脚本/4内联语法/16导入指纹/LAN HTTP200通过
当前状态 -> 面板8项与最终真实网页1项通过，总计65项；手机密集名称可读性/触摸命中/帧耗时待现场验收
```

## MMD AR PMX碰撞体显示（2026-10-01，已实现并验证）

```text
模块自测 -> 真Three几何和世界变换
  球半径/盒半边长到完整尺寸/胶囊Y轴与端帽比例，红0/黄2/绿1
  读取Ammo实际COM位置/旋转，故意与骨骼分离 -> 线框跟随物理结果
  无物理 -> 骨骼偏移配置预览；无骨骼仍显示；非法数据安全跳过
  模型/父级平移旋转及非单位缩放 -> 物理到显示坐标无重复变换
  开关独立/默认关闭/偏好异常；首帧隐藏与关闭时无逐体更新
  动作/物理重载 -> 新physics对象生效；不访问已销毁的旧Ammo引用
  native姿态读取 -> 池对象归还，无持续增长；不写入速度/约束
  几何复用/实例化/重复模型替换/幂等释放/绘制异常恢复
真实网页 -> 同时开启骨骼与碰撞体、动作暂停/播放、物理关/开、换PMX/VMD、刷新
  分类/姿态/状态说明正确，无页面异常，资源数量不持续增长
  记录实际刚体数量、实例组数量和开启的帧耗时，手机观感另验收
npm网页构建 -> 生成语法/模块指纹/LAN页面资源核对
当前状态 -> 碰撞体9项/骨骼8项/面板8项/动作切换与生命周期14项/浏览器1项，共40项通过
  真实Ammo -> 1000帧读取，无native数量增长，4MiB探针复用，堆64MiB
  默认PMX形状 -> 134盒/49胶囊，无球体；球体由模块Three/真实Ammo用例覆盖
  网页构建成功，30脚本/4内联语法/16导入指纹/LAN HTTP200通过
  浏览器225秒 -> 183体、33实例组/31几何，累计释放132旧组，无页面异常
  AO/骨骼独立开关/物理实际及预览/两次PMX/VMD/刷新恢复通过
  SwiftShader连续8帧 -> 骨骼开启基线877.89ms/帧，碰撞体开启923.57ms/帧
    软件渲染短窗口不代表手机性能；密集部位观感另验收
```

## MMD AR 骨骼物理状态球（2026-09-30，已实现并验证）

```text
真实Three模块自测 -> 输入已加载刚体元数据与骨骼
  断言红type0、黄type2、绿type1，无关联灰，非法索引忽略
  断言同骨骼type1优先type2优先type0，采用加载后type转换结果
  更新骨骼/父级变换 -> 小球位置等于骨骼世界位置，球大小跟随模型缩放
  关闭/角色首帧隐藏 -> 无实例更新与overlay绘制
  overlay绘制失败 -> renderer状态恢复；骨骼/物理状态不被写入
  换模型/重复销毁 -> 旧实例/几何/材质释放且无残留骨骼引用
面板自测 -> 开关在动作面板、默认关闭、图例映射正确、偏好恢复与转发
真实网页自测 -> 默认PMX开关/动作/物理暂停/恢复、刷新、再次选择PMX
  检查分类与位置、T Pose首帧门控、无页面异常、资源数量不持续增长
现有npm网页构建 -> 生成模块语法及内容指纹校验
当前状态 -> 模块8项/面板8项/切换和生命周期14项/真实网页1项，共31项通过
  软件WebGL真实网页 -> 321骨骼/4实例组；5代模型/旧16组释放；VMD复用球资源
  开关/刷新/AO/两次PMX切换通过，截图确认；构建/语法/指纹/LAN HTTP200通过
  首帧尚隐藏 -> 测试等待真实显示帧再比较资源，避免把未分配状态当泄漏
  性能采样 -> SwiftShader连续8帧，关闭732.16ms/帧，开启778.13ms/帧
    属于软件渲染环境及短窗口，不代表手机性能；真机密集位置观感待验收
```

## TTS 内存音频下发与 Node 标准输入播放（2026-09-30）

```text
本轮仅静态检查，不新增或运行测试:
  tts-service/cache/cache-config/http、config-app-service、server-app、Node audio-player
  控制端tts.js/websocket.js -> node --check通过
  定向差异空白检查通过；两处服务端生成与Node URL/Buffer路径无写文件入口
待现场验收:
  默认128MiB、16..1024边界/非法值规范化、容量热应用与持久化失败保留旧值
  Android禁用外部TTS时也恢复显示端回传音频缓存容量
  多控制端广播/断线重连/服务器重启恢复，10秒无回包解除等待
  降额不驱逐有效音频，超额拒绝新增，过期后恢复；升额立即放行
  外部/显示端生成成功及fallback，API/普通/Agent/文本媒体/语音/提醒/报时
  完整GET/HEAD、首尾/后缀/无效Range、重复/多端读取、过期/重启404
  单段/总量/条数超限、异常base64、上游错误/超时/中断不发布半成品
  Windows/Linux：没有新增临时WAV，有正常声音、队列/停止/新句不被旧结束覆盖
  录音暂停后停止恢复，16位PCM额外RIFF块/立体声的AEC回调只执行一次
  旧WAV汇总清理且清理完成后不再磁盘扫描，其他文件/符号链接保留
```

## MMD AR Ammo固定子步锚点与180Hz（2026-09-30，已验证）

```text
已有声明: 真实Three/固定Ammo WASM、WEB_MODE构建补丁、native生命周期与本地资源浏览器压力
新增定义: AnchorTrace { substepTime, position, quaternion, linearVelocity, angularVelocity }
操作流程:
  60FPS/180Hz -> 单帧位置和旋转目标 -> 实际三个单步及其MotionState目标等比例推进
  60/90/120/144FPS -> 固定步余量跨帧 -> 单位时间模拟步数与速度一致
  120FPS/65Hz -> 无子步帧不强制推进；动态速度不清零
  复位/步频改变/后台恢复 -> 同步姿态历史与时钟，无跨旧状态插值
  预算超限 -> 余量不足一步，无无限补算；异常 -> 临时资源归还
  真实关节 -> 锚点带动动态刚体；native循环释放 -> 计数归零
  180Hz网页 -> 模型/动作切换首帧物理、下一帧动作与内存有界
  旧480保存值 -> 页面与实际物理参数限制180，实时调65不重建
验证结果:
  tests/mmd-ar-physics-substeps.test.js -> 6项真实子步/关节/历史/边界测试通过
  同步rate/lifecycle/motion-switch夹具 -> 与构建一致的完整物理补丁链
  定向74项 + 本地资源浏览器3项 -> 77项通过
  64轮锚点关节 / 128轮生命周期 -> native分配清空、4MiB探针地址复用
  浏览器约563秒、24次VMD/4次PMX -> 创建32/释放31/存活1、64MiB、391064字节跨度
  旧480设置恢复180、实时65不重建、首两帧动作门控 -> 通过
  npm网页构建 / 10脚本与4内联语法 / 11导入指纹关系 -> 通过
待现场:
  手机实际CPU、帧率和布料抖动改善程度，不以自动化关节测试代替视觉验收
```

## MMD AR 布料480Hz（2026-09-30，历史验证记录）

```text
已有声明: 网页专用频率适配、固定Three/Ammo、Node测试及本地资源Chromium压力用例
新增定义: RateCases、真实动态刚体位移、BrowserRate { input, persisted, unitStep, maxStepNum }
操作流程:
  规范化边界/默认/非法值 -> 30到480，5Hz步长，65默认；低频3子步、高频0.1秒预算
  固定源码经网页补丁 -> 实际helper创建480Hz物理 -> 与正式90Hz限幅对照
  480Hz刚体恒速运动一秒，输入帧率60/30/10 -> 位移接近一米，无时间截断
  同步修改现有实例预算回65 -> 仍为原实例，不归零速度
  网页滑条默认65、范围30到480 -> 设置480 -> 控件/API/存储/物理参数一致
  真实24次VMD与4次PMX切换 -> 参数保持480，首帧门控与native回收继续验证
  实时调65 -> 当前物理使用3子步，实例未重建；再设480并刷新 -> 恢复480
  既有灯光AO夹具 -> 补齐正式页面已有主光阴影控件，避免全控件初始化提前返回
  既有面板夹具 -> 同步现有过滤/IMU/重力控件与分类名称，默认不透明度50%
结果:
  定向回归57/57；面板/资源10项最终覆盖通过（旧夹具修正后定向复测3/3）
  本地资源浏览器3/3，480Hz压力阶段24次动作与4次模型切换，耗时约589秒
  物理创建32、销毁31、存活1；堆67108864字节、探针跨度3516552字节，无页面异常/OOM
  构建通过；9个源/生成脚本、4个内联脚本语法及6个导入指纹通过
待验收:
  发布后手机480Hz帧率、CPU负荷、布料观感与不同模型兼容性
```

## MMD AR 重力缓动默认20ms（2026-09-30）

```text
本轮构建和静态检查，未执行测试:
  默认过滤/模型/控件状态 -> smoothingMs=20，生成滑条/读数=20ms
  npm run build:web:mmd-ar-test -> 成功，源/生成脚本语法通过
待现场验收:
  无已保存用户设置 -> 默认20ms；已有参数 -> 恢复原值
  0关闭缓动、手动旋转叠加/居中、手机跟随观感
```

## MMD AR 重力摄像头背景与默认外观（2026-09-30）

```text
本轮仅构建和静态检查，不新增或执行自动测试:
  npm run build:web:mmd-ar-test -> 成功生成web-dist
  构建/分组/重力注入/背景模块/跟踪源及生成AR脚本 -> node --check通过
  生成页面复查 -> 三个面板默认50%，开关默认关闭，顶部固定提示DOM已移除
待真机验收（未执行）:
  重力开启 -> 勾选背景 -> 授权成功显示，手动/重力叠加继续
  背景关闭/重力关闭/后台/离开 -> 独立轨道停止，迟到授权轨道停止
  图片定位 + 背景关闭 -> 只隐藏视频，目标识别/蓝框继续
  校准 -> 独立流释放，校准预览显示，关闭后按选择恢复
  快速开关/授权拒绝/前后台/横竖屏/真实及模拟输入切换 -> 无重复占用
  无已保存不透明度 -> 三个面板50%，调节并刷新 -> 恢复手动值
```

## MMD AR Ammo 生命周期压力验证（2026-09-30）

```text
已有声明:
  网页vendor生命周期补丁、固定Three.js/Ammo、Node test runner、Chromium本地资源用例
新增定义:
  NativeFixture { livingPointers, createEvents, destroyEvents, memoryProbes, ownedWorld, borrowedWorld }
  BrowserPhysicsLifetime { activeInstances, createdCount, disposedCount, errors }
操作流程:
  固定物理/动画源码 -> 与构建相同补丁 -> 实际Ammo，观测new与destroy对应native指针
  128轮创建三种形状刚体/约束 -> 物理步进 -> helper.remove -> 存活指针回到0
  每轮4MiB申请/释放 -> 预热后地址稳定复用 -> 64MiB堆不增长
  约束先移除 -> 刚体移除 -> 逆创建销毁，重复dispose不再destroy
  借用world -> 只销毁借用实例的自建对象 -> 所有者world仍可步进
  第二刚体/约束/构造失败、helper物理创建后IK失败 -> 暂存分配为0，网格父级/变换恢复
  新动作已初始化后回滚/失败 -> 旧物理仍存活，新分配消失
  成功移除旧helper -> 绑定姿态骨骼不被旧mixer复位 -> 新物理可步进，最终释放为0
  真实网页 -> importmap同一指纹helper -> 只观测存活物理，不保留历史模型引用
  24次原生VMD文件选择 + 每6次一次PMX/贴图选择共4次模型切换
  每轮 -> 当前仅1实例且创建数减销毁数等于1 -> 被销毁manager拥有对象为0
  每轮4MiB探针 -> 预热后的地址跨度小于8MiB，不要求地址逐次相同
  每轮当前仅1实例、已销毁native为0 -> 64MiB堆保持，无页面异常/OOM
  原PMX/贴图/进度/暂停/恢复默认/物理重载/重力/循环用例继续通过
```

## MMD AR 加载进度与初始化速度清理（2026-09-30）

```text
已有声明:
  ProgressView、模型/VMD专用进度回调、clearPmxPhysicsMotion、固定vendor与Ammo
新增定义:
  ProgressFixture { token, timers, aria, phase, state }
  PhysicsFixture { bodies, velocities, forces, transforms, allocationCount }
操作流程:
  开始 -> 不定进度可见 -> 实际读取比例单调 -> 未提交不能到100% -> 成功收起
  新操作 -> 旧消息/旧定时器忽略；失败 -> 停止且不100%；多PMX -> 等待选择
  非零线/角速度与残留力 -> 清理 -> 全部为零，刚体位姿保持
  临时向量 -> 成功和异常均释放；无物理 -> 旁路
  注入模型helper初始化 -> 清理 -> 返回提交；动作绑定姿态初始化 -> 清理 -> 启用
  真实Ammo不同刚体类型/无骨骼索引 -> 设速度/施力 -> 线/角速度读回零
  下一步进 -> 无残留X速度证明清力 -> 仍受重力，位姿和动作时间保持
  真实VMD自动循环 -> 新增清理调用次数不变
  Chromium原生文件选择 -> 提交前可见进度 -> 模型/动作阶段 -> 成功100%
  缺贴图/损坏VMD -> 错误提示无100% -> 原模型/动作可用
  恢复默认与物理重载 -> 同一进度和清理；无过期进度或页面异常
```

## MMD AR 手动 VMD 切换与继承动作（2026-09-30）

```text
已有声明:
  prepareMotionSwitch、注入runtime实际renderFrame、真实Three.js/Ammo、Chromium文件选择
新增定义:
  MotionTrace { bindingPose, physicsSetup, zeroVelocity, firstFrame, nextFrame }
操作流程:
  解析成功 -> 暂停旧物理 -> 等待Ammo -> 绑定姿态 -> 注册无物理helper -> 世界矩阵 -> 新物理
  初始化helper不得执行update(0)，刚体初始位置等于绑定姿态
  全刚体类型非零线/角速度和残留力 -> 清零且位姿不变，重力随后仍产生运动
  原物理关闭/无刚体 -> 不请求Ammo；播放暂停 -> 保留绑定姿态、动画时间为0
  失败/过期 -> 清理新helper/物理，恢复旧网格/骨骼/表情/IK和原开关
  等待期间帧门控 -> 旧helper不步进、锚点仍更新、重复切换拒绝
  实际renderFrame首帧 -> 动作强制关闭、物理仍步进、角色隐藏
  第二帧 -> 按最新播放开关应用新动作、正常显示；暂停不推进
  自动循环 -> 不新增速度清理或物理实例
  Chromium -> 目录/多选/下拉PMX继承内置VMD；另一个PMX继承本地VMD及名称
  换模型/物理重载 -> 仍可读取继承的动作上下文；关闭动作选PMX -> 无动作
  Chromium前两次真实update -> 物理创建时间0、首帧animation=false、次帧按开关推进
  24次动作+4次模型压力切换 -> 开启/暂停均覆盖，仅当前物理存活，堆与探针有界
  重力缓动数学测试显式使用120ms；浏览器存储显式测试值，不依赖默认参数
```

## MMD AR 完整重力方向与锚点过滤（2026-09-30）

```text
已有声明:
  THREE 四元数、真实 IMU 屏幕转换、网页控制器注入、Chromium 本地资源用例
新增定义:
  GravityFixture { referenceBeta, inputBeta, deadZoneDegrees, smoothingMs, rotations }
操作流程:
  小角度连续输入 -> 不越死区则保持 -> 慢转越界后接受完整目标
  60Hz 与 120Hz 按时间更新 -> 相同收敛 -> 最终精确等于接受目标
  居中/关闭强制单位旋转 -> 绕过死区 -> 手动目标保持
  两参数为0 -> 即时完整角度；降低死区 -> 重新接受最新原始输入
  加载实际 IMU 与注入控制器 -> 首次归零 -> 忽略旧灵敏度存储与 alpha
  无效倾斜忽略 -> 坐标变化重建参考 -> 迟到权限无法重新开启
  Chromium 加载生成页 -> 新控件默认值 -> 修改参数 -> 保存 -> 合成倾斜事件
  小抖动保持目标 -> 30度输入得到30度目标 -> 居中清零
  本地模型/物理重载 -> 独立重力参数仍保留 -> 无页面异常
```

## MMD AR 网页本地资源选择（2026-09-30）

```text
已有声明:
  Node test runner、Chromium、生成 web-dist、构建校验过的 PMX/贴图/VMD
新增定义:
  LocalAssetFixture { pmxFile, textureFiles, vmdFile, invalidVmd }
  LocalAssetResult { ready, modelUrl, motionUrl, motionProgress, error, requests }
操作流程:
  目录索引及平铺索引 -> 检查相对路径、大小写、唯一名称回退、重复/歧义/越界
  注册文件 -> 创建对象 URL -> 读取文件 -> 释放 -> 原 URL 和旧映射均不可复用
  生成网页 -> 本地 HTTP 按正确 CSS/ESM MIME 服务深层目录 -> Chromium 打开
  原生 file input 选择真实 PMX 与贴图 -> 就绪且地址属于当前会话
  选择真实 VMD -> 进度可读 -> 暂停后进度冻结
  选择损坏 VMD 或缺贴图 PMX -> 错误提示 -> 原模型/动作仍就绪
  物理重载 -> 本地模型/动作仍可读取
  恢复默认动作 -> 当前本地模型保持；恢复默认模型 -> 内置 profile 生效
  页面异常与本地虚拟路径的 HTTP 请求均为空
  收集结果 -> 关闭浏览器和 HTTP 服务 -> 删除本用例创建的临时损坏 VMD
```


## 概述

自测功能用于验证系统各模块是否正常工作，包括基础功能测试、播放控制测试、画面控制测试等。

## 数据结构

### 测试结果

```javascript
{
    testResults: {
        passed: number,     // 通过数量
        failed: number,     // 失败数量
        skipped: number,    // 跳过数量
        total: number       // 总数量
    },
    results: [{
        id: string,         // 测试ID
        name: string,       // 测试名称
        category: string,   // 测试分类
        description: string,// 测试描述
        success: boolean,   // 是否成功
        message: string,    // 结果消息
        details: string,    // 详细信息
        timestamp: string   // 时间戳
    }],
    lastRun: string         // 最后运行时间 (ISO格式)
}
```

### 待确认消息

```javascript
{
    pendingAcks: Map<string, {
        resolve: Function,      // Promise resolve 函数
        timer: number,          // 超时定时器ID
        commandType: string,    // 命令类型
        displayId: string       // 显示端ID
    }>,
    ackTimeout: 5000            // 超时时间 (毫秒)
}
```

## 核心函数

### waitForAck(commandType, displayId, timeout)

等待显示端确认命令：

```
waitForAck(commandType, displayId, timeout):
    返回 Promise:
        生成 key = displayId_commandType
        设置超时定时器:
            超时后:
                从 pendingAcks 删除 key
                resolve({ success: false, message: '等待确认超时', details: ... })
        
        将 { resolve, timer, commandType, displayId } 存入 pendingAcks
```

### handleAck(data)

处理显示端确认消息：

```
handleAck(data):
    生成 key = data.displayId_data.commandType
    从 pendingAcks 获取 pending
    
    如果 pending 存在:
        清除超时定时器
        从 pendingAcks 删除 key
        resolve({
            success: data.success,
            message: data.success ? '显示端已确认' : '显示端处理失败',
            details: ...
        })
```

## 测试用例

### 基础功能测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| display_connection | 显示端连接测试 | 检查是否有显示端连接 | DisplayList.getDisplays().length > 0 |
| websocket_connection | WebSocket连接测试 | 检查WebSocket连接状态 | ws.readyState === WebSocket.OPEN |

### 播放控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| play_command | 播放命令测试 | 测试播放命令发送并等待显示端确认 | 发送 play 命令，等待 commandAck |
| pause_command | 暂停命令测试 | 测试暂停命令发送并等待显示端确认 | 发送 pause 命令，等待 commandAck |
| volume_control | 音量控制测试 | 测试音量调节 | 发送 volume 命令 |

### 画面控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| fit_mode_contain | 画面填充-适应测试 | 测试适应模式 | 发送 fit: contain |
| fit_mode_height | 画面填充-高度铺满测试 | 测试高度铺满模式 | 发送 fit: height |
| fit_mode_width | 画面填充-宽度铺满测试 | 测试宽度铺满模式 | 发送 fit: width |
| fit_mode_crop | 画面填充-裁剪测试 | 测试裁剪模式 | 发送 fit: crop |
| rotation_0 | 旋转-0度测试 | 测试0度旋转 | 发送 rotation: 0 |
| rotation_90 | 旋转-90度测试 | 测试90度旋转 | 发送 rotation: 90 |

## 命令确认流程

### 显示端发送确认

**public/display.html**:

```
function sendCommandAck(commandType, success, details):
    如果 WebSocket 已连接:
        发送 {
            type: 'commandAck',
            commandType: commandType,
            success: success,
            details: details || '',
            timestamp: Date.now()
        }

消息处理:
    如果 type === 'control':
        handleControl(data)
        sendCommandAck('control', true, data.action)
    
    如果 type === 'tts':
        handleTTS(data)
        sendCommandAck('tts', true, data.action)
    
    如果 type === 'media':
        showMedia(data)
        sendCommandAck('media', true, data.type)
    
    如果 type === 'voiceCommand':
        handleVoiceCommand(data)
        sendCommandAck('voiceCommand', true, data.action)
    
    如果 type === 'reminder':
        handleReminder(data)
        sendCommandAck('reminder', true, data.action)
    
    如果 type === 'restoreState':
        handleRestoreState(data.state)
        sendCommandAck('restoreState', true, 'state restored')
```

### 服务端转发确认

**server.js**:

```
显示端消息处理:
    如果 type === 'commandAck':
        广播到控制端 {
            type: 'commandAck',
            displayId: displayId,
            commandType: data.commandType,
            success: data.success,
            details: data.details,
            timestamp: data.timestamp
        }
```

### 控制端接收确认

**public/js/websocket.js**:

```
handleMessage(data):
    ...
    如果 type === 'commandAck':
        如果 window.SelfTest 存在:
            调用 SelfTest.handleAck(data)
```

## 测试运行流程

```
runAllTests():
    设置 isRunning = true
    重置结果
    
    显示进度界面
    
    遍历所有测试:
        更新进度显示
        执行测试 run()
        记录结果
        更新统计
        
    保存结果到 localStorage
    显示结果界面
    导出 JSON 文件
    
    设置 isRunning = false
```

### 源码契约回归测试同步（2026-09-03）

```
runSourceContractRegressionTests():
    检查 Android ASR 测试 APK 的路由变量按查询字符串拆分
    检查 ASR 网页通过带查询参数的 /api/asr 路由提交音频

    检查正式显示 APK 不复制 GTCRN 资源
    检查 DenoiseModelManager 使用 speech-enhancement 清单和模型下载路由
    检查服务器提供 GTCRN 清单与文件白名单路由

    检查网页 TTS 使用 recoverTtsPlayback 恢复自身 audio 元素
    检查聊天删除单轮按后端选择对应的 runtimeManager 重置会话
    检查 repairMode.password 为字符串且 repairMode.role 为 mainfront
    检查搜索频道按 pi 或 codex Agent 会话设置 ephemeral
    检查语音指令帮助文本传入当前命令集和 topic

    保留 display-native-bridge.test.js 的 DeX 原生触摸/滚轮旧契约失败
    直到明确 DeX 多屏输入桥接的后续处理方案
```

上述契约测试只验证源码中对外可观察的稳定行为和路由，不绑定已经重命名或抽取的内部局部变量。

## 结果存储

测试结果保存在两个地方：

1. **localStorage**: `selfTestResults` 键
2. **JSON 文件**: 自动下载 `self-test-results-{timestamp}.json`

## 消息类型

### commandAck 消息

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 'commandAck' |
| displayId | string | 显示端ID |
| commandType | string | 命令类型 (control/tts/media/voiceCommand/reminder/restoreState) |
| success | boolean | 是否成功 |
| details | string | 详细信息 |
| timestamp | number | 时间戳 |

## MMD AR 物理稳定性（2026-09-30，已验证）

```text
已有声明: 固定vendor、真实Ammo WASM、子步插值、资源池、模型/动作切换
新增定义: StabilityFixture { baselinePhysics, stabilizedPhysics, actualPmx, renderFps, tailRms }
流程:
  同一真实vendor -> 生命周期与子步补丁 -> 基线；再加稳定性补丁 -> 新实现
  有骨骼type2 -> 重力/平移目标/旋转速度 -> 每步端点正确且角度保留，无帧末COM重置
  真实锁定角度关节与旋转扰动 -> type2仍受到角冲量纠错，线性因子0不冻结旋转
  无骨骼type2与type1 -> 仍自由平移，速度不被通用清零
  父骨骼/世界偏移/动作目标 -> 多帧跟随；不足一步 -> 不移动刚体
  真实关节 -> 65Hz保持原ERP；变频刷新六轴一次，静止模拟比较残余
  全频率与多画面帧率 -> 一秒位移接近实际固定步时钟，不丢低频时间
  真实米娅30/65/90/120/180Hz、60FPS静止八秒 -> 比较末一秒低质量角速度RMS
  各Hz修复/基线均降低；180Hz为0.315354至0.094321，限制结论仅该模型/窗口
  异常/循环/复位/切换 -> 保持两帧门控及速度清零边界；池归还与native销毁归零
  本地网页 -> 模型/动作连续切换、实时变频、导入指纹和页面异常回归
结果: 首批82加补充角冲量1、本地资源3，共86项覆盖通过
  实际24次VMD/4次PMX切换 -> native创建32/销毁31/存活1；堆64MiB，无OOM
边界: 不宣称所有PMX或手机观感已验收；不替换求解器或发布外网
```
