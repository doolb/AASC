# Android 显示端 GPU Compute 桥（GLES 3.1 离屏计算）设计文档

## 概述

在现有 `android-display` APK 的原生桥（`NativeBridge`）上新增一个 `compute()` 方法，用**离屏 EGL 3.1 上下文**执行 GLES compute shader，把计算结果（数值或图像）回传给 display.html 里的 threejs 使用。

核心价值：为 threejs 提供它自身拿不到的**真 compute shader**（线程组内 `shared` 内存 + `barrier()` 同步的协作/归约类并行计算），因为 WebView 的 WebGL（GLES 3.0）不支持 compute，而 WebGPU 依赖设备 WebView 版本不可控。

## 需求背景

### 现状问题

| 问题 | 根因 |
|------|------|
| threejs 需要协作/归约类 GPU 并行计算（前缀和、归约、矩阵乘、排序） | WebGL fragment shader（GPUComputationRenderer）每个 fragment 独立，无法组内共享 + barrier 同步 |
| WebGPU compute 不可靠 | 依赖设备 WebView 版本，老设备不支持 `navigator.gpu` |
| 需要 JS 动态定义计算任务 | 固定内核无法覆盖 threejs 侧的灵活需求 |

### 目标

1. JS 可动态传入 GLSL ES 3.10 compute shader 源码，原生运行时编译执行
2. 计算结果支持两种回传：数值（`Float32Array`）/ 图像（纹理读回，供 threejs 做纹理）
3. 接口命名与语义对齐 threejs WebGPU compute（`compute`/`computeKernel`/`ComputeNode`），降低学习成本

### 约束

- 显示端设备：Android 7+（GLES 3.1 需要 API 21+，现有 APK minSdk=24 已满足）
- 定位：低频、批量的计算任务，**非每帧**（数据需跨 GL 上下文经 CPU 搬运）
- shader 语言用 **GLSL ES 3.10**（WebView 的 WebGL 无法跑 WGSL/TSL，底层映射等价）
- display.html 零改动；JS 侧新增封装类，桥是增量方法
- 不做场景渲染引擎、不做叠加层显示（纯离屏计算）

## 核心架构

```
┌─ APK 内 WebView ─────────────────────────────────────┐
│  display.html（threejs）                              │
│   └─ NativeCompute（JS 封装，对齐 threejs compute）    │
│        └─ window.NativeDisplay.compute(requestJson)    │
└──────────────────────────────────────────────────────┘
         │ @JavascriptInterface，同步返回（CountDownLatch）
         ▼
┌─ NativeBridge（现有，新增 compute()）─────────────────┐
│  后台线程执行 GL + 超时兜底（沿用 takeScreenshot 模式） │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌─ ComputeEngine（新增 Kotlin）─────────────────────────┐
│  离屏 EGL 3.1 上下文（无 surface，纯计算）             │
│   ├─ 编译 compute shader → SSBO 输入 → glDispatchCompute│
│   ├─ 读回模式1（数值）: glMapBufferRange → Float32Array │
│   └─ 读回模式2（图像）: 结果纹理 → 图像数据            │
└──────────────────────────────────────────────────────┘
```

## 桥接口协议

### NativeBridge.compute(requestJson) → String JSON

```js
const result = await nativeCompute({
  shader: `#version 310 es
    layout(local_size_x = 64) in;
    layout(std430, binding = 0) buffer Data { float v[]; } data;
    layout(rgba32f, binding = 1) uniform highp image2D img;
    void main() {
      uint i = gl_GlobalInvocationID.x;
      data.v[i] = data.v[i] * 2.0;
      ivec2 p = ivec2(gl_GlobalInvocationID.xy);
      imageStore(img, p, vec4(data.v[i]));
    }`,
  workgroupSize: [64],          // ↔ ComputeNode.workgroupSize
  count: n,                     // ↔ ComputeNode.count（线程总数，自动算 dispatch）
  // 或 dispatchSize: [x, y, z] // ↔ ComputeNode.dispatchSize（与 count 二选一）
  buffers: [                    // 多个 SSBO 数据缓冲（可选）
    { binding: 0, data: [1,2,3,...], readback: true  },  // 读回
    { binding: 2, data: [...],        readback: false },  // 仅输入，不读回
  ],
  images: [                     // 多个 image2D（可选，至少一个 buffer/image）
    { binding: 1, width: 512, height: 512, readback: true,  format: 'rgba32f' },
    { binding: 3, width: 256, height: 256, readback: true,  format: 'rgba8' },
    { binding: 4, width: 128, height: 128, readback: false, format: 'rgba16f' },
  ]
});
```

