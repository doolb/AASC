# MMD-AR 统一灯光预设设计

## 需求与范围（2026-10-11，已确认并实现）

用户要求删除此前的亮度预设，改成统一灯光预设，保存所有灯光选项并支持文件导入导出。当前独立页复用display-mmd-lighting.js的default/soft/bright局部预设，其他灯光和渲染选项分散在多个面板及本地存储，不能完整恢复配置。

按用户确认在独立mmd-ar测试网页实现，通过构建副本适配替换旧预设入口和监听；正式显示端及独立APK暂不扩展。旧当前设置保留，移除旧默认/柔和/明亮亮度预设选项及局部应用逻辑，原恢复默认按钮继续工作。

## 操作与保存范围

- 新增统一“灯光预设”可折叠分类（用户2026-10-11补充确认）：预设选择、名称、保存新预设、覆盖所选、删除、导入文件、导出所选和导出全部。
- 预设库保存在当前浏览器，刷新恢复列表。选择一次应用所有保存项并刷新控件/读数；手动修改后标记已修改，不自动覆盖命名预设。初次使用保留现有配置，显示当前设置未保存。
- 按整个灯光面板保存：基础/Toon/环境光、主光、补光、两路边缘光、高光、阴影bias/normalBias及尺寸/范围/拟合/预览、补光明暗过渡、AO全部选项及法线预览、接触阴影、SSGI、TAA/FSR2和Canvas倍率。
- 折叠状态及分辨率读数等临时界面状态不入预设；动作、物理、Human、模型、定位和相机参数独立。

## 文件与兼容

单个与批量使用同一JSON格式，含格式标识、版本和预设列表，每项含ID、名称与完整分组设置。导入先整体验证/规范化，再合并；重名自动生成新名称、冲突ID重新分配，保留原记录。导入后手动选择应用，不自动改变场景。坏JSON、错误格式/版本、过大文件或不合法结构不改变库和当前场景。

捕获规范化后的实际配置，按显式字段集合通过各组既有入口应用，不导出localStorage整库。兼容缺省字段使用对应默认，未知字段忽略。跨设备能力不足时复用现有限制，保留预设原值，应用时遵守WebGL2支持与阴影尺寸上限。旧当前设置继续由原入口读取，新预设库使用独立存储键；存储失败显示错误，不宣称成功。删除预设不重置场景，导出只下载文件。

## 文件与验证

修改`3rd/mmd-ar-test/build.js`接入构建与内容指纹；新增`web-lighting-preset-library.mjs`（纯数据校验/库）、`web-lighting-presets.mjs`（界面/文件）、`web-lighting-presets-build.js`（生成页分类与闭包适配）。`web-specular.mjs`、`web-screen-lighting-panel.mjs`和`web-render-settings.mjs`注册读取/应用入口；阴影、补光过渡及AO适配只注入独立网页的既有脚本。所有操作位于同一“灯光预设”折叠分类，默认展开。

共十组：lighting、specular、keyShadowBias、shadowMap、fillFacing、aoConcavity、aoPreview、aoEdgeCorrection、screenLighting、render。AO法线预览增加当前设置持久化；边界修正仍沿用原存储。预设最多100条，文件/库上限256KiB，名称1至64字符；导出超限的美化文本自动改紧凑格式，保证文件可回读。局域网HTTP缺少randomUUID时回退随机ID。

新增纯数据与真实网页自测，分类归属/折叠、全部分组逐字段往返、刷新恢复、覆盖/删除、重名合并、坏文件无副作用、能力降级及动作/物理/定位保持均有检查。构建使用`npm run build:web:mmd-ar-test`。验证记录见task和`docs/self-test.md`；本地web-dist已生成，外网尚未发布，手机性能/观感待设备验收。操作不新增逐帧循环。正式显示端、APK及Offline产物状态不属于本轮。

29项定向检查全部通过（6项数据、2项分类/真实网页、13项屏幕光照、8项TAA），无失败/跳过；npm run build:web:mmd-ar-test成功。真实Chromium/SwiftShader完成十组逐字段往返、刷新、实际下载/上传、错误文件无副作用、能力降级、覆盖/删除、动作物理定位保持及390px窄屏折叠/无横向溢出；截图已查看。

## 默认灯光采用用户“日光”文件（2026-10-11，已实现并验证）

用户要求把灯光默认设置改为`/mnt/mmd-ar-lighting-preset.json`。已只读检查该文件：3027字节，format=aasc.mmd-ar.lighting-presets/version=1，仅“日光”一项，十组完整。SHA-256：2dba75ef82a7e46f4e6a23877075cfa5f11a937ec8e8ab56003f7bebc264da58。

