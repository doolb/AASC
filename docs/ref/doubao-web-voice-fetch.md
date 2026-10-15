# 豆包官网音色列表获取方式

核对日期：2026-10-15。当前目标是与官网“设置 → 声音选择”中五个分类实际加载的列表一致，保留网页顺序。

## 当前采用的范围

本次官网各分类实际只加载第一页。接口全部分页的候选比页面实际列表多，不能把全部分页后过滤BV的结果当作网页实显列表。

| 分类 | recommend_type | tab_key | page_index | page_size | 过滤后实显数量 | 最后一项 |
|---|---:|---|---:|---:|---:|---|
| 推荐 | 1 | 省略 | 1 | 30 | 30 | 青涩沐阳 |
| 女声 | 10 | female | 1 | 30 | 27 | 桂乡甜妞 |
| 男声 | 10 | male | 1 | 30 | 29 | 暖阳阿晨 |
| 角色 | 10 | characters | 1 | 30 | 26 | 清朗公子 |
| 口音 | 10 | accent | 1 | 30 | 25 | 虎子的声音 |

分类间会重复，按字符串`id`合并后为94项、94个`style_id`。推荐30项按`id`和`style_id`核对均已包含在后四类中，没有推荐独有项；只保存后四类合并集也能覆盖这94项，推荐可保留为分组标签。

上述数量和末项用于核对本次快照，不应硬编码为未来官网的固定结果。官网内容、分类或分页行为变化时，应重新对照实际页面。

## 按男声、女声合并整理（用户追加要求）

在原始94项范围内，把角色和口音的音色按`tags`中的`男/女`归入两个分组，按字符串`id`去重。先保留原女声27项/男声29项的顺序，再按角色、口音的原始顺序追加尚未收录的条目；不追加接口后续分页。推荐30项已被覆盖，不重复添加。

全部94项都有且只有一个原始性别标签，无缺失或冲突，不按名称推测。归并后女声32项（新增5项）、男声62项（新增33项），合计仍94项。此为整理后的分类数量，不是官网原女声/男声标签当前显示数量。

每条保存`gender=female/male`、原有`tags`、原分类`source_categories`和`recommended`标记；角色、口音、推荐信息仍可用作标签。原始五分类快照保留，整理结果为[男女合并列表](doubao-web-gender-voices-20261015.md)及[JSON](doubao-web-gender-voices-20261015.json)。

```text
输入 := 原始五分类实显快照，总94个id
按顺序处理 女声/男声/角色/口音 各分类
    原条目 := 按字符串id查找总voices，保留原categories作为source_categories
    性别 := tags中唯一的男或女；缺失或冲突则停止核查，不猜测
    目标组 := 女 -> female，男 -> male
    同组id已存在则不重复；同id的style_id须一致
    追加条目，保留gender/tags/source_categories/recommended
校验 := 女32、男62，总94且id与style_id唯一；与输入id集合完全相同
顺序校验 := 每组开头保持官网原女声27项/男声29项顺序
输出校验 := JSON往返一致，Markdown总94行，无条目丢失
```

## 方法一：直接读取网页实际列表

1. 使用已登录豆包、开启调试端口的Chrome。本次复用现有`127.0.0.1:9222`实例，没有启动或关闭Chrome。需要自行启动时，可使用用户指定命令`chrome.exe --remote-debugging-port=9222`，并保持调试端口仅供本机使用。
2. 项目`package.json`没有音色目录抓取script；本次使用已安装的`puppeteer-core`临时连接，不新增依赖或生产脚本。连接方式为`puppeteer.connect({browserURL: 'http://127.0.0.1:9222'})`。
3. 在已有标签中定位`https://www.doubao.com/`页面，进入“设置 → 通用 → 声音选择”，记住原分类。依次点击推荐、女声、男声、角色、口音，等待选中分类生效、加载指示消失且卡片出现。
4. 直接读取每个分类当前DOM中的音色卡片，保持DOM顺序，不调用额外分页，也不点击音色卡片、试听或“确定”。本次读取卡片React的`speaker`属性取得`id/name/style_id/tags`，由名称DOM核对首末项。
5. 将每类原序列表保存到`categories[].voices`；另以字符串`id`合并生成总`voices`，记录所属`categories`。相同id出现不同style_id时停止并核查；不能只按名称去重。
6. 完成后恢复原分类，仅断开Puppeteer连接，不关闭用户页面或浏览器。

