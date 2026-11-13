# 猪了个猪：实机关卡记录

来源：2026-11-12 在 DISPLAY=:1 的现有游戏窗口中观察。图片只截取游戏窗口，保留原始像素，供后续比较；坐标以截图左上角为原点，仅作近似标注。每关完成前先保存初始画面与观察，操作后另存状态，不覆盖旧图。

用户确认各关布局固定，因此以关卡编号为键逐关记录；原始截图和逐项校准后的坐标均需保留。关卡总数尚未确认。

## 第 1 关

- 初始画面：[level-01-initial.png](level-01-initial.png)，截图约 529×941；场景为竖屏草地，上方显示“第1关”和计数 0。
- 棋盘有 6 只粉色小猪，分布在中央偏下；以小猪身体中心粗略记录为 `(317,412)、(232,460)、(272,500)、(351,500)、(185,535)、(271,589)`。前进方向由猪头朝向决定，图上高亮边框与手势属于新手提示；具体遮挡边界尚待进一步观察。
- 引导文字：“点击小猪向前移动”。底部可见“移除”“洗牌”“翻转”三个道具，洗牌角标为 1；暂未验证消耗规则。
- 第一次点击高亮小猪后，该猪离开、计数从 0 变 1，剩余 5 只；状态见 [level-01-after-first-action.png](level-01-after-first-action.png)。
- 第二次点击左侧小猪后，该猪离开、计数从 1 变 2，剩余 4 只；状态见 [level-01-after-second-action.png](level-01-after-second-action.png)。
- 第三次点击后计数为 3、剩余 3 只，见 [第三步](level-01-after-third-action.png)；下一次点击后计数为 5、剩余 1 只，见 [第四步后](level-01-after-fourth-action.png)。两只相继消失的触发原因尚未确认，不能据此推断组合规则。
- 最后一只离开后出现“挑战成功”，背景变暗、金色横幅与光芒、奖励星星 +1 和金币 +6、中央大猪与下方进度轨道；底部依次为“返回主页”“下一关”和“炫耀一下”（金币 +200）入口。见 [通关界面](level-01-victory.png) 和 [转场初始帧](level-01-after-final-action.png)。未点击分享或奖励入口，是否需要外部分享待验证。

## 第 2 关

- 刚进入时先保存 [完整初始画面](level-02-initial.png)，此前没有对第 2 关作任何点击。顶部显示“第2关”，金币计数承接为 6。
- 按截图可见的粉色轮廓和眼睛位置提取出 61 只小猪的候选位置、朝向及约 12×15 网格，见 [候选数据](level-02-candidate.json)。该数据完全从画面像素推测，尚未逐项核实，不宣称是准确的原游戏数据；坐标换算后没有网格重叠。
- 点击顶行最右、面向右的小猪后，它离开棋盘，金币 6→7，见 [第一次操作](level-02-after-first-action.png)。随后点击左上面向下且前方有其他小猪的小猪，静止画面保持不变、金币仍为 7，见 [阻挡尝试](level-02-after-blocked-attempt.png)；碰撞瞬间的动画仍需另行观察。
- 再次点击该被阻挡小猪并用 X11 屏幕录制提取连续画面，可见短暂碰撞火花及猪体位移动作，之后回到原位置；四帧对照见 [碰撞动画](level-02-blocked-animation.png)。录制内容只来自游戏窗口，没有读取进程或网页内部数据。
- 基于首屏像素候选布局，通过画面和 X11 逐只点击前方无遮挡的小猪；总共移走 21 只，金币从 6 增至 27，保留 [第 2～21 次操作截图](level-02-step-21.png)。当前截图显示连击 ×20、剩余约 40 只；依据候选网格推算暂时没有无遮挡的直线出口。这是基于像素推算的观察，不排除识别或规则不完整。
- 在保存该局面后点击一次显示数量为 1 的“洗牌”，结果见 [洗牌后](level-02-after-shuffle.png)：像素检测仍为 40 个候选小猪，部分小猪朝向改变，道具上的数字角标消失；视觉观察不能证明所有猪的位置都没有变化。


## 自动提取候选

