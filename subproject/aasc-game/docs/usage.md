# 使用说明

1. 两台设备连接允许互访的同一 Wi-Fi。
2. 房主打开 APK，选择“开启本机房主服务”，输入昵称后展示房间和二维码。
3. 另一位玩家使用系统相机扫码，在浏览器打开房主地址；也可在 APK 或网页客户端中输入地址或选择二维码图片。
4. 房主选择棋盘尺寸并点击“设置尺寸”，两位玩家在线后点击“开始对局”。黑棋为房主、白棋为加入者。
5. 断线后客户端自动重连；房主关闭应用后重新开启服务，恢复已保存的棋局和座位。手机必须保持房主服务运行，浏览器才能连接。

网页摄像头扫码需要浏览器允许摄像头并满足安全上下文要求，普通局域网 HTTP 页面通常不具备此条件。二维码链接可由系统相机打开，不依赖网页摄像头权限。当前没有公网中转和代码热更新。

## Node.js 内网中转

先在有 Node.js 的内网机器安装依赖并运行 `AASC_GAME_BIND=<该机器内网IP> npm start`；端口默认 8787，可用 `AASC_GAME_PORT` 修改。默认监听 `127.0.0.1`，只供本机访问；显式使用本机内网 IP 才能供其他内网设备连接。浏览器或 APK 输入中转地址，在页面点击“创建游戏房间”，分享生成的房间二维码或链接。棋局由创建房间的网页保存与校验，中转只按房间转发；房主断线期间对局暂停。请保留房主浏览器站点数据，丢失这些数据后无法恢复原房主身份。

创建中转房间前可从游戏目录选择游戏，目前正式提供五子棋。邀请链接绑定游戏和协议版本，旧版五子棋邀请仍可使用；其他客户端缺少对应游戏或协议版本时会提示。APK 的“开启本机房主服务”当前仍只提供五子棋。

## 开发：添加游戏

在 `games/catalog.js` 声明稳定 ID、协议版本、人数范围及允许的操作；在 `games/modules.js` 注册对应网页模块。模块提供房主管理器（`Host`，实现 `presence` 和 `apply`）及画面的 `init`、`render`，按自己的状态结构处理权威快照。中转负责座位和消息转发，不实现游戏规则。修改后运行 `npm run test` 和 `npm run build:web`；发布 APK 前还需构建 APK。当前注册是构建时静态注册，不支持直接安装第三方游戏。若新游戏还需要 APK 原生房主模式，须另实现 `NativeRoom` 并在原生 `RoomServer` 中注册；未注册时会被明确拒绝。


## 提取猪了个猪关卡

需要 Linux、Python 3、OpenCV（`cv2`）、NumPy 和 ImageMagick 的 `import`。在本目录运行，关卡编号自行填写：

```sh
npm run extract:pig -- --level 2 --image docs/references/pig-game/level-02-initial.png --output /tmp/pig-level-02
npm run extract:pig -- --level 3 --display :1 --window-id 0x窗口ID --output /tmp/pig-level-03
```

第二条的 `0x窗口ID` 换成游戏窗口真实的十六进制 X11 窗口 ID。可在切到游戏窗口后用 `DISPLAY=:1 xprop -root _NET_ACTIVE_WINDOW` 查询活动窗口 ID；从同一显示器的终端执行时先运行 `sleep 3; DISPLAY=:1 xprop -root _NET_ACTIVE_WINDOW`，再于 3 秒内切换至游戏。脚本截取指定窗口并检查画面中的“猪了个猪”标题；窗口被遮挡或缩放过大时可能校验失败，此时调整窗口再试。可用 `--crop x,y,宽,高` 裁剪窗口内区域，并用 `--board x,y,宽,高` 调整棋盘范围；坐标以图片左上角为原点。可选的 `--grid 首格中心x,首格中心y,格距,列数,行数` 基于用户校准值估算双格位置。

输出目录不能已存在，包含 `original.png`、`annotated.png` 和 `level.json`。数字对应 JSON 中的猪编号，箭头表示推断方向，八个方向采用不同颜色并在右上角显示图例；图片右侧按编号列出窗口截图内中心坐标和方向，橙色表示方向不明确，紫框表示疑似游戏内引导手指。JSON 的 `gesture_candidates` 为手指候选框，`gesture_occluded` 表示与手指候选框重叠；重叠小猪的方向保守标记为 unknown。当前只匹配已观察到的引导手指样式，可能漏检或误检，不识别摄像头手势。识别结果均为待复核候选，数量正确也不表示所有方向正确；不会自动操作游戏。执行 `npm run test:pig-extract` 验证提取器。


## 自动游玩当前猪关卡

Linux X11 上需要 Python 3、OpenCV、NumPy、ImageMagick `import`、`xprop`、libX11 和 libXtst。把游戏窗口切到前台并查询窗口 ID 后运行（将示例 ID 换成真实值）：

```sh
npm run play:pig -- --level 2 --display :1 --window-id 0x3c00003 --output /tmp/pig-play-level-02-run-1
```

