# Offline MMD 静态资源本地持久缓存

## 任务描述

Offline APK 首次使用固定 PMX 角色时仍从固定上游下载模型、贴图和动作；首次完整校验后，应在 Android Runtime 可持久保留目录保存资源，使后续角色加载从设备本地读取并可由 WebView 按版本复用。

## Design 需求

- 保留本地有效 `res/models/mmd/manifest.json` 优先与静态资源上游回退逻辑。
- 固定 14 个资源白名单、版本、字节数、SHA-256、DNS 解析、来源顺序和禁止重定向规则。
- 将校验通过的内容写入 `res/temp/mmd-static-cache/<version>/`，缓存损坏时删除该项并重新获取。
- 临时文件原子替换正式缓存项；未完成或未校验内容不能被读取。
- 相同静态资源的并发首载合并为单次上游下载。
- 版本号加入同源 URL；版本化路径提供 ETag 与长效 immutable HTTP 缓存，旧无版本路径保持兼容及 `no-store`。
- Offline 首次加载仍需网络；服务失败时保留已有占位/错误行为。缓存写入失败不阻断经过校验的当次响应。
- 不把模型二进制加入 APK、Runtime 或 Git，不构建 APK 或发布包。

## Spec 设计

- `createStaticMmdResourceProfile()` 将固定版本加入 PMX/VMD URL，Three.js 纹理通过 PMX 相对路径继承版本路径。
- `requestStaticMmdAsset(version, relativePath, cacheDir)` 先校验版本和白名单，再检查普通本地文件及其 size/hash；未命中时对相同键做 in-flight 合并，依次请求固定上游，验证后原子写入。
- 服务路由识别版本型和旧版静态路径。新路径设置 ETag、`Cache-Control: private, max-age=31536000, immutable`，支持 If-None-Match 304；旧路径仍 `no-store`。
- 只清理缓存专用目录下的旧版本目录，不沿符号链接，不触及其他 `res/temp` 内容。

## 受影响的功能模块和代码

- `src/apps/server/modules/mmd/mmd-resource-service.js`：版本化 profile、缓存命中/校验、in-flight 去重、原子落盘和版本目录清理。
- `src/apps/server/boot/server-app.js`：持久缓存目录、版本化/兼容路由、ETag、Cache-Control 与缓存来源响应头。
- `src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js`：接受严格格式的版本化静态 MMD 同源路径，保留旧路径。
- `src/apps/server/modules/mmd/mmd-resource-service.test.js` 与显示端 MMD runtime 定向测试：缓存及路径契约回归。
- `docs/design/mmd-pmx-vmd-local.md`、`docs/spec/mmd-pmx-vmd-local.md`、文档索引、todo、自测和 changelog。

## 自测用例

1. 空缓存请求仅调用固定上游；完整校验后文件位于版本目录，临时文件不残留。
2. 命中本地缓存不调用 DNS 或上游；返回内容与声明大小、SHA-256 一致。
3. 同一资源并发请求只触发一次上游请求，所有调用取得完整内容。
4. 缓存长度错误、SHA 错误或符号链接时不能使用该内容，成功后替换为已校验文件。
5. 上游大小、HTTP 状态、Content-Length、SHA 错误以及本地写入失败不产生可命中的残缺缓存；已校验响应在单纯写缓存失败时仍可返回。
6. 版本不匹配或非白名单路径拒绝；切换到新版本不复用旧版本文件并清理缓存目录中的旧版本。
7. 新版本 URL 的 ETag/immutable 响应与 304 生效，旧静态 URL 仍可访问且为 no-store。
8. 显示端 URL 白名单接受版本化固定路径，同时拒绝 URL 外部源、query/hash、反斜杠和路径穿越。

## 兼容性测试