- [第一关标注图](extractions/level-01-original/annotated.png)与[候选数据](extractions/level-01-original/level.json)：6 只，其中 1 只因手势遮挡方向未知。
- [第二关初始标注图](extractions/level-02-original/annotated.png)与[候选数据](extractions/level-02-original/level.json)：61 只；网格参数依据截图估算，所有方向和位置仍需逐项复核。

- [第一关手指标注及位置朝向表](extractions/level-01-gesture-overlay/annotated.png)：紫框为手指候选，与其相交的小猪方向为 unknown；[第二关位置朝向表](extractions/level-02-coordinate-overlay/annotated.png)列出全部 61 个候选。

- [第一关人工标注与方向颜色](extractions/level-01-manual-direction/annotated.png)和[对应数据](extractions/level-01-manual-direction/level.json)：手指遮挡的 1 号猪根据可见头部人工标为左上，示意角度 225°；自动输出仍为未知，未经过独立验证。该人工修正保存在独立输出中，不会自动应用于脚本的新输出。
- [第二关方向颜色图](extractions/level-02-color-arrows/annotated.png)：右上图例列出方向对应的颜色。

- 自动游玩第 2 关实测：从此前局面继续，金币计数升至 46，最后保存[当前局面](play-runs/level-02-run-20261112-04/step-015.png)，识别约 21 只候选。脚本曾重复尝试阻挡目标，已按用户要求停止；画面中的方向、剩余数与阻挡关系仍需复核。

- 离线识别复核：第 2 关初始与重开截图的 61 个候选位置可对应，2 只方向出现已知/未知波动；现有 bbox 是腐蚀后的身体范围，不保证覆盖头尾。内缩 bbox 6 像素的[假设搜索结果](level-02-search-hypothesis.json)找到两条 61 步计划，但碰撞规则和方向仍未验证，不能用于实机点击。

- 移动证据：`play-runs/level-02-run-20261112-04/state-004.json` 和 `state-005.json` 之间，点击向左的猪后中心约从 (418,478.5) 变为 (388,479)，数量仍为 23；说明脚本之前把可能的棋盘内移动误判为失败。以“滑到障碍前或离开”为未经验证的规则，初始局面得到[73 步离线候选](level-02-sliding-search-hypothesis.json)，已记录的 40 只局面得到[52 步离线候选](level-02-current-sliding-hypothesis.json)。

- 重新开始第 2 关后，[初始画面](play-runs/level-02-planned-20261112-03/initial.png)、[初始候选布局](play-runs/level-02-planned-20261112-03/initial-layout.json)和[完整计划](play-runs/level-02-planned-20261112-03/plan.json)已保存；61 只候选，一只因红色高亮而使用完整布局匹配的参考方向。计划 73 步，含 12 次留在棋盘的移动。按计划执行并验证后[挑战成功](play-runs/level-02-planned-20261112-03/result.png)，画面显示星星 +1、金币 +61；未点击三个道具，脚本停在成功画面。


## 第 3 关

- [初始画面](play-runs/level-03-color-arrows/original.png)、[原始识别数据](play-runs/level-03-color-arrows/level.json)及[方向标注](play-runs/level-03-color-arrows/annotated.png)在任何关内点击前保存；识别 76 只候选，22 和 52 号方向在[人工复核数据](play-runs/level-03-color-arrows/level-reviewed.json)中标为向右。
- 搜索的 82 步计划经实时核对执行通关，其中 6 次为棋盘内滑动；暂停期间一次未生效的点击未算作有效步骤。[顺序图](play-runs/level-03-color-arrows/solution-order.png)、[步骤 JSON](play-runs/level-03-color-arrows/solution-order.json)、[通关界面](play-runs/level-03-color-arrows/victory.png)、[小羊奖励](play-runs/level-03-color-arrows/reward-popup.png)、[排名界面](play-runs/level-03-color-arrows/ranking-popup.png)均已保存；未点击关内三个道具。

## 第 4 关

