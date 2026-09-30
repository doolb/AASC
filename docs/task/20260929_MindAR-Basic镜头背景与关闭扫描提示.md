# MindAR Basic 镜头背景与关闭扫描提示

## 任务与方案

用户要求去掉丢失定位时的扫描提示，并默认以镜头画面作为背景。通过 index.html 的 uiScanning:no、renderer.alpha:true 和 CSS 视频/场景层级实现。设计及伪代码分别记录于 docs/design/mindar-basic-web.md 和 docs/spec/mindar-basic-web.md。

## 影响文件

3rd/mind-basic/index.html、mind-basic.css、README.md 及相关文档。复用 MindAR 管理的视频尺寸、投影与摄像头生命周期。

## 验证与兼容性

核对固定 MindAR 1.2.5 的 uiScanning:no 禁用逻辑及视频初始层级；运行原有 Chromium 页面回归；在浏览器中检查实时视频层级、透明场景、模型/面板层级。真实 Android 摄像头首锁/失锁观感待验收。

## 性能与风险

只改变初始化配置与 CSS，不增加视频流、帧回调或视觉计算。需要保持 MindAR 的视频尺寸与相机投影同步，不能额外覆盖裁剪或拉伸。

## 预计工时

约 20 分钟；手机验收另计。

## 执行结果

本地修改完成。原有定向测试 9/9 通过，另经真实 MindAR UI 类及 Chromium DOM/CSS 验证无扫描遮罩、背景/场景/面板分层正确；差异检查通过。尚未发布外网，Android 真机验收列于 todo。