沿用本轮独立WEB范围，已将文件内容复制到仓库`3rd/mmd-ar-test/web-lighting-default-preset.json`作为可版本化的默认配置，构建时校验格式/版本/唯一项/十组结构并嵌入默认数据模块，网页不依赖机器上的/mnt绝对路径。初次访问或某分组没有有效保存设置时采用相应“日光”默认；已保存设置与命名预设优先保留，不在每次启动覆盖用户调节。“恢复默认”一次应用完整十组日光设置并同步表单/持久化，保留命名库；既有复位物理行为沿用原按钮逻辑，不把物理参数加入灯光默认文件。

代表值：环境光1、主光2.85（经度-68/纬度46）、红色补光5、两路边缘光开启、高光#83c3bc/0.14/10、阴影2048并开启预览、AO全分辨率/32采样、SSGI开启，抗锯齿关闭（保留FSR2模式与配置）。全部字段以文件内容为准，仍遵守设备支持与阴影尺寸上限。

已修改web-lighting-presets-build.js与web-lighting-presets.mjs，新增web-lighting-default-preset.json与web-lighting-defaults.mjs；扩展tests/mmd-ar-lighting-presets.test.js和tests/mmd-ar-lighting-presets-browser.test.js。已同步spec/task/todo/changelog/usage/self-test。验收首次无存储、已有保存值优先、十组恢复默认后逐字段相等/刷新保留、预设库保持以及跨设备降档；用npm run build:web:mmd-ar-test构建。用户回复“是”后先更新spec，再实施；全部自测与构建通过，尚未发布。

33项定向检查全部通过（10项数据、2项分类/真实网页、13项屏幕光照、8项TAA），无失败/跳过；真实Chromium/SwiftShader验证全新上下文十组日光逐字段相等、保存值优先、坏JSON/null组回日光、完整复位/命名库保持/刷新一致，以及原文件往返与设备降档。npm run build:web:mmd-ar-test成功；5项生成模块导入SHA指纹、默认源与原文件SHA一致、模块语法及git diff --check通过。 本地web-dist已生成，未发布外网；正式/APK及Offline状态保持。

## 加入文件中的傍晚预设（2026-10-11，已实现并验证）

用户要求把mmd-ar-lighting-presets.json中的“傍晚”也加入。已读取/mnt/mmd-ar-lighting-presets.json：5976字节，format=aasc.mmd-ar.lighting-presets/version=1，包含日光与傍晚；傍晚ID为light-53b485ece99511aa361e06f00130b6b2，十组齐全。文件SHA-256：75d0e29fb617e424a87f4f96acd5a7207f0f927d8dc488deef529e83e4c6d6e1.

实现：把唯一“傍晚”记录保存到仓库web-lighting-builtin-presets.json，经独立WEB构建嵌入预设模块；初始化现有库后一次性补入，已有浏览器也可看到，选择后完整应用十组。内置来源只负责首次补入，加入后沿用已有保存/覆盖/删除/导入导出功能。持久化安装标记防止刷新重复添加或用户删除后自动复活；已存在相同来源ID时保留当前记录，同名不同ID按既有合并规则生成名称，不覆盖用户记录。新增列表记录不自动切换场景，日光默认与恢复默认入口继续沿用当前配置。

该文件的日光环境光/主光均为1.25，当前默认是1/2.85；本次明确只提取傍晚，不顺带更新日光默认。傍晚环境光1，主光#fec086/1.6、经度58/纬度46，第一边缘光0.2；其余所有字段按傍晚记录保留并沿用设备能力限制。

受影响文件：新增3rd/mmd-ar-test/web-lighting-builtin-presets.json；修改web-lighting-presets-build.js、web-lighting-presets.mjs与web-lighting-preset-library.mjs，构建复用现有默认源结构校验辅助模块；扩展现有数据及真实网页自测。同步spec/task/todo/changelog，实施后更新usage/self-test。验证首次/已有库补入、选择后十组一致、刷新不重复、已有修改/删除保持、同名/ID兼容及JSON导出包含傍晚；用npm run build:web:mmd-ar-test构建。用户回复“是”后先更新spec再修改代码/预设数据；37项定向自测全部通过（14项数据、2项分类/真实网页、13项屏幕光照、8项TAA），无失败/跳过；Chromium/SwiftShader验证首次补入、选择傍晚十组逐字段一致、覆盖后刷新保持、删除后刷新不复活、日光复位/刷新与原文件往返、导出全部包含完整傍晚且不含安装标记。npm run build:web:mmd-ar-test成功；6项生成导入指纹、傍晚与原记录深比较、日光默认SHA保持、模块语法及git diff --check通过。 本地web-dist已生成，未发布。