输出目录必须不存在。脚本先保存 `initial.png` 与 `initial-layout.json`，使用候选占格及假设的“滑到障碍前或离开”规则搜索完整路线，记录 `plan.json`；没有找到完整路线、达到搜索上限或识别不稳定时不会点击。找到计划后，每次操作前重识别并核对棋盘是否符合计划；匹配才点击对应猪。默认不保存每步截图；结束、偏离或中断时保存结果画面和 `result.json`。通关后停止，不点击道具或切换关卡。

第 2 关基于已保存画面使用参考网格；其他网格关需用 `--grid 首格中心x,首格中心y,格距,列数,行数` 指定参数。`--search-states`、`--search-timeout`、`--max-steps` 限制搜索和动作，`--wait` 设置点击后的等待时间。网格坐标和碰撞行为由截图推断，计划只是模型候选；实际画面与计划不符时会停止，不意味着游戏无解。窗口必须保持前台、没有被其他窗口遮挡。

`npm run test:pig-solve` 验证搜索、滑动与计划偏差保护；`npm run test:pig-play`、`npm run test:pig-extract` 验证已有功能。


## 连续自动采集猪关卡

从当前已打开的关卡开始：

```sh
npm run auto:pig -- --start-level 4 --display :1 --window-id 0x游戏窗口ID --max-levels 100
```

若当前停在上一关的通关浮层，增加 `--from-victory`；这要求上一关截图位于 `play-runs/level-上一关-color-arrows/original.png`，或通过 `--previous-initial 路径` 指定，用来核对关卡标题变化。`--start-level` 由使用者提供，不宣称 OCR 校验了初始编号。

每关在 `docs/references/pig-game/play-runs/level-编号-run-时间/` 创建独立目录。`original.png`、`level.json`、`annotated.png` 是首次点击前的画面和候选；`level-reviewed.json`、`plan.json` 保存多帧校验后的布局和完整计划。动作只有在后续实际画面核对后才生成 `action-编号.json`。通关后保存 `victory.png`、`solution-order.json`、`solution-order.png`，顺序图在初始猪的位置显示所有有效步骤号，右侧列出步骤。每步画面默认只在内存中使用。

只在识别成功标题及“下一关”按钮后切关；已观察的领奖和排名会先保存再关闭。新动物说明会先保存并暂停，由操作者观察并点击新物件后再继续。发现小黄鸭等尚未建模对象时保存候选与标注并停止，不把它们当空格。关内三个道具不会点击；窗口失焦、棋盘/界面识别不可靠、搜索失败或实际状态偏离时保存 `interrupted.png` 和 `result.json` 并停止。小猪外框 `visual_bbox` 是身体候选框加边距的视觉估计，可能包含邻居，不等于游戏碰撞框。`npm run test:pig-auto` 执行连续采集测试。

已保存且人工复核的鸭子局面可显式传入 `--reviewed-layout 路径`，仅首关使用该布局；另可用 `--duck-auto` 对后续含鸭关卡先多帧识别，再启用鸭子绕行假设。两种方式均先保存完整计划并逐步验证猪鸭位置；默认不启用，假设不符会停止。中途局面的步骤图只代表本次运行。

失焦等原因中断后，可用 `npm run resume:pig -- --source 中断目录 --display :1 --window-id 0x窗口ID` 续跑。脚本在新目录复用原布局、计划和已确认步骤，对照画面确认待处理动作是否生效，再沿原计划执行；无法唯一确认时停止。通关顺序图包含中断前后确认的步骤。

使用黄色候选复核过滤的计划会在续跑时继承过滤设置；旧计划经画面复核后可显式加 `--filter-outside-yellow`。

已观察到朝下小象时，可使用 `npm run unlock:pig -- --level 21 --display :1 --window-id 0x窗口ID --advance-object --max-stages 12` 搜索释放小象前方的阶段计划。脚本保存布局、计划和已确认动作，再尝试点击小象并从新画面搜索；视觉占格与真实阻挡可能不同，状态不符会停止。各阶段结果在独立 `play-runs/level-21-unlock-*` 目录，阶段完成不表示整关通关。

小象方向由画面核对后通过 `--direction north|south|east|west` 指定，默认向下；阶段目标及后续移动验证均按该方向计算。

已将小象建入矩形布局并得到完整候选时，可用 `npm run elephant:pig -- --level 26 --display :1 --window-id 0x窗口ID --layout 布局.json --candidate 候选.json` 独立复算并逐步核对执行；小象位置或行为与候选不同时停止并保留现场。

跨阶段关卡通关后，可用 `npm run merge:pig -- --event stage=首阶段目录 --event object=小象操作证据.json --event stage=后续阶段目录 --output 新目录` 按实际顺序合并。每次小象操作与每段猪操作均需独立指定事件，最后阶段必须保存通关画面；身份或确认数不匹配时拒绝合并。

较难关卡可以同时提供 `--reviewed-layout 路径 --candidate-plan 路径`：程序先使用现有占格规则逐步独立重放候选计划，核对每步猪的位置、长度和鸭子的变化，并确认终态全部离场；任何非法动作或不完整终态都会在点击前拒绝。实际执行仍逐帧匹配画面。

常规搜索全部超时后，脚本可在本机有 `g++` 且布局规模适用时，临时编译并运行项目自带的快速离线遍历；输出仍需通过上述独立重放。编译器缺失、超时或找不到可校验路径时安全停止，不判定关卡无解。