**binding 规则**：`binding` 为 GLSL `layout(binding=N)` 的统一编号，可显式指定；缺省时 `buffers` 与 `images` 共享同一个 `nextBinding` 计数器从 0 递增（显式 binding 会把计数器推到 binding+1，之后缺省的继续往后排）。显式指定优先。

**image 支持的格式**（`format` 字段，映射到 GLES 3.1 storage image 格式）：

| format | GLSL image 限定符 | 通道类型 | 读回像素类型 | 用途 |
|--------|------------------|---------|-------------|------|
| `rgba32f` | `layout(rgba32f)` | float32 | `GL_FLOAT` | 浮点 compute 输出（默认） |
| `rgba16f` | `layout(rgba16f)` | half float | `GL_FLOAT` | 半精度浮点，省带宽 |
| `r32f` | `layout(r32f)` | float32 单通道 | `GL_FLOAT` | 单通道浮点（如深度/密度场） |
| `rgba8` | `layout(rgba8)` | 归一化 uint8 | `GL_UNSIGNED_BYTE` | 普通图像/颜色 |
| `rgba8ui` | `layout(rgba8ui)` | uint8 整型 | `GL_UNSIGNED_BYTE` | 整数索引/标签图 |
| `rgba32ui` | `layout(rgba32ui)` | uint32 整型 | `GL_UNSIGNED_INT` | 大整数/位掩码 |

> 浮点格式（`rgba32f`/`rgba16f`/`r32f`）读回走 `glReadPixels(GL_FLOAT)`；整型格式（`rgba8ui`/`rgba32ui`）走对应 `GL_UNSIGNED_*`；`rgba8` 走 `GL_UNSIGNED_BYTE`。
> 回传统一编码为 dataUrl（PNG 或 raw bytes + 元信息），`image` 项附带 `format` 供 JS 侧还原。
>
> 真机限制：`rgba32f` 等浮点格式的 storage image 需要 `readonly`/`writeonly` 限定，通用 read-write image2D 在 GLES 3.1 编译失败（"unsupported format on read/write image"）。shader 需按读写方向加限定。

返回：

```js
// 成功（只回传 readback:true 的资源，顺序与其声明顺序一致）
{
  buffers: [[...], ...],       // 每个 readback:true 的 buffer 对应一个数组
  images:  [{ dataUrl, width, height, format }, ...],  // 每个 readback:true 的 image 对应一个
  ms: 8.2,
  error: null
}
// 失败
{ error: "编译日志/超时/GL 错误..." }
```

`buffers` 与 `images` 至少提供一个；`readback:true` 的资源才回传结果，`readback:false` 的仅作为输入或中间计算存储。

## 接口对齐 threejs WebGPU compute（r185）

| threejs（TSL/WebGPU） | 本桥（GLES 3.1） |
|----------------------|-----------------|
| `compute(node, count, workgroupSize)` | `compute({ shader, count, workgroupSize })` |
| `computeKernel(node, workgroupSize)` | 同一入口，`workgroupSize` 字段对齐 |
| `ComputeNode.workgroupSize`（[X,Y,Z]，默认 [64]，自动补 1） | 同上，`workgroupSize` 补到 3 维 |
| `ComputeNode.count`（线程总数，自动 bounds check + 算 dispatch） | 同上，`count` 自动算 `dispatch = [ceil(count/ws[0]), 1, 1]`（仅按 x 维向上取整） |
| `ComputeNode.dispatchSize`（直接指定 [X,Y,Z]） | 同上，`dispatchSize` 与 `count` 二选一 |
| `instanceIndex`（内置变量） | `gl_GlobalInvocationID` |
| storage buffer（`var<storage>`） | SSBO（`layout(std430, binding=N)`） |

## ComputeEngine 关键实现点