- 已在操作前保存[初始画面](play-runs/level-04-color-arrows/original.png)和[初始候选](play-runs/level-04-color-arrows/level.json)；自动搜索并验证 94 个有效步骤后[通关](play-runs/level-04-run-20261113-000421-325943/victory.png)，保存[步骤顺序图](play-runs/level-04-run-20261113-000421-325943/solution-order.png)及[步骤数据](play-runs/level-04-run-20261113-000421-325943/solution-order.json)，未使用底部道具。

## 第 5 关

- 首次进入显示[小黄鸭说明](play-runs/level-05-run-20261113-001017-609693/original.png)，说明称其会自己逃跑；关闭后保存[初始画面](play-runs/level-05-color-arrows/original.png)、[猪候选](play-runs/level-05-color-arrows/level.json)及[鸭子候选](play-runs/level-05-color-arrows/level-ducks.json)，共约 81 只猪和 12 只鸭子。
- [第一次实验](play-runs/level-05-duck-probe-20261113-001948-418934/)因实验脚本变量复用误点另一只猪，猪由网格 (1,15) 移到 (2,15)，鸭子仍在原处；该目录的假设计划不能作为实际点击记录。随后[点击朝向相邻鸭子的猪](play-runs/level-05-duck-collision-20261113-002045-536201/)后，猪和鸭子稳定画面均未改变；[点击一只鸭子](play-runs/level-05-duck-direct-20261113-002128-188813/)后稳定画面鸭子仍在原位。动画帧识别数量会波动，不能据此判断消失。鸭子何时逃跑仍未确认，未经验证的假设计划不是完整关卡解。
- 当前局面下，临时离线试算把 12 只鸭子固定视为障碍，搜索约 56 万个猪位置状态后达到 110 秒上限；这不是无解证明，也不能推断鸭子保持不动直至通关。
- 实机运行连续脚本后检测到鸭子并以 `unsupported_entity` 安全停止，未点击棋盘；[当前画面与标注](play-runs/level-05-run-20261113-002519-485183/annotated.png)、[结果](play-runs/level-05-run-20261113-002519-485183/result.json)已保存。
- 用户操作后保存[画面与人工复核布局](play-runs/level-05-user-duck-evidence/)：顶部一只占据网格 (7,0)、(8,0) 的横向猪消失，同一区域四只鸭子消失，金币增加 5；另有一只猪从 (9,0) 移到 (9,1)。静态画面支持道路开放后鸭子自动离开和连锁反应，不能确认具体移动轨迹。用户补充鸭子道路开放时会走完。以网格可绕行出口为假设搜索当前局面，在 [第 5 关续跑](play-runs/level-05-run-20261113-022612-550658/)保存完整候选计划并逐步核对；此运行从用户操作后的局面开始。
- 续跑按计划完成 97 个有效步骤并[通关](play-runs/level-05-run-20261113-022612-550658/victory.png)，[顺序图](play-runs/level-05-run-20261113-022612-550658/solution-order.png)从用户操作后的局面开始。第 22 步和第 53 步各有四只鸭子自动离开，随后画面与预测一致；没有使用底部道具。

## 第 6 关

- [初始画面](play-runs/level-06-reviewed-20261113/original.png)包含 91 只猪和 9 只鸭子，多帧复核的[布局](play-runs/level-06-reviewed-20261113/reviewed-layout.json)已保存。由第 5 关切换后标题校验过于保守，现场已保存并修正阈值；首轮搜索达到时间上限，调整候选顺序后找到 136 步假设计划，正在 [自动运行目录](play-runs/level-06-run-20261113-023628-657405/)核对并执行。
- 第 75 步触发 9 只鸭子自动离开，与预测一致；第 99 步后失焦中断，重新匹配中断前状态后继续。最终 136 步[通关](play-runs/level-06-run-20261113-023628-657405-resume-20261113-024832-099017/victory.png)，[完整步骤顺序图](play-runs/level-06-run-20261113-023628-657405-resume-20261113-024832-099017/solution-order.png)合并了失焦前后的确认记录；未使用底部道具。

## 第 7 关

