# 工程目录结构实现文档（伪代码）

## 1. 目录职责定义伪代码

```text
ROOT_RULES = {
  "3rd": "third_party_and_sub_displays",
  "config": "json_configs",
  "docs": "design_spec_task",
  "skills": "skill_configs",
  "res": "runtime_resources",
  "src": "layered_source_code_with_aasc_autobrain_scripts_ui"
}
```

## 2. 结构同步流程伪代码

```text
function SyncProjectStructureDocs():
    currentLayout = ScanRootDirectories(projectRoot)
    canonicalLayout = BuildCanonicalLayout(ROOT_RULES)

    if currentLayout changed:
        UpdateReadmeProjectTree(canonicalLayout)
        EnsureDesignIndexContains("project-structure")
        EnsureSpecIndexContains("project-structure")
        AppendChangelog("工程目录结构整理")
```

## 3. 文件归位校验伪代码

```text
function ValidateNewFilePlacement(filePath):
    if filePath is runtimeResource:
        assert filePath under res/

    if filePath is businessCode:
        assert filePath under src/

    if filePath is doc:
        assert filePath under docs/
```

## 4. 变更发布清单伪代码

```text
ReleaseChecklist = [
  "readme.md 项目结构块已更新",
  "package.json start/main 指向 src/apps/server/boot/server-app.js",
  "静态资源目录指向 src/apps/web-mediacenter/ui/public",
  "voice-display-node 配置路径指向 3rd/voice-display-node/config.json",
  "docs/design.md 索引已更新",
  "docs/spec.md 索引已更新",
  "docs/todo.md 检查日期已更新",
  "changelog.md 已记录目录整理"
]
```
