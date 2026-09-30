# 自测功能实现文档

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
