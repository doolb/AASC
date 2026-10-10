# 独立 MMD-AR 文字口型实现

## 实现前伪代码

```text
panel:
  动作面板加入可折叠口型组：textarea、播放口型、停止、状态、可选嘴型映射
preparePinyin:
  固定pinyin-pro 3.29.5 npm归档SHA-512完整性，保留完整ESM依赖树/LICENSE
  缓存校验通过复用，否则下载固定版本并校验后原子写入
  安全读取归档普通文件，复制ESM树至独立vendor版本目录，附MIT许可证与逐文件大小/SHA256来源清单
stageRuntime(webMode):
  非网页不改
  只扩展生成mmd-expressions副本：增加临时权重Map
  apply按manual -> transient优先级合并，保存每项真实VMD基线
  before还原上一帧并让动画更新；物理前/帧末应用合并覆盖
  setTransient(token,pairs):校验当前token、支持索引、有限权重后批量更新
  临时更新仅启动渲染，不逐帧清空TAA历史；clear恢复VMD/手动值
  bind新mesh或dispose清除临时层
  在生成runtime/display增加临时口型API，正式src不增加此API
  timeline与UI、runtime静态引用、display入口按实际内容添加指纹
buildTimeline(text):
  UTF8 <=4KiB，最多400字符，空文本/无发音字符报错
  首次播放动态导入本地pinyin-pro
  中文连续片段按上下文转拼音，逐字生成音节
  拉丁拼写按元音近似；数字按中文读音展开；标点/空白生成不同停顿
  每音节约250ms，元音分段平滑峰值，闭唇辅音添加闭合
  尾部补闭嘴，限定总时长，未知字符/读音计数并提示
sample(t):
  根据真实elapsed选音节并给五元音计算smoothstep开合与相邻过渡
  缺失元音回退可用映射，重复映射同一index取最大值
  全部映射包含0权重，静音/标点/尾部真正闭嘴，不沿用VMD张嘴
UI.play:
  捕获当前PMX token、映射与输入序号
  异步准备timeline后再校验token和请求序号，不能迟到覆盖停止/换模型
  仅播放期间requestAnimationFrame按performance.now更新临时层
  正常结束/停止/错误/切模型/后台/真正离页 -> 取消raf、清临时层恢复
  不调用loadSelectedMotion，不改变播放开关，不创建音频或麦克风
UI.modelSync:
  低频同步模型token，重新生成映射选项，保留同模型用户映射
  不匹配/编辑或模型加载时禁用；模型变化停止并重新匹配
```

## 待验收

米娅A/I/U/E/O及带空格名称、中文多音字/标点/数字/拼音、0权重与停止恢复、手动表情/VMD/MPL同播、换模型/物理重载/后台/连续点击、桌面与Android的性能和实际视觉。本轮不新增或运行测试。

## 实现结果与细节

- 新增web-lipsync-build/ui/timeline；独立WEB_MODE面板与分组接入。模型原名/索引控制，别名仅用于默认匹配；米娅「い 」尾随空格可以识别但实际索引保持不变。重名不猜选，五种映射均可手工选择。
- 字典使用固定npm归档SHA-512校验和安全普通文件读取，保留29文件ESM依赖树及LICENSE，SOURCE.json记录逐文件大小/SHA-256。运行时不访问CDN。新增prepare:mmd-ar-lipsync，只影响准备命令，不增加npm生产依赖。
- 仅生成mmd-expressions副本增加transient Map，合并顺序manual→transient，覆盖mapped嘴型的0权重也参与；物理前/帧末仍走原共享恢复机制。临时更新只启动渲染，不逐帧清空TAA；clear和换mesh清理临时层。生成runtime/display提供setLipSyncExpressions(token,pairs)，正式src没有此API。
- input上限400码点/4KiB，约260ms一个中文音节，句末400ms/逗号200ms/其他80ms停顿；数字逐位中文读音，ü近似U/I组合，b/p/m先闭合。smoothstep插值，尾部补120ms闭嘴；拉丁拼写和未知汉字明确近似提示。
- 播放按真实elapsed推进临时Morph，不调用loadSelectedMotion/setMotionPlaybackEnabled或物理reset。停止、异常、换模型/编辑、后台、pagehide释放；旧异步字典失败通过generation保护，不能停止后来开始的新预览。模型同步只在动作面板显示时500ms轮询，播放帧同时校验模型token。

资源准备与web-dist重建成功；5源文件语法、34生成模块语法/相对依赖/指纹、30固定资源大小/SHA-256和差异空白检查通过。后续已发布外网，45项HTTPS大小/SHA-256检查通过。本轮未新增或运行自动/浏览器测试，未执行实际拼音/口型播放；实际设备观感待验收。Offline状态沿用此前正式表情/MPL迁移的待出包状态，本轮未增加正式口型功能。
