# MindAR Basic 同时视觉惯性定位实验

- 任务：采用用户确认的 IMU 高频预测、MindAR 持续平滑纠偏方案，暂不接入 SLAM。
- design/spec：`docs/design/mindar-basic-web.md` 当前实现章节；`docs/spec/mindar-basic-web.md` IMU 伪代码。
- 完成：正常跟踪与短失锁均预测平移、视觉吸收增量并保留转换后的速度、失锁稳定三帧后纠偏、旧矩阵过滤、平移到期后继续旋转。
- 文件：`3rd/mind-basic/mind-basic-imu.js`、`mind-basic.js`、`index.html`、README；算法及浏览器测试。
- 自测：`node --test tests/mind-basic-imu.test.js tests/mind-basic-custom-target.test.js tests/mind-basic-custom-target-browser.test.js`，22/22 通过。覆盖连续平移/单位换算/速度换轴、视觉频率/突跳/稳定恢复、超时与中断、浏览器事件和原拍照工作流。
- 兼容：保留纯视觉模式、用户手势申请 IMU 权限和目标切换清理；不改相机视频尺寸或模型动画。Android 真机传感器轴向、暂停恢复和镜头背景待验收。
- 性能：没有新增帧循环，仍复用设备事件及 A-Frame tick；手机帧率尚未测量。
- 风险：浏览器时间同步与标定有限，平移仍为受限实验，须填写真实图宽；相似姿态确认不等同官方置信概率。
- 工时：预计约 45 分钟；实现及本地回归完成。
- 发布：尚未同步外网，待发布和现场测试。
