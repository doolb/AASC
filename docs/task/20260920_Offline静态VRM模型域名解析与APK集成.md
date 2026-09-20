# Offline 静态 VRM 模型域名解析与 APK 集成

## 任务描述

将默认 VRM 模型从 VRoid Hub 临时下载改为预先上传的静态模型资源，并集成到 Offline APK 的显示端加载流程。静态根地址保持为 `http://c.aasc.us/mnt/mmd/`，请求时解析域名并替换为 IP，不保留 Host；模型配置使用文件名，为后续多个模型预留扩展能力。默认资源使用 zstd 压缩文件，服务端解压后返回 GLB。

## design 需求

- 使用统一的 MMD 静态资源根地址。
- 通过本地 Node HTTPS 同源代理规避 WebView 混合内容限制。
- 只允许受校验的 `.vrm`/`.glb`/`.vrm.zst`/`.glb.zst` 相对文件名。
- 下载失败不影响聊天和媒体层。

## spec 设计

- `MmdModelProfile` 保存 `resourceId`、`fileName`、`version`、`sha256` 和同源 `modelUrl`。
- 服务端解析 `c.aasc.us` 的 IPv4 地址并把 URL 主机替换为 IP，不设置 Host。
- `/api/vrm/model/static` 代理静态文件并执行大小、类型和 GLB 文件头校验。
- 显示端默认加载 `default-vroid.vrm.zst`，收到模型 profile 时可切换文件。

## 受影响功能模块和代码

- `src/apps/server/modules/vrm/vroid-model-service.js`
- `src/apps/server/boot/server-app.js`
- `src/apps/web-mediacenter/ui/public/js/display-mmd.js`
- `src/apps/web-mediacenter/ui/public/js/display-vrm-runtime.js`
- VRM 服务、显示端和 APK 静态契约测试
- `release/apkbuild/allserver-min/app.json`

## 自测用例

1. DNS 解析后 URL 主机为 IP，配置中不出现 Host 覆盖逻辑。
2. 默认模型 profile 指向 `default-vroid.vrm.zst`。
3. 多个安全文件名可以生成不同模型 profile，路径穿越和任意 URL 被拒绝。
4. 静态代理返回正确 MIME、大小和 GLB 文件头。
5. three-vrm 能通过同源代理加载默认模型，失败时显示占位角色。

## 兼容性测试

- Node 服务端 HTTP 单测。
- Chromium/WebView HTTPS 同源加载。
- Offline APK Android WebView 和本地 Node 代理。
- 无公网或静态资源 403/404 时聊天、媒体和占位层继续工作。

## 性能测试

- 记录静态模型下载耗时、响应大小和 VRM 解析耗时。
- 保留 Cache API 缓存，重复进入角色不重复下载。
- 实测压缩资源 `default-vroid.vrm.zst` 通过 DNS 替换后的公网 IP 下载耗时约 `45.0s`，响应大小 `10,305,941` bytes；服务端解压后返回 GLB `58,054,828` bytes。

## 风险评估

- 公网域名仍可能被代理返回 403；使用 DNS 解析后的 IP 访问降低域名代理影响。
- 模型文件约 58 MB，首次下载会占用网络和内存；继续使用大小上限和缓存。
- 多模型扩展必须继续限制文件名和目录，禁止任意 URL 转发。

## 预计工时

- 服务端代理与安全校验：1.5 小时
- 显示端模型 profile：0.5 小时
- 测试、APK 构建和真机验证：1.5 小时

## 执行结果

- 已完成静态资源上传：
  - `/home/as/a/mmd/default-vroid.vrm`：`58,054,828` bytes，SHA-256 `a6bf9579cf394443a52a2a346c022c873678e72bf6cb747d0d2862d2fd0564ea`。
  - `/home/as/a/mmd/default-vroid.vrm.zst`：`10,305,941` bytes，SHA-256 `dab79dcd608e4f742ea78e4c0a82e312c3437cac83451b46578d719293916cc3`。
- 已完成服务端静态代理、DNS IPv4 替换、无 Host 请求、zstd 解压、GLB 校验和多模型安全文件名 profile。
- 已完成 Offline min APK 构建：版本 `0.2.20-offline-min`、versionCode `22`，文件大小 `89,262,774` bytes，SHA-256 `72d5162d229283b36cb2c2e5656329109c645c00d54d251d697da579993e284e`。
- 已生成普通服务归档：`res/temp/aasc-server-release/aasc-server-1.0.0.tar.gz`，大小 `2,138,100` bytes，SHA-256 `eb805319cbaf1adcd2033be39d3b378813be377b4ef9d43ac8d2a85a229879fc`；它不是正式 Offline `code-v*.zip` 热更包，暂未发布到内外网。
- 尝试生成正式 `code-only` 热更包时，因当前 `package-lock.json` 与已发布 dependencies v3 的 lock 指纹不一致而被安全校验拒绝；未绕过校验，也未生成不匹配的热更包。
- 验证通过：VRM 服务和显示端定向测试 `23/23`、APK `unzip -tq`、`git diff --check`；当前未在外部真机安装，原因是该真机不在当前可连接设备中。