1. **离屏 EGL 上下文**：`eglGetDisplay(EGL_DEFAULT_DISPLAY)` → `eglInitialize` → `eglCreateContext(clientVersion=3.1)`，**不创建 surface**（纯 compute 无需渲染到屏）。上下文独立于 WebView 的 WebGL context。注意：`EGL_CONTEXT_CLIENT_VERSION=3` 只能拿到 3.0，必须用 `EGL_CONTEXT_MAJOR_VERSION_KHR=3 + EGL_CONTEXT_MINOR_VERSION_KHR=1` 才拿到 3.1（compute shader 需 3.1）。
2. **运行时编译**：`glCreateShader(GL_COMPUTE_SHADER)` → `glShaderSource` → `glCompileShader` → `glCreateProgram` → `glLinkProgram`；编译/链接失败读取 `GL_INFO_LOG_LENGTH` 日志返回。
3. **SSBO 管理**：`glGenBuffers` → `glBindBuffer(GL_SHADER_STORAGE_BUFFER)` → `glBufferData` 上传输入 → `glBindBufferBase` 绑定到 shader 的 binding 点。
4. **image 管理**：`glGenTextures` → `glBindTexture(GL_TEXTURE_2D)` → `glTexStorage2D` 分配（`rgba32f` 等）→ `glBindImageTexture` 绑定到 shader 的 image binding 点。
5. **执行**：`glUseProgram` → `glDispatchCompute(x,y,z)` → `glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT | GL_SHADER_IMAGE_ACCESS_BARRIER_BIT | ...)`。
6. **读回（buffer）**：`glMapBufferRange(GL_MAP_READ_BIT)` 拷贝 Float32 数据 → `glUnmapBuffer`，按 `readback:true` 的 buffer 顺序收集。
7. **读回（image）**：compute 结果写入 `image2D` storage → 用 FBO 绑定该纹理 → `glReadPixels` 读回像素（自底向上）→ `ComputePixels.toArgb` 行翻转 + 各格式归一化 → `Bitmap.setPixels` 转 PNG/base64 dataUrl（不能 `copyPixelsFromBuffer` 否则 R/B 交换），按 `readback:true` 的 image 顺序收集。
8. **线程安全**：GL 调用全部在单个后台 GL 线程串行执行；`compute()` 从 JS 线程进入后提交到 GL 线程，`CountDownLatch.await(timeout)` 等结果（沿用 `takeScreenshot` 同步模式，因 WebView 里 JS 回调函数不可靠）。

## JS 封装（NativeCompute）

```js
// 对齐 threejs 风格，内部序列化参数 → 调 window.NativeDisplay.compute
class NativeCompute {
  constructor({ shader, workgroupSize = [64], count, dispatchSize, buffers, images })
  async dispatch()  // → 内部 Promise 包装同步桥调用
}
```

## 测试用例

1. **数值冒烟**：输入 `[1,2,3,4,...]`，shader 逐元素 ×2，验证返回 `[2,4,6,8,...]`
2. **图像冒烟**：shader 生成渐变纹理，`images:[{readback:true}]`，验证 dataUrl 尺寸/内容正确
3. **多资源混合**：一个 buffer + 两个 image，验证三者 binding 分配正确、各自按 `readback` 回传
4. **编译失败**：传语法错误 shader，验证 `error` 返回编译日志
5. **超时兜底**：传超大 workgroup，验证 await 超时返回 error
6. **count 与 dispatchSize 互斥**：同时传两者报错

## 风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| 设备 GLES 3.1 不可用（极老设备） | compute 失败 | 初始化检测，返回 error，JS 侧降级 GPUComputationRenderer |
| 数据搬运开销（跨上下文） | 高频任务性能差 | 定位为低频批量任务，文档明示 |
| EGL 离屏上下文在部分 ROM 上失败 | 无法初始化 | 启动时探测，失败时桥返回不可用，不影响截图/输入现有功能 |
| SSBO 大小上限 | 大 buffer 失败 | 返回错误，JS 分批 |

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/apps/android-display/.../ComputeEngine.kt` | 新增：离屏 EGL 3.1 compute 引擎 |
| `src/apps/android-display/.../NativeBridge.kt` | 修改：新增 `compute()` 桥方法 |
| `src/apps/web-mediacenter/ui/public/js/` | 新增 NativeCompute 封装类 + 测试入口 |
