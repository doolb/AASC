# SQuadGen 远端 GPU 官方示例测试

日期：2026-11-25。状态：部署与测试完成，候选几何验收失败。

## 任务与授权

用户要求停止本机 CPU 官方示例，使用 `ssh as@192.168.1.101`，文件放在 `I:/ai` 测试。凭据仅用于登录，不写入源码、配置或文档。范围为此前官方 `3_holes.ply` 的完整参数推理；传输 LoRA 实现但不启动领域训练。

09:36 检查时原 CPU 任务进程和监控进程已不存在，最后日志为 09:29 第 30 次网络评估、t=0.24974，没有退出原因或网格。保留原日志，将仍显示 running/waiting 的状态文件标为 stopped-process-already-exited，并记录用户停止指示；未声称发送了实际未发送的终止信号。

## Design 与 Spec

- [设计](../design/retop-ai-squadgen.md)、[伪代码](../spec/retop-ai-squadgen.md)、[goal](../../goal.md)。
- 独立目录 `I:/ai/SQuadGen`，保留同目录其他 AI 项目；Windows 10、RTX 2080 Ti 22528MiB、约 32GiB RAM，初始 I 盘约 25GiB 可用。
- 输入与缓存保持原始 source SHA、CPU 贪心 FPS/PCA、0.2% 查询代理，共 710290 查询点；GPU 重新编码、从 seed 0 重新采样，不伪称接续 CPU 未保存的 ODE 状态。
- FP32 / res 8192 / Dopri5 / 50 保存时间点 / 官方平滑；CUDA RNG 与 CPU RNG 分开记录。推理默认 16GiB PyTorch 分配器上限，不把它称为整机显存上限。
- 分块只沿 attention query 维度，全部 key/value 保留；保留 batch/head 维度并与原注意力进行数值对照。此为内存实现适配，不降 res，不改积分步数和模型权重。
- Windows 缺原生 QuadTools 时回传本机提取与五视图审计，再同步结果到目标机。

## 受影响代码与资源

- 新增 `/mnt/SQuadGen/local_gpu/attention.py`、`run_example.py` 与说明；前者仅供 no_grad/eval，后者分阶段编码/采样/解码并记录 CUDA 时间和峰值。
- `local_cpu/run_shoulder.py` 的 resource 导入改为可选，Windows 可复用模型构造；Linux 原路径保留。
- 传输源码、Git 版本元数据、LoRA、示例、约 4GB 已核对权重和可信缓存，排除 Linux .venv/构建产物。
- 使用 I 盘独立 Python 3.11 和 CUDA PyTorch 环境；不更改现有 Hypir/Nunif 环境，未提交/推送 Git。

## 自测与验收

1. 输入/两份权重/缓存 SHA-256 核验，源高模不修改。
2. CPU/CUDA 分块注意力与原实现 FP32 对照，rtol=1e-5、atol=1e-6，包含交叉注意力与多个 batch/head。
3. 真实 8192 推理，记录 NFE、积分时间、编码/采样/解码耗时、CUDA allocated/reserved 峰值及失败异常。
4. SQ-VAE 缓存查询与原 decode_batch 对照，再输出完整场。
5. 实际四边提取、拓扑/退化/严格三角化及双向抽样误差，正/侧/顶/背/斜五视图，左原高模右候选。
6. 结果回传 I 盘，记录实际结果；仅生成完成不能作为可用重拓扑验收。

## 风险、兼容与工时

Windows 依赖/编译工具缺失、Turing 注意力后端限制、FP32 OOM、采样自适应评估次数不确定。独立环境、完整键值查询分块、分阶段驻留与 Linux 提取后备处理；失败原样记录，不自动降低用户指定模型参数。

预计环境与入口适配约 0.5～1 人日，下载和推理等待另计；按实测更新。任务不涉及主工程发布或 Offline 产物。

## 执行记录