本次页面定位依据：分类`[class*="tab-zoPgNa"]`、选中分类`[class*="tab-active-"]`、卡片`[class*="speaker-item-"]`、名称`[class*="speaker-name-"]`。读取卡片的`__reactFiber*`并沿`return`向上找到`memoizedProps.speaker`。这些CSS哈希和React内部属性不是稳定公开API；网页升级后若定位失败，应重新核查，不能静默导出空列表。

## 方法二：请求相同范围的目录接口

```http
POST https://www.doubao.com/alice/user_voice/recommend
Content-Type: application/json
Cookie: <当前已登录会话，仅在内存中使用>
Origin: https://www.doubao.com
Referer: https://www.doubao.com/chat
User-Agent: <当前浏览器的User-Agent>
```

女声请求正文：

```json
{"page_index":1,"page_size":30,"recommend_type":10,"tab_key":"female"}
```

其他分类按上表替换`recommend_type/tab_key`，推荐不发送`tab_key`。核对HTTP200、业务`code=0`、`data.ugc_voice_list`为数组后，排除`style_id`以`BV`开头的条目，保持返回顺序。

为了匹配本次官网实际列表，五类都只取`page_index=1`，即使`data.has_more=true`也不继续翻页。女声首批30项过滤3项BV后为27项，最后是桂乡甜妞。相同范围的接口结果仍需与实时网页核对；方法一的实际卡片是本次导出的直接来源。

本次已验证当前会话Cookie的纯Node裸URL请求成功，不带`a_bogus/msToken`等查询参数。只证明当前会话该目录请求可用，不保证无登录、过期登录或所有环境可用。若遇登录失效、安全验证、非成功状态或结构变化，停止抓取并回到官网处理，不自动重试或改用其他账号。

## 字段与保存方式

| 字段 | 用途 |
|---|---|
| id | 目录条目标识，保持字符串，避免大整数精度丢失 |
| name | 中文展示名称 |
| style_id | 合成音色标识，官网传入`tts.speaker`；未发现单独`ttsid`字段 |
| tags | 接口`tag_list[].tag_value`，或网页speaker.tags |
| categories | 所属分类，可有多个 |

官网已选音色另保存在IndexedDB：数据库`samantha-web`、对象仓库`store`、键`default-chat-voice-store`、值`state.currentVoice`，含`id/name/style_id/pitch/speechRate`。读取目录不需要修改该选择。本次文件不保存Cookie、账号资料、签名查询或带签名的头像/预览地址。

## 获取与校验伪代码

```text
记录原分类
逐类切换 推荐/女声/男声/角色/口音
    等待选中分类和卡片载入
    按DOM顺序读取speaker的id/name/style_id/tags
    校验非空、id为字符串、分类内id唯一、无BV前缀
    保存分类原序列表
按id合并五类，保留categories；相同id的style_id必须一致
分别按id和style_id验证 推荐集合 是 后四类并集 的子集
写入JSON与分组Markdown，再重读核对字段、数量和表格行数
恢复原分类并断开调试连接

本次实测 := 分类30/27/29/26/25，分类表格共137行
本次去重 := 94个id、94个style_id
本次女声 := 与单独27项快照逐字段一致，末项桂乡甜妞
边界 := 只读目录，不追加分页，不确认音色，不合成；项目固定音色实现不变
```

## 结果文件与历史范围

- 当前网页五分类实显：[列表](doubao-web-ui-voices-20261015.md)、[JSON](doubao-web-ui-voices-20261015.json)，后续使用优先引用这组文件。
- 单独女声27项：[列表](doubao-web-female-current-20261015.md)、[JSON](doubao-web-female-current-20261015.json)。
- 历史全部分页385项：`doubao-voice-catalog-20261015.*`；全部分页过滤BV后的316项：`doubao-web-visible-voices-20261015.*`。这两组只用于接口候选调研，不代表当前网页实显范围。

本次源码还发现，分页`scroll`监听绑定内部`speaker-list`，但该元素本身不滚动；实际滚动的是外层容器。这解释了当前页面停在首批列表。该行为属于官网当前实现，未修改；未来若官网恢复后续加载，应重新确认用户需要“首批列表”还是“页面可继续滚动加载的列表”。
