# Offline启动回滚与Download备份修复

状态：用户已确认修复并补充错误提示需求，实施中。

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

Node/浏览器17项通过；24MiB往返1809ms、RSS267MiB含夹具。首次/tmp配额失败，改TMPDIR=/var/tmp后通过。Android JVM208项通过，新增下载/错误5项；首次编译发现旧保存选择器引用，移除后通过。最后增加健康后刷新失败页/控制页，由产物构建与ADB验证。min profile升39/0.2.37；servicePackage/minApk=true，依赖不变。待构建v71/min39并完成设备验收。

补充：真机控制页实际路由/control，保存策略已兼容/control与旧upload.html；4项原生策略定向通过。原npm APK脚本assembleDebug未产出预期文件，且其全局daemon清理中断并行定向测试；改为顺序执行并使用已准备资源签名Release构建。