- 已保存[初始布局](play-runs/level-07-run-20261113-025137-642881/original.png)、[识别标注](play-runs/level-07-run-20261113-025137-642881/annotated.png)和多帧复核数据：90 只猪、14 只鸭子。首次完整搜索达到 15 秒上限，未进行任何关内点击；正尝试其他搜索顺序。
- 调整候选顺序后找到 110 步假设计划。两只上下相邻鸭子在部分动画帧的黄色区域相连，曾被误识别为 12 只，脚本因整局校验失败安全中断；对比静态截图发现实际为 14 只。修复相邻连通区域拆分后重新核对并续跑，所有已确认步骤保留。
- 棋盘清空后出现[火焰奖励](play-runs/level-07-run-20261113-025541-337610-resume-20261113-025819-134843-resume-20261113-030201-077883/interrupted.png)，奖励动画延迟导致末步确认超时；后续确认[挑战成功](play-runs/level-07-run-20261113-025541-337610-resume-20261113-025819-134843-resume-20261113-030201-077883-resume-20261113-031641-597239/victory.png)，保存[110 步完整顺序图](play-runs/level-07-run-20261113-025541-337610-resume-20261113-025819-134843-resume-20261113-030201-077883-resume-20261113-031641-597239/solution-order.png)。

## 第 8 关

- 切关首次截到[棋盘入场动画](play-runs/level-08-run-20261113-031707-204383/original.png)，仅显示一只猪，不是完整布局；脚本安全停止且未点击。随后保存[稳定初始画面](play-runs/level-08-initial-stable/original.png)，识别约 95 只猪，另在[运行目录](play-runs/level-08-run-20261113-031918-643511/)保存完整候选与 106 步计划，实机执行中。切关校验已增加棋盘界面载入和连续稳定帧确认。
- 已按 106 个确认步骤[通关](play-runs/level-08-run-20261113-031918-643511/victory.png)，保存[完整顺序图](play-runs/level-08-run-20261113-031918-643511/solution-order.png)，未使用底部道具。

## 第 9 关

- 稳定[初始画面](play-runs/level-09-run-20261113-033507-641375/original.png)与[识别标注](play-runs/level-09-run-20261113-033507-641375/annotated.png)已保存，识别 86 只猪和 35 只鸭子候选。自动尝试五种搜索顺序达到时限，未进行关内点击；继续试算其他顺序，不将超时当作无解。
- 优化鸭子连锁状态计算、尝试其他候选顺序后，找到 108 步假设计划并在[新运行目录](play-runs/level-09-run-20261113-033954-175322/)按完整猪鸭状态核对执行。边界可达性优化已与逐只搜索的参考算法做 100 组随机棋盘等价性测试。
- 已按 108 个确认步骤[通关](play-runs/level-09-run-20261113-033954-175322/victory.png)，保存[顺序图](play-runs/level-09-run-20261113-033954-175322/solution-order.png)，35 只鸭子按计划离开。

## 第 10 关

- 稳定[初始画面](play-runs/level-10-run-20261113-035654-230233/original.png)已保存，识别 73 只猪、49 只鸭子候选。首轮搜索达到时限后未点击，随后启用更多有界搜索顺序继续求解。
- 多顺序搜索得到 97 步计划，逐步确认后[通关](play-runs/level-10-run-20261113-035825-217213/victory.png)，保存[完整顺序图](play-runs/level-10-run-20261113-035825-217213/solution-order.png)。

## 第 11 关

- 出现[大长猪说明](play-runs/level-11-transition-20261113-041336-925227/animal-guide.png)，说明称身体特别长；[初始画面](play-runs/level-11-new-animal-observation/original.png)已在关内操作前保存。先[直接点击一只朝向受阻的长猪](play-runs/level-11-new-animal-observation/before-click.png)，[稳定画面](play-runs/level-11-new-animal-observation/after-click.png)中该猪未移动；未使用道具。
- 对 91 只猪、18 只鸭候选做六帧匹配及方向投票，得到[复核布局](play-runs/level-11-new-animal-observation/reviewed-layout.json)，其中 5 只猪按视觉长度估计为三格。长猪按三格阻挡和滑动的模型尚待实际移动验证，首轮完整搜索超时后正在尝试其他顺序。
- 重排候选得到 130 步计划，[实机执行目录](play-runs/level-11-run-20261113-042024-166140/)已确认第 37 步一只长猪离场、第 64 步另一只长猪在棋盘内滑动两格；后续画面与三格模型匹配，整关仍在运行。
- 已按 130 个有效步骤[通关](play-runs/level-11-run-20261113-042024-166140/victory.png)，保存[完整顺序图](play-runs/level-11-run-20261113-042024-166140/solution-order.png)；长猪多次滑动和离场均经过后续画面核对。

