# Node子显示端填充改用panscan

状态：用户已确认，源码、自动测试及隔离Linux真实画面验证完成；Windows实机待验收。

- 任务描述：用户反馈mpv画面填充无效，建议使用panscan。将适应/铺满/动态改为原生属性方式，保持常驻、旋转及原TTS。
- design需求：见 `docs/design/node-display-mpv.md` 的原生panscan段，窗口和媒体尺寸不可用时仍可下发contain/cover/动态控制。
- spec设计：见 `docs/spec/node-display-mpv.md` 的L4流程，原生模式清除旧缩放/平移，crop保留百分比矩形逻辑。
- 受影响模块：已修改 `src/apps/voice-display-node/mpv-player.js` 与必要的几何模式选择，更新专项/真实mpv测试、使用/自测文档和实际受影响的发布状态。
- 自测用例：contain读回0、cover读回1、dynamic中间值与端点；缺少尺寸时三原生模式可应用；height/width横竖比和四方向；crop切换清除残留；重连恢复/崩溃重建、清空/退出无旧动态更新。
- 兼容性：Linux/Windows mpv原生属性，video-unscaled关闭、keepaspect开启；原TTS命令和常驻PID、音频媒体行为不变。
- 性能：单动态调度器、最多20Hz、逐次等待IPC，基础原生模式减少几何依赖；目标机实际渲染另验。
- 风险评估：Windows现场根因尚未定位；panscan受输出驱动支持与video-unscaled影响；自定义crop不能用单个panscan值表达。以属性复位、回执检查及实际画面验收处理。
- 预计工时：约1～2小时实现与自动验证，目标Windows实机另计。
- 完成验证：专项17/17、真实mpv null输出1/1、隔离Xvnc真实画面1/1通过。四方向contain边缘黑色、cover边缘绿色且PID保持；窗口/媒体比例、动态中间值、缺尺寸、旧mpv无scale与裁剪切换覆盖。首轮Xvnc夹具因无接入端点启动失败，改为私有Unix socket后通过；未用失败结果冒充成功。
- 关联任务：配置错误显式ERROR方案继续保留在 `20261022_Node子显示端配置错误显式报错.md`，不因本需求而取消。

- 回归与发布：语音/重连28/28、独立包22/22通过；Node独立包状态保持true，无新增生产依赖、未构建发布本轮包。完成实现项从todo删除，Windows现场任务保留。
