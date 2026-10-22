# Node TTS URL构造器错误

状态：用户确认后修复，源码与自动验证完成；独立包待更新部署。

- 任务描述：修复TTS加入播放队列时报URL is not a constructor。
- design需求：docs/design/node-display-mpv.md对应TTS URL错误章节。
- spec设计：docs/spec/node-display-mpv.md的URL构造器修复伪代码，先修正导入契约，再验证真实类行为。
- 原因：main.js中URL是require(url)模块对象；音频新调用new URL错误；原VM夹具注入全局构造器导致漏检。
- 受影响代码：main.js构造器别名与playAudioFromURL；tests/node-display-mpv.test.js实际导入夹具和音频地址/错误回调回归；同步design/spec/usage/self-test/todo/changelog及Node包状态。
- 自测用例：相对音频路径、绝对HTTP/HTTPS、端口/查询参数、非法URL与非HTTP协议不入队、options保留、onComplete错误仅一次；既有URL.parse连接行为及TTS/ASR消息分支。
- 兼容性：Node内置node:url跨Linux/Windows，不变更系统音频命令或生产依赖；实际设备播报仍需部署后核对。
- 性能：无新增进程/定时器或网络请求，只解析一次音频地址。
- 风险：不能把URL模块直接替换为构造器而破坏旧URL.parse；测试必须包含真实导入，避免全局同名对象遮蔽。
- 预计工时：约15～30分钟完成代码、定向回归和文档。
- 验证结果：新增真实导入测试先在旧代码上失败，修复后npm run test:node-display-mpv为43/43；语音/重连/Windows输入为22/22，共65项通过。相对/绝对音频路径、端口/参数、三个非法地址/协议的一次错误回调、HTTP/HTTPS对应ws/wss连接参数均验证；无实际联网或设备播报。
- 已确认：按方案修复并推送Git，更新独立包待构建状态；不直接构建发布包或改目标配置。

- 完成处理：todo移除修复实现项，保留更新包后的实际报时验收；同步design/spec/usage/self-test/changelog。Node包状态原已为true，继续待构建；不出包、不修改目标配置。
