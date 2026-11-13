# 黄金天眼行情 CLI

需要 Node.js、ADB 和已连接的 Android 设备。走势图截图还需要 ImageMagick（`magick` 命令）和 `chafa`。手机需要事先解锁并联网；脚本会唤醒屏幕、打开黄金天眼并切换到所需页面。如果 App 有其他弹窗、权限请求或需要登录，请先在手机上处理。

```sh
# 多设备时用 -s 指定序列号；只有一台设备时可省略
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 quote
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 quote --json

# 持续采样并保存，按 Ctrl+C 停止；每轮采集结束后等待 30 秒
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 watch --interval 30

# 截取 App 首页近一月走势图，并在终端用 chafa 显示
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 chart 1m
# 显示天眼金价约一周的 4 小时 K 线图
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 chart 1w
# 约两周或三周
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 chart 2w
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 chart 3w
# 显示天眼金价的周线 K 线图
node scripts/gold-eye-cli.js -s 192.168.1.6:5555 chart weekly
# 也可选择 live（实时）、3m（近三月）、6m（近半年）、1y（近一年）

# 显示本工具先前采集的天眼金价趋势
node scripts/gold-eye-cli.js trend AUS
```

行情命令只读取列表中当前可见的条目，滚动或切换分类会改变可见内容。截图命令显示 App 的图表，不会提取图表的原始数据；图表需要在首页可见，若首页滚动到其他位置，请先在手机上滚回价格趋势处。`trend` 则只显示本工具运行期间采集的数据，横轴是采样顺序。

`1w`、`2w`、`3w` 分别使用行情详情的 4、8、12 小时 K 线图，当前缩放下大约显示一、二、三周，并不保证精确的天数；实际范围取决于 App 的缩放状态和交易时段，以图中时间轴为准。`weekly` 为周线，每根 K 线代表一周。这些选项都需要行情列表中可见天眼金价（AUS）。

截图等比例缩放以适应终端宽度和高度。如果字符单元格宽高比与 chafa 默认的 1:2 不一致，可以通过环境变量调整，例如 `GOLD_EYE_FONT_RATIO=0.55 node scripts/gold-eye-cli.js chart 1w`。该数值应为终端字符格的宽度除以高度。

采样默认保存到 `~/.local/share/gold-eye-cli/history.jsonl`，可在子命令之前加 `--history 路径` 指定其他文件。采集时间是本机时间（JSON 中为 UTC），不代表行情更新时间；App 的数据可能延迟或显示 `--`，脚本无法验证其实时性。锁屏或 ADB 断开时需恢复设备连接后重试。

在交互式终端中，`watch` 使用单独的终端画面原地刷新，退出后恢复原画面；`--json` 或重定向输出时，仍逐条输出，便于管道处理。
