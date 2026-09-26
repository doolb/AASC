# MindAR 官方 Basic 示例外网发布

## 任务描述

将官方 `basic.html` 示例克隆为独立页面，发布到外网新目录 `https://c.aasc.us/mnt/mind-basic/`，不覆盖现有 MMD AR 测试站点。

## Design / Spec

- `docs/design/mindar-basic-web.md`
- `docs/spec/mindar-basic-web.md`

## 受影响文件

- `3rd/mind-basic/index.html`、`3rd/mind-basic/README.md`
- `docs/design.md`、`docs/spec.md`、`docs/usage.md`、`docs/ref.md`
- `docs/todo.md`、`docs/self-test.md`、`changelog.md`
- 外网目录 `/var/www/html/mnt/mind-basic/`

## 自测用例

- 首页和外网新路径返回 HTTP 200；`mmd-ar` 首页不变。
- A-Frame、MindAR runtime、官方 `.mind`、卡片图和 glTF 依赖返回 HTTP 200。
- HTML 保留官方 MindAR target 与 A-Frame marker 结构；相机仅由 HTTPS 浏览器授权。
- 手机实际摄像头首锁和模型跟踪由现场验证，不以静态 HTTP 检查替代。

## 兼容性、风险和预计工时

页面依赖固定版本的第三方 HTTPS/CDN 资源，CDN 不可达会影响运行；不引入项目服务器协议或显示端依赖。预计 30–60 分钟。

## 执行结果

- `https://c.aasc.us/mnt/mind-basic/` 返回 HTTP 200，页面大小 2,631 bytes；公网 SHA-256 与本地一致：`ff688f1a6715d07912b41ac57321e6efdf3512425e42533d3cd32f4a00cb9d4a`。
- A-Frame 1.5.0、MindAR 1.2.5、官方 `.mind`、卡片图、glTF、bin 和 4 张纹理发布前均返回 HTTP 200；页面内容确认保留 MindAR target、Softmind 模型和 CC BY 4.0 署名。
- `/mnt/mmd-ar/` 首页保持原内容（HTTP 200，SHA-256 `8027f5e8bb20f025884099ea43b1716d63ff5fe39c1f2a039947c6f146568b99`）。未发布 APK、服务包或模型文件。实际手机摄像头首锁与模型锚定待现场验证。
