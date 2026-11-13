# AASC 游戏

局域网五子棋原型：Android APK 和浏览器共用网页界面；APK 可开启房主服务并向其他设备分发网页。支持两人对弈、房主配置尺寸、扫码打开房间和断线恢复。仅限同一局域网，公网中转和热更新尚未实现。

也可运行 Node.js 内网中转：网页和 APK 网页均可在中转页面创建房间，棋局由房主网页本地管理。默认只监听本机；需要局域网其他设备连接时，将 `AASC_GAME_BIND` 设置为运行机器的内网 IP，例如：

```sh
AASC_GAME_BIND=192.168.1.10 npm start
```

浏览器访问 `http://192.168.1.10:8787/`，创建房间后分享邀请链接或二维码。房主网页需要保持运行；关闭后玩家等待，房主在同一浏览器恢复房间可继续游戏。只用内网，不要将端口开放到公网。

安装调试 APK 后开启本机房主服务；在同一局域网的另一台设备用相机扫描房主二维码，或输入页面显示的地址。房主等待玩家加入后设置尺寸并开始。网页的摄像头扫码受浏览器安全上下文限制；可使用系统相机扫码打开房间，或选择二维码图片、手动输入地址。

```sh
npm install
npm run test
ANDROID_HOME=/opt/android-sdk npm run build:apk
```

调试 APK 输出在 `app/build/outputs/apk/debug/app-debug.apk`。测试中的服务端 JVM 回归使用本机 Gradle 缓存的 org.json；Chromium 页面检查使用可用的 puppeteer-core 和 `/usr/bin/chromium`。需要在实际设备上验证 Wi-Fi 联机、扫码和 Android 生命周期。