## 第 12 关

- 自动保存[初始画面](play-runs/level-12-run-20261113-044019-226731/original.png)与候选布局，识别 94 只猪、9 只鸭子，其中 3 只猪估计为三格；完整计划 120 步，实机核对执行中。
- 按 120 个确认步骤[通关](play-runs/level-12-run-20261113-044019-226731/victory.png)，保存[完整顺序图](play-runs/level-12-run-20261113-044019-226731/solution-order.png)。

## 第 13 关

- 已保存[初始画面](play-runs/level-13-run-20261113-045844-602128/original.png)与候选，识别 78 只猪，其中 6 只为三格长猪，未识别到鸭子；完整计划 106 步，实机执行中。
- 已按 106 步[通关](play-runs/level-13-run-20261113-045844-602128/victory.png)，保存[完整顺序图](play-runs/level-13-run-20261113-045844-602128/solution-order.png)。第一次切换点击未生效，仍停在通关界面，重新确认后成功切换。

## 第 14 关

- [初始画面](play-runs/level-14-run-20261113-051536-451410/original.png)包含 95 只猪、9 只鸭候选，其中 4 只猪为三格长猪；多顺序搜索得到 139 步计划，正在实机执行。
- 已按 139 个确认步骤[通关](play-runs/level-14-run-20261113-051536-451410/victory.png)，保存[顺序图](play-runs/level-14-run-20261113-051536-451410/solution-order.png)。

## 第 15 关

- [初始画面](play-runs/level-15-run-20261113-053746-730032/original.png)识别 86 只猪，其中 12 只为长猪，未发现鸭子。常规及多种顺序搜索达到时限，均未点击；快速离线遍历发现 132 步候选后，现有求解器使用确定性动作顺序独立复算，并逐步验证模型中的每个动作合法。随后[从首屏开始执行](play-runs/level-15-run-20261113-054747-612294/)，逐帧核对中。
- 已按 132 个确认步骤[通关](play-runs/level-15-run-20261113-054747-612294/victory.png)，保存[完整顺序图](play-runs/level-15-run-20261113-054747-612294/solution-order.png)。

## 第 16 关

- [稳定初始画面](play-runs/level-16-run-20261113-060659-207301/original.png)识别 85 只猪、25 只鸭候选；自动多顺序搜索超时后安全停止，未点击棋盘，继续离线遍历其他顺序。
- 更大规模遍历找到 157 步候选，[独立校验结果](play-runs/level-16-run-20261113-060659-207301/candidate-plan-independent-checked.json)由 Python 对每步可移动性、长猪占格及鸭子离场重放，终态全部离场；[新的运行目录](play-runs/level-16-run-20261113-061921-776407/)先再次校验完整计划及实时布局，再逐步执行。
- 已按 157 个确认步骤[通关](play-runs/level-16-run-20261113-061921-776407/victory.png)，保存[完整顺序图](play-runs/level-16-run-20261113-061921-776407/solution-order.png)。切关时出现延迟排名弹窗，已先保存、关闭并确认成功界面。

## 第 17 关

- 已保存[稳定首屏](play-runs/level-17-run-20261113-064412-574979/original.png)和候选，识别 94 只猪、19 只鸭，其中 1 只为长猪；多顺序搜索得到 137 步计划，实机执行中。
- 第 109 步两次尝试未改变稳定画面；另用指定 X11 窗口高速截图[记录动作](play-runs/level-17-step109-collision/fast-contact.png)，再次点击后小猪向左滑动两格，与计划一致。续跑比对到动作后的完整状态才将其记为一步，继续执行；未使用底部道具。
- 已按 137 个确认步骤[通关](play-runs/level-17-run-20261113-064412-574979-resume-20261113-070200-151449-resume-20261113-070455-372608/victory.png)，保存[完整顺序图](play-runs/level-17-run-20261113-064412-574979-resume-20261113-070200-151449-resume-20261113-070455-372608/solution-order.png)。