- 有效本地 MMD manifest 仍优先使用 `/models/mmd/...`，不转入静态缓存。
- 旧 APK/旧显示端使用的 `/api/mmd/static/mmd/...` 保持可用，不启用浏览器长效缓存。
- 新版显示端能通过 URL 白名单加载版本化 PMX、纹理和 VMD。
- Android `res/temp` 在 Runtime 更新后保留；缓存目录与 Offline 模型、配置、用户上传及其他临时数据隔离。

## 性能测试

- 冷缓存基线仍受首轮上游网络带宽限制。
- 首轮成功后重启 Node/Offline Runtime，再次请求相同 14 项资源时，上游请求数为 0，服务端从磁盘命中；浏览器 URL 版本不变时可直接命中 HTTP 缓存。
- 按固定资源列表计算缓存占用上限约 13.4 MB；不在内存保留整套资源。

## 风险评估

- 上游或存储空间不足会影响首次缓存，必须保留原有错误回退；写缓存失败不能破坏经过哈希验证的当次响应。
- immutable 缓存必须绑定 release version，并在资源内容改变时更新版本，否则浏览器可能复用旧文件。
- 缓存只用于固定白名单资源，清理边界限定在专用缓存根；旧版本清理必须检查名称和普通目录属性。
- 本次不优化 PMX CPU 解析、图像解码或 GPU 纹理上传；若热缓存后仍慢，再用分阶段耗时数据定位。

## 预计工时

约 2.5 小时：缓存服务与路由 1 小时，回归测试 1 小时，文档和定向验证 30 分钟。

## 执行结果（2026-10-08）

- 已完成服务端版本化 profile、专用磁盘缓存、大小与 SHA-256 命中校验、并发请求合并、唯一临时文件原子写入、旧缓存目录清理与符号链接隔离；存储不可用时仍返回经过校验的当次资源。
- 版本化路由设置固定资源 ETag、`private, max-age=31536000, immutable` 并支持 `If-None-Match`；旧路径维持兼容和 `no-store`。显示端 MMD 路径校验接受严格格式的版本路径。
- `node --test src/apps/server/modules/mmd/mmd-resource-service.test.js`：17/17通过；显示端版本路径定向测试：1/1通过；4个相关脚本语法检查及 `git diff --check` 通过。
- 更新 design/spec、自测伪代码与结果、索引和 changelog；`docs/todo.md` 不保留已完成任务。
- 使用 `npm run build:offline-update -- --mode=code-only --code-version=47 --manifest-file=/mnt/aasc-offline/manifest.json --reuse-node-min-seeds=true` 生成 `code/code-v47.zip`：16,895,693 bytes，SHA-256 `cdccd101c1dbb4c67140496a520316cb0dc67f8357529364900c4d58fed7d865`；ZIP 完整性、签名清单与组件兼容性检查通过。包内 1,122 个条目含持久缓存实现，不含 APK、模型、日志或其他 ZIP。来源提交为 `c968a361e41f380fbe11fea9db9cf2eaa2a961ef`；`gitDirty=true` 由保留的工作区改动标记，参与归档的服务源码与提交一致。
- `npm run publish:offline-update -- --mode=code-only --manifest-file=release/offline-update/output/manifests/manifest-code-v47.json --remote-dir='~/a/aasc-offline'` 成功发布至 LAN `/mnt/aasc-offline` 和 WAN `/home/as/a/aasc-offline`。两端清单签名有效且字节内容一致；发布器下载复核所有清单组件大小/SHA-256成功，code v47 HTTP HEAD 均为 200 / 16,895,693 bytes。LAN/WAN 的旧数字 code 文件已按规则精确清理，仅保留 v47；dependencies v6、min APK v34、Node-min seeds v39 与 data-repair v2 保留。未构建或发布 APK。
- 服务包发布成功后，`release/offline-release-status.json` 的 `servicePackage` 设为 `false`；`minApk=true` 与 `dependenciesPackage=false` 不变并随发布记录上传 Git。Android Offline APK 冷启动、Runtime 更新/重启后缓存命中及角色初始化实测仍待现场验收。
