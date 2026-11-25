# SQuadGen 本地扩展：跨机器源码包

本目录纳入AASC Git，包含19个真实源码/说明文件的镜像，以及保留原提交身份的源码bundle。不是训练完成的LoRA权重，也不包含模型权重、运行环境、缓存或测试模型。

- 官方基础提交：`b00a83b6f2068b9e66cbf195978dbe9c084108ee`
- 扩展提交：`3710e789b9575821ec3610eb03002c787d28af4f`
- 文件与bundle校验：`manifest.json`

## 在另一台机器恢复

先拉取包含本目录的AASC。以下示例的AASC路径请按本机实际位置替换；SQuadGen目的目录必须尚不存在。已有SQuadGen或本地改动时先检查，不能覆盖。Windows PowerShell同样支持以下Git命令，路径可用I:/ai等形式。

```sh
git clone https://github.com/microsoft/SQuadGen.git /path/to/SQuadGen
git -C /path/to/SQuadGen fetch /path/to/AASC/subproject/retop/squadgen-extension/squadgen-local.bundle refs/heads/main
git -C /path/to/SQuadGen switch -c local-lora FETCH_HEAD
git -C /path/to/SQuadGen rev-parse HEAD
git -C /path/to/SQuadGen submodule update --init --recursive
```

HEAD应为上面的扩展提交。bundle只包含这次扩展所需对象，需要先clone取得官方基础历史；若当前clone没有基础提交，先获取该提交。源码镜像用于浏览核对，推荐bundle恢复，避免仅复制文件导致Git提交身份不同、已有训练缓存或adapter指纹不兼容。

## 下一步

让新会话读取AASC中的`subproject/retop/goal.md`及恢复后的`local_train/README.md`。提供真实高低模数据路径；高低模配对预处理仍待实现，现有缓存仅接受官方patchboard NPZ。LoRA保存/加载/恢复的小模型测试已做，真实GPU训练及16GiB训练预算仍待验证。

另一台新机器还需要独立Python/PyTorch环境、官方SQ-Diffuse与AE权重/配置，以及QuadTools构建；按官方README和local_cpu/local_gpu/local_train各自说明核对。已有192.168.1.101的I:/ai/SQuadGen是之前部署的测试环境，不能假定任意机器都拥有它。权重应从官方来源获取或从已有环境校验复制，不能向微软官方仓库推送本地扩展。

本包是提交3710e78的快照；以后修改实际SQuadGen源码时应重新导出并更新manifest及bundle，不把镜像误当另一套独立开发源。
