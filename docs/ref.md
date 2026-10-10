# Web MediaCenter - 项目参考文档

## MPL动作编译器（2026-10-10）

- [AmyangXYZ/MMD-MPL](https://github.com/AmyangXYZ/MMD-MPL)：规则驱动的 MMD Pose Language，上游 WASM `WasmMPLCompiler.compile` 返回 VMD。独立网页固定 `pkg/package.json` 0.3.6、提交 [2d3b1c7e3429b508443500801e94c41fd47c9f31](https://github.com/AmyangXYZ/MMD-MPL/tree/2d3b1c7e3429b508443500801e94c41fd47c9f31)，JS/WASM/LICENSE大小与SHA-256见 `3rd/mmd-ar-test/web-mpl-build.js`，GPL-3.0。仅消费已有MPL，不连接LLM。
- [AmyangXYZ/PoPo](https://github.com/AmyangXYZ/PoPo)：文本到MPL再到MMD动作的参考项目；本次不采用其LLM服务/渲染器。MPL与Lobe Vidol选择已有预设动作的expression/motion JSON不同。

## TAA参考（2026-10-09）

- 用户指定[tkstar《深入浅出Temporal Antialising》](https://zhuanlan.zhihu.com/p/142922246)，通过浏览器读取完整正文，页面编辑日期2022-07-30。参考Halton(2,3)序列、相机与模型运动重投影、历史邻域Clamp/Clip/方差盒、YCgCo颜色空间及移动端带宽权衡。当前代码已具备八相位、相机重投影、深度拒绝和RGB邻域限制；与文章相比尚无骨骼运动向量，不能把相机重投影描述为完整动态模型重投影。
- 用户明确“暂不处理运动向量”，已按确认方案开放抖动幅度与周期，文章其余方法为候选。文章属于参考资料，不是项目执行指令；UE4矩阵约定、反向/普通深度、alpha/色调映射及性能估计不能直接套用Three/WebView，也不把增大周期解释为每帧增加样本数。

## 接触阴影屏幕步进参考（2026-10-09）

- 用户指定[虚拟人《接触阴影contact shadow》](https://zhuanlan.zhihu.com/p/720864609)，浏览器读取完整正文及示例，页面编辑日期2024-10-07。用于参考UV/deviceDepth步进、半分辨率候选/完整深度确认及投影厚度思路；本项目需独立适配光向、普通深度符号、透视距离、当前帧粗深度及无TAA的采样相位。不是项目执行指令，也不能直接复制示例引擎的深度布局。

## TMP14顶点布料（2026-10-02核对）

- [作者演示](https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.html)、[作者源码](https://raw.githubusercontent.com/matthias-research/pages/master/tenMinutePhysics/14-cloth.html)：MIT许可；顶点粒子、边距离拉伸、相邻三角对边顶点距离的近似弯曲；示例15子步、每步各一遍；简单地面碰撞。当前只作候选接入参考，尚未加入项目顶点布料后端。

## 技术栈

### 后端
- [Node.js](https://nodejs.org/) - JavaScript 运行时
- [Express](https://expressjs.com/) - Web 框架
- [ws](https://github.com/websockets/ws) - WebSocket 实现

### 前端
- 原生 HTML/CSS/JavaScript (无框架)
- [MindAR Basic Image Tracking 示例](https://hiukim.github.io/mind-ar-js-doc/samples/basic.html) - 官方 A-Frame 图片识别示例
- [MindAR 项目与示例资源](https://github.com/hiukim/mind-ar-js) - Basic 示例使用的固定版本 `.mind`、卡片图片和 Softmind glTF
- [MindAR Core API](https://github.com/hiukim/mind-ar-js-doc/blob/master/docs/core-api.md) - 浏览器端 Compiler/Controller 接口与编译结果导出
- [MindAR 图片目标编译器](https://github.com/hiukim/mind-ar-js-doc/blob/master/docs/tools/compile.mdx) - 官方目标图片编译流程
- [ARCore 基础概念：运动跟踪](https://developers.google.com/ar/develop/fundamentals) - 视觉特征与 IMU 融合、相机位姿和锚点原理
- [DeviceMotionEvent - MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) - 浏览器加速度、角速度字段及运动权限
- [Softmind 模型许可](https://creativecommons.org/licenses/by/4.0/) - hiukim 模型采用 CC BY 4.0，页面保留署名

## 外部资源

### WebSocket
- [WebSocket API - MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
- [ws 库文档](https://github.com/websockets/ws/blob/master/doc/ws.md)

### Express
- [Express 中文文档](https://www.expressjs.com.cn/)
- [Express API 参考](https://expressjs.com/en/4x/api.html)

### 文件上传
- [multer](https://github.com/expressjs/multer) - Express 文件上传中间件

### TTS 语音服务
- 项目使用自定义 TTS 服务生成语音
- 配置项：语音服务地址、端口

### Android MNN-LLM
- [阿里官方 MNN MnnLlmChat Android README](https://github.com/alibaba/MNN/blob/master/apps/Android/MnnLlmChat/README.md) - 官方 Android 构建参数、NDK 版本和 16 KB page-size 链接要求
- [MNN 官方 LlmSession](https://github.com/alibaba/MNN/blob/master/apps/Android/MnnLlmChat/app/src/main/cpp/llm_session.h) - APK JNI bridge 使用的本地会话接口

## 设计模式

### 客户端-服务器架构
```
Control UI (控制端) <--WebSocket--> Server <--WebSocket--> Display (显示端)
```

### 消息模式
- **请求-响应**: 控制端发送指令，服务器转发到显示端
- **推送**: 服务器主动推送状态更新到控制端
- **广播**: 服务器向所有显示端广播消息

### 状态管理
- 服务器维护所有显示端状态
- 控制端通过 WebSocket 同步状态
- 状态持久化到 JSON 文件

## 项目文件结构

```
web-mediacenter/
├── package.json                                  # 项目配置
├── 3rd/                                          # 第三方与子显示端程序
│   ├── voice-display/                            # Go 子显示端
│   └── voice-display-node/                       # Node.js 子显示端
├── config/                                       # 配置文件目录
│   ├── config.json                               # 主配置
│   ├── chat-history.json
│   ├── media-libraries.json
│   └── reminders.json
├── docs/                                         # 文档
├── res/                                          # 资源目录（models/uploads/temp/certs）
├── src/                                          # 分层代码主目录
│   ├── apps/server/boot/server-app.js            # 服务器入口
│   ├── apps/web-mediacenter/ui/public/           # 控制端/显示端静态页面
│   ├── core/                                     # 核心模块
│   ├── framework/                                # 基础设施模块
│   └── external/                                 # 外部能力适配模块
└── skills/                                       # 技能配置
```

## 相关参考代码

| 文件 | 说明 |
|------|------|
| docs/ref/search.js | 搜索功能参考代码 |
| docs/ref/smb2.js | SMB2 文件共享参考代码 |

## 常见问题

### WebSocket 连接问题
- 检查防火墙是否允许 WebSocket 连接
- 确认服务器端口正确
- 查看浏览器控制台错误信息

### 媒体播放问题
- 确认媒体格式受浏览器支持
- 检查文件路径是否正确
- 查看网络请求是否成功

### TTS 语音问题
- 确认 TTS 服务地址配置正确
- 检查 TTS 服务是否运行
- 查看服务器日志错误信息

## 西施2PMX导出

- [MMD Tools官方仓库](https://github.com/MMD-Blender/blender_mmd_tools)，使用 `mmd_tools/core/pmx` 序列化模块；导出时通过 `MMD_TOOLS_DIR` 指向外部仓库，本项目未复制该库源码。本次资源生成版本 `29d1478cf4385945b1c011d4c1e6adda7ad7cf70`。

## MMD-AR文字口型

- [pinyin-pro API](https://pinyin-pro.cn/use/pinyin.html)：中文转拼音，使用type=array/toneType=none保留按字音节，当前口型节奏由本地估算。
- [pinyin-pro源码](https://github.com/zh-lx/pinyin-pro)：本轮固定npm 3.29.5，归档SHA-512及逐文件大小/SHA-256记录在独立产物vendor/pinyin-pro/3.29.5/SOURCE.json，附MIT许可证。