- 源码/示例/权重已传输；两份远端权重 SHA-256 与本机一致。
- Python 3.11.18 / torch 2.8.0+cu126 独立环境完成，sm75/CUDA 实机推理通过。
- GPU 生成与 Linux 提取/检查已完成；质量失败原因和资源实测如下。

## 2026-11-25 远端实测结果

官方底模完整参数的适配入口已完成推理、提取和五视图检查，候选质量不通过。结果目录：`I:/ai/SQuadGen/results/official-3holes-gpu`；本地镜像 `artifacts/squadgen-official-3holes-gpu-2026-11-25`。保持 FP32/res8192/Dopri5/seed0，没有启用 LoRA 或 Qwen。

- 编码 14.11 秒；采样核心 1346.44 秒（22.44 分钟），182 次网络评估；成功解码 17.69 秒。阶段时间含启动/加载，采样核心另计。
- PyTorch 峰值 allocated 3.54GiB、reserved 4.11GiB；采样时 nvidia-smi 约 4714MiB。仅推理观测，不能证明训练在 16GiB 内可行。
- 第一次解码探针 offset3 差约 2.80e-6，原因是 PCA 查询列主序布局与官方 decode_batch 内部 cat 不同。转连续布局后所有输出分量对照差为 0；容差未放宽、权重未改、没有重新采样，只复用 latent 重跑解码。保留原 all 失败状态与日志，最终恢复状态在 final-report.json。
- QuadExtraction 生成 2300 顶点、2304 个原生四边面；单连通体、边界边 0、非流形 0、Euler -4。62 个面无法严格三角化，自交对数为未知，不能记成 0。
- 每方向 5000 个固定种子表面样本：原模→候选 P95 24.658% 包围盒对角线，候选→原模 4.387%。不是精确 Hausdorff；无效面三角代理只供诊断。
- 五视图显示沿 X 轴严重压缩、折叠。原模 X 范围约 0.00033～0.99941，候选约 0.27247～0.71877；查询逆变换对原代理面中心最大误差 1.07e-7，代理 bounds 与原模相近。尚未定位生成/提取质量根因，不能归结为缺少语义模型。
- 源高模未改动；原始网格不做修复，失败样本与日志保留。下一步应先核对官方入口一致性、采样/表示与 SQ-VAE 重建上限，再开展肩甲默认参数和 LoRA 质量对照。

### 官方效果差异核查（2026-11-25）

本次是官方权重/主参数的适配入口测试，不能称为原版流程严格复现。核对两份 checkpoint 配置与 squadgen/network/config 配置内容一致；采样平滑、Dopri5 默认容差、50 保存时间点与官方实现一致。尚未对整条官方入口做端到端 A/B。差异包括 CPU 贪心 FPS 缓存、OBJ 查询代理格式、Windows/PyTorch 2.8.0+cu126、query 分块注意力及缓存解码；官方 README 推荐 Linux/PyTorch >=2.9.1/CUDA >=13。这些是待隔离变量，不是已确认根因。局部注意力和解码数值检查不能代替整模型/整链等价验证。

复用同一 extract_mesh.npz 与同一查询代理，仅把 QuadExtraction 的 -s 3 -r 15 改为 -s 0 -r 0，输出到独立 diagnostic-no-smoothing 目录，未覆盖原结果。得到 35 顶点、33 粗面（24 四边、6 五边、3 六边），X 范围 0.30469～0.68543；压缩在初始提取时已经存在。因此不能把严重失真单独归因于最终细分和平滑；原 2304 四边面包含后续细分，不能代表 2304 个正确预测布局面。尚不能区分预测 CDF/offset 场异常与初始提取问题，也不能据此断言模型不行或需要 Qwen/LoRA。

诊断产物：artifacts/squadgen-official-3holes-gpu-2026-11-25/diagnostic-no-smoothing/{extracted_quad.ply,run.log,comparison.json}。下一步先做原版入口对照及实际权重下全尺寸中间张量比较，再做可视化 CDF/offset 与初始提取核查；不以重新训练代替复现排错。
