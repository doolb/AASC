# MMD-AR 统一灯光预设实现规范（伪代码）

## 2026-10-11 已实现

```text
已有声明：DisplayMmd灯光入口、阴影/高光/AO/屏幕光照/渲染分组设置入口
新增定义：LightingPreset { id, name, settings }
新增定义：LightingSettings { lighting, specular, keyShadowBias, shadowMap, fillFacing, aoConcavity, aoPreview, aoEdgeCorrection, screenLighting, render }
新增定义：分组适配器 { normalize, read, apply }，仅在独立网页生成副本注册
新增定义：PresetFile { format=aasc.mmd-ar.lighting-presets, version=1, presets }
新增定义：PresetLibrary { presets, selectedId, dirty }

构建独立网页 → 移除旧亮度预设及局部事件 → 在灯光面板创建“灯光预设”可折叠分类
  分类正文统一放置选择、名称、保存/覆盖/删除、导入/导出及状态提示
  使用已有分类样式与展开/收起事件；默认展开 → 加载统一模块
初始化 → 保留当前分组设置 → 读取本地预设库 → 刷新列表
读取当前配置 → 按显式字段集合读取全部分组 → 规范化 → 深复制快照
保存新预设 → 校验名称 → 捕获快照 → 分配ID → 成功持久化后更新列表
覆盖所选 → 使用当前名称与快照替换用户预设 → 成功持久化后清除dirty
选择预设 → 规范化全部分组 → 按各组既有入口应用 → 更新控件/读数 → 保存当前配置
  lighting排除physicsFps与rotationPhysicsLimit，保留现有物理值
  render保存TAA/FSR2/Canvas倍率，能力不足沿用原禁用规则
  shadowMap保留预设请求值，实际应用遵守设备上限
手动修改任一灯光选项 → 标记dirty → 保留命名预设快照
删除 → 仅移除库记录 → 场景保持
恢复默认 → 既有分组恢复默认 → 标记当前设置未保存，不覆盖预设

导出所选或全部 → 深复制记录 → 包装PresetFile → JSON编码 → 下载
  美化文本超过256KiB时使用紧凑JSON，保证自身导出的文件可重新导入
导入 → 检查UTF8大小不超过256KiB → 读取文本 → 解析JSON → 验证格式/版本/列表及所有分组
  列表最多100项，名称1至64字；按分组默认值结构检查已知字段类型和有限数字
  缺省字段补默认，未知字段忽略；分组校验只调用纯normalize，不修改场景
  验证失败 → 显示错误 → 库与场景保持
  验证通过 → 规范化兼容缺省字段 → 分配冲突ID → 重名生成新名称
  合并库成功持久化 → 更新列表 → 显示数量，等待用户选择应用
存储失败 → 保留原库并显示错误，不宣称保存成功
```

字段集合对应十个适配器；基础字段通过构建副本公开纯normalizeMmdLighting；高光/屏幕光照/渲染直接注册适配器；阴影/补光过渡/AO由web-lighting-presets-build注入既有闭包。统一分类复用mmd-ar-panel-group样式与展开事件。动作、物理、定位、模型和Human不属于此数据流。

## 构建与自测（伪代码）

```text
构建WEB_MODE → 注册分组表 → 生成旧灯光副本与AO/阴影适配入口
  复制数据模块 → 高光/数据模块计算SHA指纹 → 写入预设UI的指纹导入
  预设UI计算SHA指纹 → 页面引用 → 不修改正式显示端
数据自测 → 六项：库/深复制/刷新、文件/重名、全量校验、失败原子性、HTTP ID、大型库文件回读
浏览器自测 → 分类归属与原ID唯一 → 展开/收起 → 保存/刷新 → 实际JSON下载/文件上传
  十组读数逐字段一致 → 坏文件无副作用 → 原物理与动作/定位保持
  模拟阴影1024上限/不支持屏幕光照与TAA → 实际限制生效，原预设2048仍可导出
  覆盖/删除 → 窄屏无横向溢出 → 页面无异常
兼容自测 → 现有screen-lighting与temporal-aa定向回归
```

验证：29项定向检查全部通过（6项数据、2项分类/真实网页、13项屏幕光照、8项TAA），无失败/跳过；npm run build:web:mmd-ar-test成功。真实Chromium/SwiftShader完成十组逐字段往返、刷新、实际下载/上传、错误文件无副作用、能力降级、覆盖/删除、动作物理定位保持及390px窄屏折叠/无横向溢出；截图已查看。
