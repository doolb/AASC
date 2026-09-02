# 无限暖暖图片流程

当前 ADB 设备没有启动《无限暖暖》，且未发现对应应用包，因此这里暂不伪造或复用其他应用的截图模板。

准备好游戏画面后，先用只读截图生成模板：

```bash
npm run capture -- --device 192.168.1.6:5555 --flow infinity-nikki --name enter-game@0.90
```

如果画面中有“放弃福利”按钮，确认截图只覆盖该按钮后，再把模板命名为 `enter-game@0.90,goto@home.png`；真实点击前先执行：

```bash
npm run inspect -- --device 192.168.1.6:5555 --flow infinity-nikki
npm run start -- --device 192.168.1.6:5555 --flow infinity-nikki --dry-run --once
```

本目录不自动生成领取、购买、广告或改变账号资源的动作。`goto@home` 只在真实点击成功后切换到 `home` Flow。
