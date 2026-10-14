# 共享服务器发布文件实现伪代码

```text
ReleaseRoot := AASC_UPDATE_RELEASE_ROOT 或 /mnt/aasc-offline
Manifest := 每次读取ReleaseRoot/manifest.json；拒绝路径链接和超限JSON
ReadManifest → RSA-SHA256验签 → code/依赖版本+lock契约 → 固定组件路径校验
GetManifest → 按文件身份缓存核验code及每个依赖组大小/SHA → 返回原签名清单
GET /server 与 /server/manifest → {status:success,manifest}
GET /server/package?version&sha256 → 选择当前code
GET /server/dependencies?group&version&sha256 → 选择固定四组之一
请求版本/SHA不等当前条目 → 409；无group → 400；未知group/不安全路径 → 拒绝
OpenArtifact → lstat逐层无链接 → 只读打开普通文件 → 固定句柄size/SHA检查
CacheKey := 路径+device+inode+size+mtime+ctime+expectedSHA，最多64条
Stream → application/zip + Content-Length + no-store → pipeline → 关闭句柄
BuildPackage := GetManifest并报告当前code绝对路径/版本/大小/SHA；不生成tar
控制端update-all → GetManifest预检查 → 现有AASC server.update
子节点 → 主服务器清单/代码/common/目标平台组 → 受管更新事务
```
