# MMD-AR Blender 工程工作区实现伪代码

```text
首屏构建：
    显示现有 MMD-AR 与 PMX 编辑器
    Blender 入口只引用轻量 web-blender-loader.mjs
    不 import BlenderRuntime / presenter / Three 版本扩展
    不请求 WASM、.data、Essentials 或工作区构建块

点击“Blender 工程”：
    若 File System Access API 可用：
        在当前 click 调用栈立即执行 showDirectoryPicker(mode=readwrite)
    不支持目录读写、HTTPS/localhost 或 Service Worker：
        显示兼容性提示并结束
    用户取消目录选择 -> 不启动引擎，不下载工作区模块或 WASM
    选择目录 -> 用目录句柄枚举相对路径，筛选 .blend
    选择目录后 dynamic import 已指纹化工作区模块；更新同源 Service Worker 并等待最新 active worker 控制当前页面
    无 .blend -> 显示空工程选择/创建状态，不自动转换 PMX

用户选择 .blend 并按“打开”：
    IndexedDB 保存目录句柄与权限状态
    选择相对工程路径和 .blend 相对路径
    new BlenderRuntime({
        stage: 分片 => presenter.view.stageFrame(分片)
        present: async (帧, 描述, 截图) => {
            答案 = await presenter.present(帧, 描述, 截图)
            externalCharacter.refresh()
            return 答案
        }
    })
    runtime.start(固定绝对虚拟根目录, .blend相对路径)
    Worker 的 /__editor/blender-wasm/* -> Service Worker -> 同源静态 WASM 资源
    Worker 的工程索引/文件读取 -> Service Worker -> 目录句柄
    引擎分阶段复制项目资源到 WASM FS，更新启动进度
    status.available=false、缺失资源、非 crossOriginIsolated -> 显示明确错误并回收 worker
    收到 Blender 首帧 -> presenter.view.root 交给 DisplayMmd 编辑桥接
    保存当前 MMD 角色 pivot 的可见性和相机
    隐藏当前 MMD 角色 -> 将 Blender root 挂入当前 DisplayMmd scene
    沿用当前 DisplayMmd renderer、camera、灯光和渲染循环
    用 Blender root 的包围盒重新取景；记录原相机以便关闭后恢复
    刷新对象层级与 Armature/骨骼层级
    页面“编辑/预览/渲染”模式路由到 Blender 工作区

Blender 编辑：
    对象选择 -> 显示 location / rotation_euler / scale
    属性提交 -> runtime.execute(安全转义的对象名与数值)
    Armature 选择 -> 枚举 pose bones 与 data bones 的父子层级
    骨骼姿态 -> 编辑 pose.bones 的 location / rotation / scale
    骨架结构 -> 在 Edit Mode 修改 edit_bones.head / tail / roll / parent
    每次修改 -> 恢复原对象模式 -> runtime.present() -> 主视口更新

预览与渲染：
    预览模式隐藏编辑控件，继续在 DisplayMmd 主视口显示 Blender root
    请求 Cycles 渲染 -> nativePreview(width,height,samples)
        -> runtime.readFile(result.path) -> PNG 下载/显示
    用户点保存/退出 -> runtime.stop() 排空操作并 flush-document
        -> Worker 的分块保存接口 -> Service Worker 校验 SHA-256 并写回目录句柄
    写权限丢失或保存失败 -> 保留运行实例，提示重新授权/重试
    保存成功退出 -> 从 DisplayMmd scene 移除 Blender root，恢复当前 MMD 角色和相机
        -> terminate worker，dispose presenter 与编辑器资源
    PMX 刚体/关节编辑仅在 Blender 工作区未激活时显示

构建：
    仅 WEB_MODE 将 Blender 工作区入口及 Service Worker 写入 web-dist
    将工作区代码拆成独立 ESM chunk，入口通过 dynamic import 加载
    保留 mountBlenderWorkbench 公开入口签名；构建后检查导出缺失即报错
    Vite 资源基路径设为相对路径，worker 与其依赖从当前部署子目录加载
    将固定版本引擎的 /__editor/* 请求按 worker URL 的目录段计算为应用内路径
    不将动态 URL 模板直接交给 Vite new URL 静态资源转换
    Service Worker API 路由以 registration.scope 为根，不能落到域名根路径
    构建后检查生成模块不含站点根 /assets/worker URL
    WASM/data/Essentials 放在单独 assets/blender-engine/目录
    Brotli文件以服务器 Content-Encoding: br 提供，避免解压体积进入普通页面
    同源状态清单返回固定版本、大小、digest、编码和必需文件
    网页部署设置 COOP=same-origin、COEP=credentialless
    APK 构建不带 Blender WASM、工作区 UI 或目录 Service Worker
```

## 持久化与安全规则

```text
工程路径 := 相对已授权目录的 POSIX 路径
拒绝空路径、绝对路径、反斜线、. 与 .. 片段
目录索引 := {root: 虚拟根目录, files: [{path,size,mtime}]}
读取文件 := 仅遍历用户明确选择的目录句柄
保存文件 := 仅写回该目录内已验证的相对路径
分块暂存 := IndexedDB 保存内容哈希与字节，提交时校验长度/哈希后写文件
目录权限拒绝 := 不覆盖、不自动切换到服务器上传；保留 Blender 会话，用户手势重新授权后重试
Service Worker := 只响应工作区所需同源路由，其余请求透传
```
