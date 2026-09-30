# MindAR Basic IMU 姿态防抖与失锁补偿测试

## 任务描述

在现有独立 MindAR Basic HTTPS 测试页中加入可选 IMU 实验，比较视觉定位、陀螺仪姿态平滑和目标丢失时的短时位移积分。防抖对象是虚拟场景/MMD 的相对姿态，不处理摄像头原始视频。

## Design / Spec

- `docs/design/mindar-basic-web.md`
- `docs/spec/mindar-basic-web.md`

MindAR 视觉位姿始终是校正基准；姿态防抖和失锁位移补偿可分别启用或同时启用。IMU 默认关闭，权限只在用户操作时申请。失锁推算必须限制时长和位移，目标重获后重新锚定。传感器不可用时退回纯 MindAR。

## 受影响模块和代码

- `3rd/mind-basic/index.html`：IMU 开关、状态值和模型舞台结构。
- `3rd/mind-basic/mind-basic.js`：传感器权限/事件生命周期、MindAR 姿态采样、场景切换与重锚。
- `3rd/mind-basic/mind-basic-imu.js`：可独立测试的 IMU 积分与视觉校正算法。
- `3rd/mind-basic/mind-basic.css`、`3rd/mind-basic/README.md`：面板样式和实验限制/使用说明。
- `tests/mind-basic-imu.test.js`、`tests/mind-basic-custom-target-browser.test.js`：数学/边界回归与网页交互冒烟。
- 同步 MindAR Basic design/spec/task/todo/changelog 和文档索引。

## 自测用例

1. IMU 默认关闭；开始 MindAR 不自动弹出运动权限。
2. 用户手势授权后收到模拟陀螺仪样本，姿态按角速度及 dt 积分；视觉姿态到达后能把估计值拉回观测值。
3. 去重力加速度样本按积分步长更新速度和位置；静止死区、阻尼、异常 dt、后台恢复和最大位移约束生效。
4. 分别关闭姿态防抖/失锁补偿及同时启用时，控制状态与场景输出符合选项；无传感器数据时退回 MindAR 视觉结果。
5. targetFound → targetLost → 超时 → targetFound、停止/重启、页面隐藏/恢复不会遗留监听器或产生位姿跳变。
6. 原官方目标、自定义定位图拍照/裁剪/保存/编译/切换/删除流程不回归。

## 兼容性测试

- Chromium 桌面：模拟传感器样本、权限缺失/拒绝、页面生命周期与原有自定义定位浏览器流程。
- Android Chrome HTTPS：现场检查传感器字段、屏幕方向映射、权限交互、姿态抖动、失锁短时移动与重获校正。
- Safari/WebKit：检查 requestPermission 分支和 rotationRate/acceleration 缺失时降级。
- 无传感器/HTTP 非安全来源：原 MindAR 摄像头识别仍可启动，IMU 显示不可用原因。

## 性能测试

- 每次传感器样本仅执行常数规模向量/四元数运算；不增加摄像头帧分析或模型推理。
- 页面前后台切换和定位停止后确认传感器监听器及时移除。
- 记录设备实际事件频率、每帧融合耗时和丢失位移漂移；不以桌面模拟数据宣称真实设备定位精度。

## 风险评估

- 浏览器传感器轴、屏幕旋转映射和样本频率存在差异，可能导致补偿方向或角度偏差。
- 浏览器可能不提供去重力 `acceleration`，此时只能运行陀螺仪姿态实验，不能伪造位移结果。
- 陀螺仪偏置与加速度二次积分会漂移；短时推算必须限时限距，并在图像重新识别时校正。
- 姿态滤波会引入响应延迟，需由状态面板和真机观察调节，不进入正式 MMD AR。

## 预计工时

约 4–6 小时，含算法、页面交互、自动化测试和文档；真机多浏览器验收另计。

## 执行结果

- IMU 页面已发布到 `https://c.aasc.us/mnt/mind-basic/`。只上传首页、样式、主脚本和新增 IMU 模块；临时文件 SHA-256 校验通过后按依赖顺序切换，首页最后替换；原几何脚本保持不变。
- 外网 HTTPS 首页、CSS、主脚本、IMU 模块和几何脚本均成功读取，SHA-256 与本地一致；未改 MMD AR 页面、APK 或正式显示端。
- MindAR Basic 定向自动化此前 14/14 通过，JS 语法和差异检查通过。Android Chrome 真机的传感器方向、姿态防抖与失锁补偿观感仍待现场验证。
