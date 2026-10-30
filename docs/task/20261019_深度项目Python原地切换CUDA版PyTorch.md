# 深度项目Python原地切换CUDA版PyTorch

日期：2026-10-19。状态：原地GPU包更新与实际CUDA验证完成。只替换第三方torch/torchvision构建，Python二进制及深度/HMR项目源码未修改。

## 请求与实际结果

后续用户又请求HMR GPU FP32/FP16对照，已由[独立GPU精度任务](20261019_HMR2_GPU_FP32与FP16精度对照.md)完成；本任务下文“模型未推理”指当时环境更新阶段，不等于后续HMR未测。完整深度模型仍未运行。

用户明确要求将原目录Python改为GPU版本。[目标解释器](<E:/ai/ai-depthmap/python/python.exe>)仍为Python3.10.10，原torch2.10.0+cpu/torchvision0.25.0+cpu已替换为2.10.0+cu126/0.25.0+cu126。CUDA运行库12.6，`torch.cuda.is_available=True`；实际设备NVIDIA GeForce GTX1660，能力7.5，编译arch_list含sm_75，cuDNN91002、torchvision CUDA12060。

transformers5.0.0、numpy2.2.6、pip26.1及其余73个发行包版本保持；总有效发行包75，变更只有torch/torchvision。Python核心4文件及深度项目4脚本共8项SHA/大小不变，不改全局pip源、PATH、驱动、项目脚本/模型，不加torchaudio/HMR训练依赖，不启动或控制用户服务。

## 基线、兼容和资源保护

安装前pip check无依赖冲突，transformers.pipeline导入与torchvision CPU NMS([0,2])通过。torch/torchvision RECORD分别13,924/390文件，全部在指定Python前缀，无越界/缺失。两个CPU包记录字节454,519,495/11,924,117，已有`Ignoring invalid distribution -`警告仅记录、未清理未知残留。

先将完整Python目录复制到独立忽略区：52,422个文件、1,254,482,058字节，全部SHA/大小逐项一致；备份解释器实际导入torch2.10.0+cpu/torchvision0.25.0+cpu且CUDA为None。没有提前删除源或备份，保留确切旧安装状态，不将另下官方CPU wheel等同原安装字节还原。

官方GPU安装包与METADATA均核对，[PyTorch cu126索引](https://download.pytorch.org/whl/cu126/torch/)、[torchvision索引](https://download.pytorch.org/whl/cu126/torchvision/)、[版本配对说明](https://pytorch.org/get-started/previous-versions/)及[编译架构说明](https://github.com/pytorch/pytorch/issues/172352)确认Windows CPython3.10/Turing7.5支持，不降级公开版本。下载与再次安装前SHA一致，Windows所需常规依赖已满足，不升级其他库；CUDA运行库随wheel提供，未安装系统Toolkit或更新驱动。驱动门槛网页直接抓取超时，不以索引比较当运行通过，本机后续实际CUDA初始化/算子已验证。

|包|构建|下载字节|官方SHA256|
|---|---|---:|---|
|torch|2.10.0+cu126|2,589,840,080|b91012be20b6c0370800ed7c153fd5b51582495f00f7341c38fa0cb6b9c9a968|
|torchvision|0.25.0+cu126|8,186,881|a2e560743e6c8f0c2627accc47f33f0713734ca34de5866db5ac68da0826b0b8|

## 执行及验证

```text
固定目标前缀 → 核对pip/版本/RECORD边界 → 保存8项核心/脚本与75包基线
全目录copy → 52,422文件SHA匹配 → 备份CPU实际导入通过
官方双GPU wheel下载 → SHA/METADATA/Windows依赖通过 → 19个原DLL/PYD访问检查无失败
指定python执行离线no-index/no-deps/no-cache-dir双wheel安装，仅同公开版本CUDA构建替换
新进程确认2.10.0+cu126/0.25.0+cu126、CUDA12.6可用、GTX1660/7.5与sm_75
GPU FP32与FP16各运行矩阵乘/卷积 → cuda:0、dtype保持、有限值、同步后验证
torchvision CUDA NMS → cuda:0、输出[0,2]；pipeline导入成功
仅运行原depthmap.check_gpu函数 → 返回cuda，不加载模型/处理图片或调用main
原生pip check returncode0 → 其他73包版本/8项保护SHA保持 → CPU备份完整保留
```

五项GPU算子实际通过；不是只检查安装后缀或CUDA可用标记。验证时设备总显存6143.6875MiB、CUDA报告空闲5096MiB，仅该次快照，不保证未来模型空闲显存。HMR三图GPU FP32/FP16/AMP、完整深度模型推理和模型质量尚未测试，见[GPU接续任务](20261019_HMR2_CUDA环境核对与GPU精度测试.md)。

安装pip输出成功，但PowerShell合并stderr警告导致外层任务exit1；已调查而未重复安装。随后独立Python验证exit0、pip check原生returncode0且真实CUDA算子通过。保留旧invalid distribution警告和Scripts未入PATH提示，不改PATH；原UTF16日志另存UTF8副本，未覆盖原日志。

## 回退与证据

- [原环境基线](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/before.json)、[原包清单](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/packages-before.txt)。
- [完整CPU备份目录](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/python-backup/)、[逐文件SHA](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/backup-files.json)、[备份检查](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/backup-check.json)。
- [安装包校验](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/wheel-check.json)、[前缀/依赖/DLL检查](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/preinstall-check.json)、[UTF8安装日志](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/install-utf8.log)。
- [GPU验证记录](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/after.json)、[后置保护摘要](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/protected-after.json)、[后置包版本](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/cuda-upgrade/20261019-161759-189712/packages-after.txt)。

回退前需要用户退出使用该Python的程序并核对原前缀/包路径，避免覆盖未知新文件；不使用无检查递归删除、重置工作区或直接控制用户进程。保留完整CPU快照/原元数据，而不是声称一条重装CPU命令可字节级还原。暂存与快照/轮子仅在本机HMR忽略区，不提交或上传。

## 模块、风险与工时

本次为用户明确的运行包切换，不编写/编辑目标源码；[设计](../design/mmd-human-interface.md)/[spec](../spec/mmd-human-interface.md)/自测与使用入口已同步，已完成环境todo移除，GPU精度/服务待办保留。旧CPU对照、七HMR JSON、模型、正式MediaPipe/IK、Offline状态与Git同步记录不变，没有服务重启、构建、发布、模型下载或图像上传。

初估备份/下载20～60分钟、替换/验证5～15分钟仅为计划，不能当性能结论；备份复制日志实测1分14秒，整体耗时随磁盘/网络变化。下载约2.42GiB、磁盘准备时约458GiB可用，保留备份不清理。风险含DLL锁定、依赖/NumPy ABI、CUDA架构、旧程序继续加载旧CPU包及大模型显存不足；真实消费者基线、GPU小算子、包/脚本不变与完整快照均已验证，但不宣称所有实际模型已跑通。
