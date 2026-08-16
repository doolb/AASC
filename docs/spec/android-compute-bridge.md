# Android 显示端 GPU Compute 桥实现文档（伪代码）

## 桥接口（window.NativeDisplay.compute）

APK 通过 `addJavascriptInterface` 注入，display.html 探测到 `window.NativeDisplay` 后新增 `compute()` 能力。

```
compute(requestJson) -> String JSON           # 同步返回，内部后台线程执行 GL + CountDownLatch 超时
```

### 请求协议（requestJson）

```
{
  shader: String              # GLSL ES 3.10 compute shader 源码
  workgroupSize: [x,y,z]      # 缺省 [64]，自动补到 3 维
  count: Number | null        # 线程总数，与 dispatchSize 二选一
  dispatchSize: [x,y,z] | null # 直接指定 dispatch 尺寸
  buffers: [                  # 多个 SSBO 数据缓冲（可选）
    { binding: Number?, data: Number[], readback: Boolean }
  ]
  images: [                   # 多个 image2D（可选，至少一个 buffer/image）
    { binding: Number?, width, height, readback: Boolean, format: ImageFormat }
  ]
}
```

> binding 统一编号：可显式指定；缺省时 buffers 和 images 共享同一个 nextBinding 计数器
> （从 0 递增，显式 binding 会把计数器推到 binding+1，之后缺省的继续往后排），
> 并非"images 从 buffers.length 递增"。
> readback:true 才回传结果，false 仅作为输入/中间存储。
>
> ImageFormat 枚举（GLES 3.1 storage image，读回像素类型随格式）：
>   rgba32f  → GL_FLOAT（float32，默认）
>   rgba16f  → GL_FLOAT（half float）
>   r32f     → GL_FLOAT（单通道 float）
>   rgba8    → GL_UNSIGNED_BYTE（归一化 uint8）
>   rgba8ui  → GL_UNSIGNED_BYTE（uint8 整型）
>   rgba32ui → GL_UNSIGNED_INT（uint32 整型）
>
> 真机限制：rgba32f 等浮点 storage image 在 GLES 3.1 需要 readonly/writeonly 限定，
> 通用 read-write image2D 会编译失败（"unsupported format on read/write image"）。
> shader 需按读写方向加限定（只写 writeonly、只读 readonly）。

### 响应协议

```
成功: {
  buffers: [Number[]]   # 每个 readback:true 的 buffer 对应一个数组，顺序与声明一致
  images:  [ { dataUrl, width, height, format } ]  # 每个 readback:true 的 image 对应一个
  ms: Number
  error: null
}
失败: { error: String }
```

## ComputeEngine（Kotlin）

```
class ComputeEngine {
  init:
    // 离屏 EGL 3.1 上下文，无 surface
    display = eglGetDisplay(EGL_DEFAULT_DISPLAY)
    eglInitialize(display)
    // 注意：EGL_CONTEXT_CLIENT_VERSION=3 只会拿到 3.0（无 compute shader）；
    // 必须用 KHR 大/小版本属性组合取 3.1（EGL_CONTEXT_MAJOR_VERSION_KHR=3 + EGL_CONTEXT_MINOR_VERSION_KHR=1）
    context = eglCreateContext(display,
      EGL_CONTEXT_MAJOR_VERSION_KHR=3, EGL_CONTEXT_MINOR_VERSION_KHR=1)
    // 在 GL 线程 makeCurrent（无 surface，纯计算）
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, context)

  compute(request) -> JSON:
    try:
      // 1. 编译 shader
      shaderId = glCreateShader(GL_COMPUTE_SHADER)
      glShaderSource(shaderId, request.shader)
      glCompileShader(shaderId)
      if !glGetShaderiv(shaderId, GL_COMPILE_STATUS):
        return error(编译日志)

      programId = glCreateProgram()
      glAttachShader(programId, shaderId)
      glLinkProgram(programId)
      if !linkStatus:
        return error(链接日志)

      // 2. 上传输入 SSBO（按 binding）
      for each buffer in request.buffers:
        bufId = glGenBuffers()
        glBindBuffer(GL_SHADER_STORAGE_BUFFER, bufId)
        glBufferData(... buffer.data 转 Float32 ...)
        glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 解析后的 binding, bufId)

      // 2b. 分配 image2D（按 binding，internalFormat 由 format 映射）
      for each image in request.images:
        texId = glGenTextures()
        glBindTexture(GL_TEXTURE_2D, texId)
        glTexStorage2D(GL_TEXTURE_2D, 1, format→internalFormat, image.width, image.height)
        glBindImageTexture(解析后的 binding, texId, 0, false, 0, GL_READ_WRITE, format→imageFormat)

      // 3. 计算 dispatch 尺寸
      // count 模式仅按 x 维向上取整（1-D）：dispatch = [ceil(count / workgroupSize[0]), 1, 1]
      dispatch = request.dispatchSize
        ? request.dispatchSize
        : [ceilDiv(request.count, request.workgroupSize[0]), 1, 1]

      // 4. 执行
      glUseProgram(programId)
      glDispatchCompute(dispatch.x, dispatch.y, dispatch.z)
      glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT | GL_SHADER_IMAGE_ACCESS_BARRIER_BIT | GL_BUFFER_UPDATE_BARRIER_BIT)

      // 5. 读回（按 readback:true，顺序与声明一致）
      results.buffers = []
      for each buffer where readback:
        glBindBuffer(...)
        ptr = glMapBufferRange(GL_MAP_READ_BIT)
        拷贝 Float32 → results.buffers.push(数组)
        glUnmapBuffer(...)

      results.images = []
      for each image where readback:
        绑定纹理到 FBO → glReadPixels(像素类型由 format 映射: FLOAT / UNSIGNED_BYTE / UNSIGNED_INT)
        → ComputePixels.toArgb: 行翻转(glReadPixels 自底向上 → 自顶向下) + 各格式归一化 → IntArray(0xAARRGGBB)
        → Bitmap.setPixels(注意字节序，不能 copyPixelsFromBuffer 否则 R/B 通道互换)
        → 转 PNG dataUrl
        results.images.push({dataUrl, width, height, format})

      return { buffers: results.buffers, images: results.images, ms, error:null }

    catch (timeout / GL error):
      return { error: "..." }
    finally:
      释放 shader/program/buffer/texture 资源
}
```