## 第 18 关

- [稳定首屏](play-runs/level-18-run-20261113-071003-420174/original.png)识别 89 只猪，未识别到鸭子；完整计划 148 步，实机执行中。
- 已按 148 个确认步骤[通关](play-runs/level-18-run-20261113-071003-420174/victory.png)，保存[顺序图](play-runs/level-18-run-20261113-071003-420174/solution-order.png)。

## 第 19 关

- 已保存[稳定首屏](play-runs/level-19-run-20261113-073031-920159/original.png)，识别 90 只猪、21 只鸭候选；多顺序搜索找到 132 步计划，正在逐步核对执行。
- 已按 132 个确认步骤[通关](play-runs/level-19-run-20261113-073031-920159/victory.png)，保存[完整顺序图](play-runs/level-19-run-20261113-073031-920159/solution-order.png)。

## 第 20 关

- 已保存[稳定首屏](play-runs/level-20-run-20261113-075006-115808/original.png)，识别 90 只猪、16 只鸭候选；完成 144 步并保存[步骤图](play-runs/level-20-run-20261113-075006-115808/solution-order.png)和[通关画面](play-runs/level-20-run-20261113-075006-115808/victory.png)。

## 第 21 关

- 保存[新动物说明和初始画面](play-runs/level-21-new-animal-observation/original.png)；小象直接点击一次后稳定画面未见移动，用户说明是前方有阻挡；小象自身的占格及离场行为仍需验证。
- [占格与外观对照图](play-runs/level-21-grid-outline-full/annotated.png)的青框为网格模型估计、绿框为小猪视觉候选、紫框为小象可见蓝色区域；扩展单次提取棋盘识别范围后得到 80 个猪候选，均得到占格估计，逐只准确性仍需复核。连续流程本来已使用较高棋盘区域；按用户授权以小象图像范围估计阻挡并开始阶段搜索，实际碰撞和离场规则仍需验证。
- [第一阶段计划与实测](play-runs/level-21-unlock-20261113-084810-441430/plan.json)使小象前方小猪向下移动一格；随后[点击小象前后](play-runs/level-21-elephant-open-path-20261113/observation.json)可见其向下移动约一格。[第二阶段](play-runs/level-21-unlock-20261113-085102-033013/plan.json)搜索 836 个状态得到 49 步计划，执行后小象离场，剩余小猪按 50 步计划通关。
- 已将各阶段 102 个确认步骤合并到[初始布局顺序图](play-runs/level-21-complete-order/solution-order.png)，其中第 2、52 步为小象移动；另保存[通关界面](play-runs/level-21-complete-order/victory.png)和[步骤数据](play-runs/level-21-complete-order/solution-order.json)。

## 第 22 关

- 已保存[初始画面与候选](play-runs/level-22-run-20261113-090005-363837/level.json)；小象仍朝下，[首阶段](play-runs/level-22-unlock-20261113-090048-269539/plan.json)的 68 步已确认，小象随后移动；[第二阶段](play-runs/level-22-unlock-20261113-090827-291008/object-action.json)小象离场。网格外黄色装饰被误判为鸭子，留证后排除并完成剩余小猪，[顺序图](play-runs/level-22-complete-order/solution-order.png)记录全部 103 步，[通关画面](play-runs/level-22-complete-order/victory.png)已保存。

## 第 23 关

- [初始画面](play-runs/level-23-run-20261113-091249-543193/original.png)可见九只相邻鸭子；原黄色掩码与沙色背景相连而漏检，补充画面模板后连续五帧九个鸭格一致。重新采集的[布局](play-runs/level-23-run-20261113-091615-217138/level.json)记录 85 个猪候选、九个鸭候选及三个排除的黄色候选；126 步完成通关并保存[顺序图](play-runs/level-23-run-20261113-091615-217138/solution-order.png)及[通关画面](play-runs/level-23-run-20261113-091615-217138/victory.png)。

