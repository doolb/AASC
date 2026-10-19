# Offline 热更 WAN 源 IP 替换

日期：2026-10-19；状态：源码和测试已完成，待出包及断 LAN 真机验收。

## 任务描述与设计需求

用户要求当前 Offline APK 热更 WAN 来源在每次请求前把域名解析为 IP，再用 IP URL 连接，不能把当前 IP 写死。当前 JS 启动器使用 `http://c.aasc.us/mnt/aasc-offline/`；两个 LAN 失败后会尝试该来源。现场对同一路径测试：域名 HTTP 403，解析出的 `120.79.245.103` HTTP 200，签名清单通过项目公钥验证，清单所列 code ZIP 路径 HTTP 200；同 IP 使用域名 Host 头仍为 403。设计见 `docs/design/android-offline-js-launcher.md`。

## 需求等级与 L4 草案

主等级 L6（更新来源契约），次等级 L5（LAN/WAN 顺序和失败回退）；依据为用户明确要求动态解析、现有来源列表与真实 HTTP/签名对照。下放判定：建议下放 L4；直接开发风险中，DNS 失败时 WAN 来源不可用。评审结论：可开发，置信度 0.80；层级清晰度 23/25、证据充分度 19/20、实现完备度 17/20、风险暴露度 17/20、L4 可落地性 14/15，总分 90/100。

```text
已有声明 := network.UPDATE_SOURCES两LAN后接域名WAN；releases.manifest与network.download逐源尝试并校验身份
新增定义 := WAN热更请求的实际URL以DNS解析所得IP替换c.aasc.us主机；来源配置仍保留域名
操作流程 := 请求前解析固定WAN主机 → 改写实际请求URL → 保持LAN和签名/SHA-256规则 → 回归清单及下载流程 → 标记服务包待发布
```

## Spec 伪代码、受影响模块及自测

规格见 `docs/spec/android-offline-js-launcher.md`。已修改 `src/apps/server/boot/offline-launcher/network.js` 的请求路径：只对固定 WAN 热更来源解析 IPv4、重建实际请求 URL；`UPDATE_SOURCES` 仍保留域名。不改独立模型来源和旧版 Android 原生更新器。定向测试证明解析后实际 HTTP Host 为 IP、模型来源不改写；修改前基线 `npm run test:offline-launcher` 36/36，修改后 37/37 通过。真实 WAN 经修改后成功获取并验签 code128 清单，完整下载 code128 ZIP 4,966,585 字节且大小/SHA-256 校验通过；语法与 `git diff --check` 通过。`servicePackage=true`、`minApk=true` 保持待出包状态。

## 兼容性、性能和风险

LAN 优先级不变；WAN 来源保留域名，每次请求前动态解析，实际 HTTP Host 使用解析所得 IP。签名与文件摘要仍限制来源内容。DNS 失败时按现有来源不可用处理；解析结果变更无需更新代码。断 LAN 真机实测仍待执行。预估实现、回归和文档同步约 30–60 分钟。
