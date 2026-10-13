# 完整 Offline APK 同步与重建

用户已确认方案。需求：full APK纳入现有默认同步，构建并发布v38。design/spec见offline-full-apk-sync文档。

受影响：新增scripts/ops/offline-full-apk-manifest.js；修改sync-offline-update.js、publish-offline-update.js、release/apkbuild/allserver/app.json、同步/发布测试；同步design/spec/index/usage/self-test/todo/changelog。

任务：先更新伪代码；实现独立签名索引与默认同步；旧源404兼容；验证签名、下载、复用、链接/路径拒绝、坏包不清理及full发布不改服务清单；提交Git；复用编译MNN构建full v38；检查APK签名/profile/版本与最新backup源码和yazl依赖；发布LAN/WAN版本资源和索引、验证后精确清理旧full；记录并上传Git。

兼容：不改变Android服务更新清单格式；旧full源无索引时仍能同步服务；原始模型集合与min兼容指纹沿用。性能：APK流式下载和哈希，重复同步复用文件，只触发按需构建，不增加服务运行成本。风险：full约1GiB，下载时间长；索引与APK需按顺序发布，旧包不得提前删除；使用独立签名索引解决。预计2–3小时，含构建与传输。未明确项：无，用户已确认方案。

状态：已完成，full APK v38已发布，真实同步复用验证通过。

实施验证：默认full入计划、404旧源兼容、完整下载后复用/清理、坏签名/路径/哈希不提交索引、本地索引链接拒绝、full发布签名/版本/哈希拒绝及远端先APK后索引顺序均覆盖。`npm run test:offline-sync`36/36、发布器17/17通过。服务清单格式保持；三项发布状态无受影响变更。

构建结果：首次Java仍使用/tmp，资源压缩发生Disk quota exceeded和Java heap space；复用已准备的输入，以/var/tmp/aasc-gradle-full38作为Java临时目录、-Xmx4096m、--max-workers=2重试成功，37项构建结果复用，未重编译MNN。产物979394539 bytes，SHA-256 f49c9e00bdb99ef3405bf58f465346d2adbebe478b9bde955b992e18b0e00b7e。来源d8bc9694949811d35e1a8fdb130eb05e4f4981d4（无关本地改动使dirty=true）。

发布验证：两端索引1282 bytes、SHA-256 01ef2efb5784968f4ce50584e29df2cc3f461a3b021ad117e350ebd6514bc806；APK HTTP200且长度匹配，上传文件SHA-256校验通过；旧v23 HTTP404；原服务清单SHA-256保持37f5f707cb75ca85f415ac72cfa5b9b936bd2ca9d2fa86c7186e87046e8771f6。实际`npm run sync:offline-update -- --source-url=http://120.79.245.103/mnt/aasc-offline/ --local-root=/mnt/aasc-offline`显示6项复用，apkFull包含在内。未下载整包进行重复HTTP哈希验证，未安装到设备。三项状态维持false，模型/日志/APK未提交Git。
