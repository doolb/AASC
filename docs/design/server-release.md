# 共享服务器发布文件设计

主服务器与Offline使用同一已发布RSA签名清单、代码ZIP和common/android/linux64/win64依赖ZIP。普通APK/Termux仍通过已配置主服务器取包，Offline直接通过LAN/WAN取相同文件。

发布根默认`/mnt/aasc-offline`，运维可用`AASC_UPDATE_RELEASE_ROOT`指定；最新入口始终为`manifest.json`。HTTP请求只读取、验签、校验被引用文件，版本/指纹过期返回409，不在请求中打包。文件校验按路径/inode/size/mtime/ctime/SHA缓存，清单每次重新读取。

`build:server-package`改为校验和报告当前共享资源；统一出包仍使用`build:offline-update`。新版普通启动器安装common加匹配平台，组合校验完成后原子切换，按本节点API实际版本/物理目录健康提交或整组回滚。原源码及用户配置、模型、日志、任务/results不覆盖。

本地构建不替换LAN/WAN清单；明确发布后才改变已发布入口。旧普通APK需要重装新启动器。详细组件和迁移约束见[aasc](aasc.md)。
