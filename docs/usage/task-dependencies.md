# 模型推理任务的运行库准备

服务v87/依赖组合v10及独立ORT/Pi运行库已发布，Android基础层复用v9。部署该版本后下列行为生效。

首次运行“模型推理”任务时，提供网页的Node服务会自动准备ONNX Runtime Web，任务进度显示“准备任务依赖”。下载并校验成功后才开始推理；失败会显示任务错误，可以重新运行。Android Offline本机服务和Windows/Linux服务使用相同机制。

同一个服务上的多个任务共享下载。已下载并校验的运行库会保留，后续任务和重启后的任务可复用缓存；有缓存时不需要联网准备运行库。停止等待中的任务后不会自动继续执行。

普通页面打开和新版Offline基础安装不准备ORT。此运行库与LFM-VL模型文件独立，模型文件仍按原模型流程加载；显示端必须具备WebGPU。已有旧APK和旧common包中的ORT可继续使用，实际安装体积须在更新基础依赖或安装新整包后核对。

运维验证：`npm run test:task-dependencies`；本机有Chromium和可选ORT包时可运行 `npm run test:task-dependencies:browser`。

## PiAgent 配置

服务v87支持PiAgent可选依赖。将LLM配置设为Agent/Pi并保存时，若服务缺少Pi依赖，会提示下载。确认后先准备依赖，成功才保存；取消或下载失败恢复原配置。已有校验缓存时不会重复提示。服务启动会检查当前选中的Pi配置，缺少依赖时自动准备；普通LLM/Codex及未使用的Pi配置不下载Pi。另一控制端同时修改配置时，以服务器返回的当前配置为准，需要重新编辑保存。

Pi与模型文件分别准备，下载SDK不代表本机LLM模型已就绪。自测：`npm run test:pi-optional`。
