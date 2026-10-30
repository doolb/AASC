# HMR2.0b CUDA环境核对与GPU精度测试

日期：2026-10-19。状态：初次环境核对后，用户明确要求原目录Python改GPU，[原地CUDA更新任务](20261019_深度项目Python原地切换CUDA版PyTorch.md)已完成。torch2.10.0+cu126/torchvision0.25.0+cu126、CUDA12.6可用、GTX1660/7.5与五项小GPU算子实际通过，Python/其他73包版本及脚本保持。HMR三图GPU对照随后也已完成，见[GPU精度/速度实测](20261019_HMR2_GPU_FP32与FP16精度对照.md)：此卡同步热FP32/纯Half中位0.260/0.701秒，峰Torch allocated2.626/1.307GiB，数值差小；下文初次CPU只读检查/独立环境建议保留为阶段记录，不用小算子环境验证替代完整模型结果。

## 用户信息与实际检查

用户提供独立深度项目目录，期望使用其CUDA Python接续[既有FP32/FP16精度测试](20261019_HMR2_FP32与FP16精度对照.md)。实际发现唯一[Python解释器](<E:/ai/ai-depthmap/python/python.exe>)为Python3.10.10、isolated模式；当前加载PyTorch2.10.0+cpu，`torch.version.cuda=None`、`torch.cuda.is_available=False`、`device_count=0`。这说明当前torch不具备CUDA后端，不等于电脑没有显卡。

硬件查询实际返回NVIDIA GeForce GTX 1660，6144MiB显存，驱动610.88；检查时空闲2956MiB（约2.89GiB）。FP32网络参数本身约2.50GiB，另有激活、SMPL及运行库；当前余量偏紧。AMP若保留FP32参数并缓存Half副本需要更多显存，测试前重查，建议用户预留约4～5GiB空闲，不自动结束任何用户程序。

[拖拽安装批处理](<E:/ai/ai-depthmap/拖拽图片到这个文件上.bat#L1-L7>)及[boxmap批处理](<E:/ai/ai-depthmap/boxmap.bat#L30-L41>)均使用同一解释器，普通pip安装torch而未固定CUDA轮子，不保证CUDA版。[深度脚本](<E:/ai/ai-depthmap/depthmap.py#L7-L14>)按torch.cuda.is_available选择设备，当前会走CPU。本轮只读它们，未运行批处理、更改pip配置或包。

指定环境还缺einops/timm/yacs/smplx/psutil/pytorch_lightning/omegaconf等HMR依赖。不可把原CPU venv整包优先塞到sys.path来假称CUDA，以免遮蔽CUDA torch或混用编译包。

## 推荐接续方案（待确认）

1. 优先新建独立HMR CUDA测试环境，保留外部深度项目和原CPU HMR环境；生产服务/网页代码不变。使用与原HMR锁定依赖相容的CUDA版torch/torchvision，具体Python基础运行时及官方wheel选择在实施前核对，不默认更换外部项目包或全局pip源。
2. 或由用户提供另一个实际可用的CUDA python.exe，先重复torch/驱动/小算子及依赖检查，仍不自动安装到用户已有环境。
3. 不重下载或重写HMR/SMPL权重，复用本机原checkpoint和冻结的三图实际xyxy/精确FP32输入；新输出单独保存，不覆盖旧CPU对照或历史七JSON。

## GPU对照设计（未执行）

- 在同一GPU、torch版本和原生代码中比较FP32、网络权重/输入FP16，SMPL/相机投影统一FP32；AMP作为可选第三方案，明确FP32权重＋autocast Half并不是Half权重存储。纯Half零token适配与head内6D解码精度必须披露。
- GPU FP32作为主数值参考；CPU基线只作第二一致性诊断，不把后端/版本差异全部归到FP16，也不要求CPU/GPU位级相同。
- FP32明确禁用TF32，统一eval/禁梯度/输入/框；不同模式分进程，防权重或cast cache累积。计时用CUDA事件及同步，记录预热/热推理、CPU墙时与传输/网络/LBS/投影边界，避免仅测GPU异步提交。
- 记录allocated/reserved/峰显存与开始/结束设备空闲、CPU RSS/峰值；AMP缓存和纯Half分别统计。OOM或缺CUDA不得替换成CPU并标GPU通过，不操纵其他用户GPU进程。
- 对照25点XYZ欧氏mm、原图XY px、相机/betas/24旋转、足轴/normal/左右膝/出画点；保持原生左右，不以三图相近声称真值或质量改善。保护原模型/源文件/输入/旧七JSON和CPU报告，前后SHA复核。

## 模块、风险、工时与门禁

方案见[Human设计](../design/mmd-human-interface.md)和[spec](../spec/mmd-human-interface.md)。受影响仅获准后新建的本机测试环境和精度结果，不更改生产MediaPipe/IK/API、外部深度项目源码、模型或Offline状态。需要安装时仅新增独立目录，具体目录/依赖方案先确认；不复制私图到Git、不下载其他已清理模型。

初估环境准备20～60分钟＋三图对照/复核20～40分钟，依赖CUDA轮子网络、驱动兼容和空闲显存，不保证固定工时或GPU加速倍数。GTX 1660需实测性能，不能直接套用CPU FP16慢8倍或其他GPU结论。当前仅环境/源码只读核对、记录方案，没有GPU推理、依赖安装、模型加载/导出、服务启动、构建/发布、PID操作或代码修改。
