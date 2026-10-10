# 独立 MMD-AR：MPL 编译播放实现

## 伪代码（实现前同步）

```text
prepareCompiler:
  读取固定提交与各文件大小/SHA256
  缓存通过校验 -> 复用
  否则下载固定提交文件 -> 验证 -> 原子写入构建缓存
stage(webMode):
  非网页 -> 返回
  将编译器/许可证/来源清单复制到版本目录
  给 Worker、UI 和共享本地资源注册表添加内容指纹
  在生成 display-mmd 模块末尾导入 MPL UI
  动作面板按同一 webMode 新增 MPL 分类
compileWorker(source):
  去除包裹整段输入的 Markdown fence，检查非空与 UTF8 大小 <=64KiB
  按需初始化 WasmMPLCompiler -> compile(source) -> finally free()
  验证 VMD 头、骨骼帧数量/长度、有限变换值与最长一小时
  所有帧都为0 -> 复制骨骼帧到第30帧并保留其他VMD区段，形成1秒静态保持
  重新验证补帧后的大小/帧数；避免Three循环零时长除零
  返回独立 ArrayBuffer、骨骼名、帧数、时长（VMD 30fps）
compileAndPlay:
  要求 PMX 就绪且不是编辑/Blender模式
  捕获 mesh/modelUrl/当前动作，保存当前播放开关
  创建 Worker，30秒超时后 terminate；停止可取消尚在编译的 Worker
  编译结果返回 -> 再验证模型/动作未变化
  检查实际 PMX 骨骼匹配，零匹配拒绝，部分缺失提示
  生成 File(.vmd) -> createLocalMotionSelection -> loadSelectedMotion
  加载失败 -> 释放新资源，沿用播放器回滚；不改变旧动作/开关
  加载成功 -> 保留第一份原动作；启用播放；替换旧 MPL 引用
restore:
  只有同一模型且当前 motionUrl 为本会话 MPL 才加载原 motionUrl/id
  成功后恢复原播放开关并释放不再使用的 MPL File/URL
  原动作若是换模型时继承的另一份 MPL，也保留其注册上下文直到恢复/放弃
  当前选择已改变 -> 清除会话，不修改新选择
download:
  最近成功生成的 VMD 字节 -> Blob -> 临时URL -> 触发下载 -> 回收URL
pagehide:
  BFCache保留资源；真正离开 -> 取消 Worker、清理定时器、释放全部会话
```

## 文件

- `3rd/mmd-ar-test/web-mpl-build.js`：固定上游来源、缓存校验、构建注入及可单独准备编译器。
- `3rd/mmd-ar-test/web-mpl-worker.mjs`：WASM 编译和 VMD 骨骼元数据校验。
- `3rd/mmd-ar-test/web-mpl-ui.mjs`：输入、取消、资源注册、播放恢复、下载和错误状态。
- `build.js`、`web-panel-groups.js`：仅 WEB_MODE 创建分组与加载 UI。
- `package.json`：新增准备命令，不增加正式生产依赖。

## 状态与限制

当前固定编译器的MPL姿势/动画只输出骨骼帧，Morph帧列表为空。2026-10-10只读解析网页米娅PMX：29个Morph均为type=1（顶点），panel=3/2/1数量分别12/11/6；尚未实现MPL表情语法或VMD Morph帧注入。

输入64KiB，VMD输出8MiB，骨骼帧最多70,000条，30秒编译超时；部分骨骼匹配也可播放。按原模型方式播放，不增加新的物理参数。长时间线不能把 `main` 中多个动画理解为自动串行，上游使用各动画的绝对时间。构建校验可执行，自动/浏览器测试未在本轮执行。
