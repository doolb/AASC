# Offline code v5 发布：Chat2API 账号凭证按钮

## 任务描述

用户在 Offline 控制端打开 Chat2API 账户管理时只看到四个顶部按钮，无法找到独立的账号凭证导出入口。确认发布清单中的 `code-v4.zip` 仍为旧前端代码，需要发布代码热更 v5；本次不重新打包 APK，也不更新生产依赖。

## design 需求

- 使用 `code-only` 模式生成服务代码包，复用已发布 dependencies v3。
- 清单原子切换到 `code/code-v5.zip`，保留 apkMin v14 和 dependencies v3。
- 设备启动时验签、校验 SHA-256，并原子切换 `code=5, dependencies=3`。
- Chat2API 账户管理顶部应包含“导出配置”“导入配置”“导出账号凭证”“导入账号凭证”“导入原 Chat2API 数据”“关闭”。

## spec 设计

伪代码见 `docs/spec/android-offline-hot-update.md` 中 `publishChat2ApiCredentialButtonsFix`：构建时检查 package-lock 指纹，发布代码包和签名清单，设备启动时只切换服务代码版本，不下载依赖包或 APK。

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/js/chat2api.js`：已存在账号凭证导入/导出按钮和接口绑定。
- `scripts/ops/offline-update-package.js`：生成 code-only v5。
- `scripts/ops/publish-offline-update.js`：双站点原子发布代码包和签名清单。
- `/mnt/aasc-offline/code/code-v5.zip`、`/mnt/aasc-offline/manifest.json`：发布资源。
- `docs/design/android-offline-hot-update.md`、`docs/spec/android-offline-hot-update.md`、`docs/todo.md`、`changelog.md`：文档记录。

## 自测用例

1. 解压 code v5，确认 `chat2apiExportAccounts`、`chat2apiImportAccounts` 和对应中文按钮存在。
2. 校验 code v5 大小 `14005201` bytes、SHA-256 `dae26685353195f23afb4828980b829bb30e5aef6822887233e927714576de9e`。
3. 读取 LAN/WAN manifest，确认 code=5、dependencies=3、apkMin=14，签名有效。
4. 重启 SM-N9500，确认日志出现 `已原子切换服务版本 code=5, dependencies=3`。
5. 从设备控制端静态读取 `js/chat2api.js`，确认包含两个账号凭证按钮；设备脚本 SHA-256 与源码均为 `9dd599441e8b45b319fff5ecd4832d9db4b4bff2dbd19b61aa3d963463e93e7f`。

## 兼容性测试

- 保留 dependencies v3，不触发 node_modules 下载。
- 保留 apkMin v14，不触发 APK 安装；旧设备可在启动时应用 code-only 更新。
- 使用 LAN 和 WAN 直连 IP 验收；域名只作为 DNS 解析入口。

## 性能测试

- 代码包约 14 MB；设备启动完成代码版本切换，服务日志显示动态库和 Node launcher 正常启动。
- 未重新下载约 100 MB dependencies v3 或约 85 MB min APK。

## 风险评估

- 外网直连下载限速导致完整三组件流式复验耗时过长，本次中止该重复下载；远端 `manifest.json`、code v5 文件和清单 SHA 已单独确认，依赖/APK 沿用此前已验收版本。
- 如果设备仍显示四个按钮，应重启 Offline 服务并确认日志中的 active-release 已切到 code 5；回滚时恢复旧签名清单和 code v4。

## 预计工时

- 0.5 小时（构建、双站点发布、真机重启和文档同步）。

## 验证结果

- 代码包构建成功，签名清单生成成功。
- LAN/WAN manifest 已切换到 code v5，SM-N9500 已应用 code=5/dependencies=3。
- 设备实际 `chat2api.js` 已包含账号凭证导入/导出按钮。
