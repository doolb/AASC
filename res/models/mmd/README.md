# 本地 MMD 资源

使用下面的命令从本地下载目录解压 PMX 模型和 VMD 动作：

```powershell
npm run prepare:mmd-model
```

也可以显式传入压缩包：

```powershell
node scripts/models/install-local-mmd-assets.js `
  --model-zip 'D:\down\a6fc97ed31db587c30d49d49d53939c7.zip' `
  --motion-zip 'D:\down\半成品_by_爱打游戏的柠檬茶_7979ff2612c650d9094502210c9781bf.zip'
```

生成的本地服务 URL 为：

- `/models/mmd/miya/miya.pmx`
- `/models/mmd/miya/tex/` 和 `/models/mmd/miya/toon/` 下的相对纹理
- `/models/mmd/motions/miya-default.vmd`
- `/models/mmd/manifest.json`

外网发布时保持相同的 `mmd/miya`、`mmd/motions` 和 `mmd/manifest.json` 相对目录，服务端只发布清单声明的资源。当前阶段不处理 Offline APK，也不上传外网。

生成的 PMX、纹理、VMD 和 manifest 属于本地构建产物，不提交到 Git；脚本和本说明文件提交后即可在其他环境重新生成。
