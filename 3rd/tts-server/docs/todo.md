# 未完成任务

- 当前无 Linux TTS 服务化待处理任务；残余 SDK 首次合成 footprint 记录在 `docs/task/2026-08-25_tts-wine-rss-stability.md`。
- 测试 ASR APK 保存当前 WAV 已完成，执行记录见 `docs/task/2026-08-28_测试ASR保存当前WAV.md`。
- 测试 ASR 普通识别固定中文已完成，执行记录见 `docs/task/2026-08-29_测试ASR普通识别固定中文.md`。

## Android YOLO11

- ⏳可选任务 [2026-09-02] 增加带标注验证集的 Precision、Recall、mAP 评估
  - 当前仅完成 `bus.jpg` 单图定性验证，不能据此给出正式准确率；待提供与目标场景匹配的图片和标注后再实现批量评估。

- ⏳待现场验收 [2026-09-11] 在独立 ASR 测试 APK 原生页面使用测试 WAV 完成 Sherpa 声纹注册和三种测试模式回归
  - 模型准备提示（2026-10-12核查）：当前7个内置ONNX中6个已入Git；SenseVoice主模型被忽略，新检出环境可单独通过npm run sync:ai-models恢复（详见usage/ai-model-sync.md）。Offline同步默认不含aimodel；显式`-aimodel`只镜像到静态同级目录，不填充项目`res/models`。此为构建前提说明，不新增模型提交或功能任务。
  - APK 已构建、安装和启动；设备 UI 自动化桥返回空 root，尚未自动完成注册、单段、多段、快速多段及双降噪开关的点击验证。
  - 2026-10-12 已完成 test_wavs 全部7个文件的 Android 原生/网页 ASR 双轮热态对比，以及单个 WAV 大核/小核三轮对比；追加用户标注 `妲已妈妈.wav` 的 Web/大核/小核三轮识别并计算 CER=50%。此项仍只等待声纹注册和三种声纹测试的原生页面按钮验收。详见 task/20261012_AndroidASR原生网页真机对比.md。
  - 2026-09-12 已通过同一 APK 的 HTTPS 测试页面完成三个模型/FP32-INT8 的单段和普通分段回归；原生页面按钮链路仍待单独现场点击验收。
  - 相关实现：`design/android-voiceprint-test-apk.md`；`spec/android-voiceprint-test-apk.md`；`task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`。

- [ ] 独立 ASR 项目：Android 真机麦克风和 VAD、网页真实麦克风体验验收。