## 第 24 关

- [初始画面](play-runs/level-24-run-20261113-092520-403122/original.png)可见朝左小象，[阶段搜索](play-runs/level-24-unlock-20261113-092637-941769/plan.json)确认 27 步后小象朝左离场，剩余 70 步完成通关；[合并顺序图](play-runs/level-24-complete-order/solution-order.png)包含全部 98 个确认步骤，已保存[通关画面](play-runs/level-24-complete-order/victory.png)。

## 第 25 关

- [初始画面](play-runs/level-25-run-20261113-094109-109533/original.png)有 11 只分散小鸭，部分紧邻小猪；补充现场视觉模板后连续六帧网格一致。[复核布局](play-runs/level-25-run-20261113-094411-270304/level.json)记录 93 猪、11 鸭和排除的黄色候选。143 步通关并保存[步骤图](play-runs/level-25-run-20261113-094411-270304/solution-order.png)和[成功画面](play-runs/level-25-run-20261113-094411-270304/victory.png)。

## 第 26 关

- 保存[初始画面](play-runs/level-26-run-20261113-100707-984876/original.png)，可见朝下小象；固定障碍整关搜索未及时完成后，转为[69 步阶段计划](play-runs/level-26-unlock-20261113-100759-628861/plan.json)。第 7 步动画帧长度识别失败后，稳定画面确认该步已生效，保留[中断与核对记录](play-runs/level-26-unlock-20261113-100759-628861/reconciliation.json)；重搜的[62 步阶段计划](play-runs/level-26-unlock-20261113-101014-423525/plan.json)已执行。小象点击两秒后未见移动，后续稳定画面确认离场且金币增加，保留[延迟离场证据](play-runs/level-26-unlock-20261113-101014-423525/object-reconciliation.json)，正在搜索剩余 29 猪。
- 剩余猪的自动网格重新拟合会丢失空出的外缘，已按首屏原始 12×19 网格保存[复核布局](play-runs/level-26-original-grid-reviewed.json)并重新搜索，避免将棋盘内移动误判为离场。
- 在当前模型下有限阶段离场 5 猪后，穷举 2,184 状态最多再离场 4 猪；已保留[卡关现场与重开画面](play-runs/level-26-stuck-20261113/pause-retry.png)。重开后将小象按截图推算为可移动矩形，与 84 猪一起找到并独立复算[132 步候选](play-runs/level-26-elephant-candidate.json)，实际执行后通关，小象第 109 步离场；保存完整[步骤图](play-runs/level-26-elephant-run-20261113-103423-729443/solution-order.png)和[通关画面](play-runs/level-26-elephant-run-20261113-103423-729443/victory.png)。

## 第 27 关

- [首屏](play-runs/level-27-run-20261113-105420-342377/original.png)有 13 只分散小鸭；补充实际截图模板后，部分动画帧识别 10 只、完整帧识别 13 只。已保存[完整帧及复核布局](play-runs/level-27-ducks-reviewed/reviewed-layout.json)，包含 91 猪、13 鸭；139 步通关，保存[步骤图](play-runs/level-27-run-20261113-105632-253761/solution-order.png)与[通关画面](play-runs/level-27-run-20261113-105632-253761/victory.png)。

## 第 28 关

- [初始画面](play-runs/level-28-run-20261113-112223-070730/original.png)含多只长猪，首次多帧数量不一致后停止；后续十帧均识别 94 猪，个别帧方向不明。重新[保存候选](play-runs/level-28-run-20261113-112355-608332/level.json)后按 134 步通关，保存[步骤图](play-runs/level-28-run-20261113-112355-608332/solution-order.png)和[通关画面](play-runs/level-28-run-20261113-112355-608332/victory.png)。

## 第 29 关

- [初始画面](play-runs/level-29-run-20261113-114510-235454/original.png)为长猪关卡；黄色候选与猪体重叠或位于棋盘网格外，复核过滤后[重新保存布局](play-runs/level-29-run-20261113-114532-610130/level.json)，识别 79 猪、无鸭并记录五个排除候选；112 步计划执行中。
