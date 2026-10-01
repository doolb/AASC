# MMD AR ORB-SLAM3定位迁移评估

## 需求与状态

用户已确认实施 APK 原生接口＋无接口网页 MindAR 回退，选择先识别原定位图再锚定 SLAM 世界，取消 WASM 路线。原生库/采集/JNI/能力分发与标定导入代码已写入，最终APK/网页构建和静态检查通过；不新增/运行测试、不安装、不提交或发布。

## 设计与伪代码

见docs/design/mmd-ar-test-apk.md、docs/spec/mmd-ar-test-apk.md同名评估章节。替换定位/输入层，增加世界相机位姿接口，保留MMD渲染、动作、Ammo、手动偏移/旋转及第二层相机缓动；SLAM模式停用旧IMU预测。

## 受影响模块

3rd/mmd-ar-test/display-mmd-ar-aframe.js、display-mmd-ar-imu.js、build.js、定位/质量面板；复用现有display-mmd.js/display-pmx-runtime.js的anchorMatrix相机入口，不新增世界接口；共享display-mmd-ar.js仅补取消和状态文本。共用网页另有能力检测/双后端分发与原生桥适配，纯网页不加载ORB-SLAM3；独立APK另有Camera2/SensorManager/CMake/NDK/JNI/MainActivity与Gradle。实际范围取决于平台选择。

## 尚需确定

已确定APK原生接口与网页MindAR回退；已选择图片初始锚定；未导入标定时纯单目视觉，完整相机/IMU/时间同步标定后可用惯性模式。目标手机与实际标定仍待提供；本次地图仅在单次会话有效，不持久化。

## 待后续验收（未执行）

真实静止/平移/旋转、初始化与尺度、地图重定位/回环/重置、模型稳定和旧缓动、背景裁切/旋转对齐、后台恢复/输入释放、手机帧率/CPU/发热/内存。单图透视模拟不能代表三维SLAM稳定性。

## 风险与工时

主要风险是NDK依赖/线程接入、原生预览与WebView叠加、移动性能、相机IMU标定/同步、单目尺度和地图更新的锚点连续性；现阶段不足以承诺手机精度或固定工期，应先做选定平台的最小相机轨迹验证，再估算接入工时。

## 已选双后端契约

MmdArNativeSlam能力JSON含版本/引擎/available，缺失或不可用走原MindAR；原生会话带sessionId/generation，位姿和投影统一相机接口。原生跟踪失锁不切换后端；启动错误须先释放相机和IMU，再提示/回退。保留MMD、物理、手动变换与第二层相机缓动；不注入伪接口、不并发采集。已接入固定上游库、Camera2/SensorManager、标定导入和图片锚定。真实设备精度/性能/回环仍待验收。

## 实施记录（2026-10-01）

新增prepare-native-slam.py、display-mmd-ar-native.js、NativeSlamBindings/Controller及CMake/JNI/headless/NDK兼容头；相机参数模板camera-settings-template.js供APK/网页共用；修改Gradle/MainActivity/build.js/web-panel-groups.js与共享AR状态/取消入口。Android只arm64，Camera2优先640×480、帧队列不积压。上游Android扩展在CMake产物中生成，不改下载的原源文件。对象登记及GBA解锁/join覆盖停止回收；词袋与依赖许可证/版本随包。最终APK构建、包内模型/定位资源及词袋摘要检查、网页构建、源/生成/内联语法与差异空白检查通过；APK 95,015,322 bytes，SHA-256 29cbf0fc2242ebe2f03a3ca3c18a351daf79f5629da05760a3aad1b9abfba991。没有运行测试、安装到设备、提交或发布。

原生补充：上游MLPnPsolver只有析构声明无定义，headless适配补默认析构；候选改RAII。纯单目跳过未配置IMU字段、初始化IMU重置窗口，删除未保存的临时重定位Frame；跟踪器释放提取器/标定。APK系统文件选择器接入content Uri，取消/销毁完成旧回调，原file导航限制保留。
