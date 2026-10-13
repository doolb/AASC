# 完整 Offline APK 同步与重建

用户已确认方案。需求：full APK纳入现有默认同步，构建并发布v38。design/spec见offline-full-apk-sync文档。

受影响：新增scripts/ops/offline-full-apk-manifest.js；修改sync-offline-update.js、publish-offline-update.js、release/apkbuild/allserver/app.json、同步/发布测试；同步design/spec/index/usage/self-test/todo/changelog。

任务：先更新伪代码；实现独立签名索引与默认同步；旧源404兼容；验证签名、下载、复用、链接/路径拒绝、坏包不清理及full发布不改服务清单；提交Git；复用编译MNN构建full v38；检查APK签名/profile/版本与最新backup源码和yazl依赖；发布LAN/WAN版本资源和索引、验证后精确清理旧full；记录并上传Git。

兼容：不改变Android服务更新清单格式；旧full源无索引时仍能同步服务；原始模型集合与min兼容指纹沿用。性能：APK流式下载和哈希，重复同步复用文件，只触发按需构建，不增加服务运行成本。风险：full约1GiB，下载时间长；索引与APK需按顺序发布，旧包不得提前删除；使用独立签名索引解决。预计2–3小时，含构建与传输。未明确项：无，用户已确认方案。

状态：进行中。

实施验证：默认full入计划、404旧源兼容、完整下载后复用/清理、坏签名/路径/哈希不提交索引、本地索引链接拒绝、full发布签名/版本/哈希拒绝及远端先APK后索引顺序均覆盖。`npm run test:offline-sync`36/36、发布器17/17通过。服务清单格式保持；三项发布状态无受影响变更。
