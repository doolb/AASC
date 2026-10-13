# Offline启动回滚与Download备份修复

状态：已完成，源码/构建/发布/ADB与回归验证通过。

## 需求与design

先安装full APK并通过ADB测试v70。已安装full38（内置服务69/依赖8），复现备份模块拒绝Android系统链接，69和70均启动失败；70切换后自动回滚。用户指定最终ZIP保存到Download，并要求启动及应用更新报错提示出来。

## 需求评审

analyze-requirement-level enterprise：主L6（目录/下载/错误呈现契约），次L5（启动和候选更新状态）。证据：系统根别名应可用、内部链接仍拒绝、最终ZIP放Download、失败原因可见、健康后才成功。置信度9/12×0.90=0.675，风险中，结论可开发；评分24/25+20/20+19/20+19/20+15/15=97/100。建议下放L4：可信根规范化、流式目标创建/提交/撤销、进程错误收集、健康确认/回滚与UI错误保持。

## spec与影响代码

先更新full-config-backup设计/伪代码。修改备份service根路径解析及定向Node测试；Android MainActivity保存/状态呈现、NodeServerService诊断/健康确认；新增Download存储和诊断辅助模块及JUnit用例；更新aasc-user-config.js保存提示和自测。同步相关文档、task/todo/changelog。服务修改servicePackage=true；原生修改minApk=true；不改依赖集合。

## 自测、兼容性、性能

临时目录模拟Android/data/user/0别名，导出/恢复往返并拒绝根内恶意链接。Native回归覆盖下载碰撞不覆盖、失败只清理新文件、100MiB限制、受限来源、错误摘要脱敏/有界、候选失败/超时回滚与成功时机。ADB核对full38→修复min→修复服务真实启动、服务器列表/api/status一致和Download ZIP。兼容旧JSON导出与旧APK回调，API28文件方式和API29+MediaStore方式。保留流式内存开销与有界诊断；复用既有MNN编译产物。

## 风险、待确认和预计工时

已确认最终ZIP使用Download，内部暂存/恢复保持私有；新增启动和应用更新失败提示由用户直接补充。主要风险为误放开项目内部链接、覆盖已有下载文件、健康确认与进程退出的竞态、旧事件覆盖新错误。通过可信根映射、独占文件和pending MediaStore、进程代次和状态保持处理。预计2–3小时，含构建/发布/ADB复测；尚未完成的真机情况须明确记录。

## 源码与回归进度

受信任项目根realpath规范化及根内路径映射完成；工作/配置内部链接仍拒绝。ZIP直接流式写入Download，旧系统重名独占新文件、失败只清理新目标，API29+MediaStore pending提交。Native实际错误摘要和UI错误保持完成；所有Offline启动核对实际版本/路径，候选健康后才成功，失败回滚带保留版本。

Node/浏览器17项通过；24MiB往返1809ms、RSS267MiB含夹具。首次/tmp配额失败，改TMPDIR=/var/tmp后通过。Android JVM208项通过，新增下载/错误5项；首次编译发现旧保存选择器引用，移除后通过。最后增加健康后刷新失败页/控制页，由产物构建与ADB验证。min profile升39/0.2.37；servicePackage/minApk=true，依赖不变。后续已完成v71/min39及最终min40构建和设备验收，见下文。

补充：真机控制页实际路由/control，保存策略已兼容/control与旧upload.html；4项原生策略定向通过。原npm APK脚本assembleDebug未产出预期文件，且其全局daemon清理中断并行定向测试；改为顺序执行并使用已准备资源签名Release构建。

## 真机进度与补齐

min39安装后真实启动错误和失败候选更新同时显示且保持；通过原生按钮应用服务v71，实际codePath为/data/data/.../updates/code/code-v71，健康提交后错误遮罩清除。控制端服务器页面显示v71；ZIP按钮直接生成Download/aasc-full-config-1791897877802.zip（3077字节、4项、CRC通过），测试拉取副本已清理，设备文件保留。强制停止后再启动仍status=ok/v71。

检查发现签名拒绝等更新检查错误只记日志，已先补spec后修改OfflineUpdateManager显式failed标志、MainActivity检查提示；LAN/WAN最终网络异常保留原因、正常无更新不报错，网页重试超时不覆盖真实原因。min升40/0.2.38，服务继续复用已构建v71。

最终原生构建：min40/0.2.38-offline-min，81124288字节，SHA256=21099968269ef4c4712edb6ed0d2f7ac3822dd3c29a4268bc8ccadc4845428b5，与full38同证书。APK CRC/profile/版本通过，API28安装后status=ok、APK0.2.38/code71；原生全套209/209通过（0失败/错误）。servicePackage/minApk均已由成功构建设false；min40最终LAN/WAN全组件HTTP大小/SHA256和精确清理通过。

## 最终发布与收尾

code-v71.zip：17721071字节，SHA256=b6fd67e22d6499bf323f3369c6a9690826466e8c5d7821d13818412802c6fb7b；最终APK为aasc-display-offline-min-v40.apk。复用dependencies8/nodeMinSeeds69/dataRepair2。LAN /mnt/aasc-offline与WAN /home/as/a/aasc-offline独立发布，版本文件预校验上传后原子切换签名manifest；最终清单SHA256=69e3d4852ef056d3431ca6afb36c29f7c92dd6f269e7cf47c9d153ddd0a143ae。两端全组件HTTP大小/SHA256通过，旧code70/min37与中间min39按精确规则清理，full38保留，无清理错误。

最终APK重启后status=ok/服务v71，无错误遮罩。todo删除本修复条目；TTS主题渐变按用户要求单独记录为待实施。真实ZIP导入和API29+设备不在本次已执行验收内。
