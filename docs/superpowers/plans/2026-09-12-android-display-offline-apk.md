# Android 显示端离线 APK 实现计划

1. 先用 Node 和 Android JVM 测试锁定离线模型白名单、构建命令、地址选择、Node role/环境变量和构建标识。
2. 扩展 Runtime 准备脚本，按固定白名单把 `res/models` 复制到 manifest，并写入模式与离线模型轻量元数据。
3. 扩展 Runtime 安装器，安装模型目录并在离线快速复用时检查模型文件。
4. 增加 Gradle 离线属性和新的 Node 构建入口，产出 `aasc-display-offline.apk`。
5. 增加 Android 离线启动、自连接、控制 WebView 覆盖按钮和本地启动重试。
6. 运行红/绿测试、Android JVM 单测、静态构建契约和可用环境下的离线 APK 构建。
7. 更新 todo、design、spec、task 和 changelog，报告普通/离线构建验证结果及任何环境限制。
