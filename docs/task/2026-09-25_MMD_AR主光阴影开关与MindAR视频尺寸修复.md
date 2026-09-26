# MMD AR 测试网页主光阴影与 MindAR 取帧修复

## 任务描述与设计

- 日期：2026-09-25。范围为 HTTPS MMD-AR 测试网页；不打旧测试 APK 或 Offline 包。
- 主光阴影新增默认开启的独立开关；补光仍可无阴影、复用主光或投射自身阴影。
- MindAR 有摄像头预览但真机未定位，修正 Controller 输入尺寸与 `<video>` 取帧尺寸不一致。
- 需求参考 `docs/design/mmd-ar-test-apk.md` 与 `docs/spec/mmd-ar-test-apk.md`。

## Spec 设计、受影响模块

- 网页构建阶段注入主光阴影开关，置于主光分类标题行；正式显示端与旧 APK 不注入。
- 共用灯光表单只在网页标记存在时读取开关，并用现有 localStorage 配置保存；旧记录默认开启。
- PMX runtime 分别计算主光与补光的 `castShadow`，两者均关闭时禁用阴影图；补光复用主光但主光关闭时不遮挡。
- MindAR 适配层在 `dummyRun/processVideo` 前设置视频元素的 `width/height` 为当前 `videoWidth/videoHeight`。
- 受影响代码：`3rd/mmd-ar-test/build.js`、`web-panel-groups.js`、`display-mmd-ar-benchmark.js`，以及 `display-mmd-lighting.js`、`display-mmd.js`、`display-pmx-runtime.js` 的网页专用分支。

## 自测用例、兼容性与风险

- 合成官方定位图视频输入，确认原始帧尺寸同步、MindAR 有帧输出并能定位；无目标帧不得误报。
- 校验主光开关默认、保存/恢复、与补光三模式组合；浏览器真实 PMX 渲染无 shader 编译错误。
- 兼容正式显示端及旧 APK 的控制 ID 和阴影来源配置；摄像头视频 CSS 尺寸不变。
- 性能：关闭两盏灯阴影应节省阴影图计算；双灯开启仍需真机测帧率。
- 风险：浏览器合成视频与手机摄像头旋转、曝光、对焦不同，真机首锁必须另验；预计工时半天。