## NativeBridge.compute（Kotlin，新增方法）

```
@JavascriptInterface
fun compute(requestJson: String): String:
  latch = CountDownLatch(1)
  result = "{\"error\":\"timeout\"}"
  glThread.execute:
    result = ComputeEngine.compute(parse(requestJson))
    latch.countDown()
  latch.await(5, SECONDS)   # 超时兜底
  return result

# 错误序列化必须用 JSONObject().put("error", ...)，不能字符串插值拼 JSON：
# GL 编译日志含引号/换行，插值会破坏 JSON（真机复验 bad shader → 合法 {"error":...}）
```

> 线程模型：GL 调用全部在单一 GL 线程串行执行，避免并发访问 EGL 上下文。
> JS 线程进入后阻塞等待，返回 JSON（沿用 takeScreenshot 的同步模式，
> 因 WebView 里 JS 回调函数不可靠）。

## JS 封装（NativeCompute）

```
class NativeCompute:
  constructor({shader, workgroupSize=[64], count, dispatchSize, buffers, images}):
    this.params = 上述参数
    this.available = window.NativeDisplay != null

  async dispatch() -> Promise<结果>:
    if !available: throw "compute 桥不可用"
    if count != null && dispatchSize != null: throw "count 与 dispatchSize 互斥"
    // 归一化：storage buffer 的 data 常为 TypedArray（Float32Array），JSON.stringify 会把它
    // 序列化成 {"0":..} 对象而非数组，需先 ArrayBuffer.isView(data) → Array.from 转普通数组
    buffers = this.buffers.map(b => ({...b, data: isView(b.data) ? Array.from(b.data) : b.data}))
    json = JSON.stringify({shader, workgroupSize, buffers, images, count?, dispatchSize?})
    try:
      raw = window.NativeDisplay.compute(json)
      return JSON.parse(raw)         # JSON.parse 包 try-catch，失败统一报 "compute 执行失败"
    catch e:
      throw "compute 执行失败: " + (e.message || e)
```

## 与 threejs WebGPU compute 的映射

```
threejs compute(node, count, workgroupSize)  →  NativeCompute({shader, count, workgroupSize})
ComputeNode.workgroupSize [X,Y,Z]             →  layout(local_size_x..z) in; + workgroupSize 字段
ComputeNode.count（线程总数自动算 dispatch）   →  count 字段 → ceil(count/ws)
ComputeNode.dispatchSize                      →  dispatchSize 字段（与 count 互斥）
instanceIndex                                 →  gl_GlobalInvocationID
storage buffer                                →  SSBO (std430)
storage texture / imageStorage                 →  image2D (rgba32f 等, imageStore/imageLoad)
```
