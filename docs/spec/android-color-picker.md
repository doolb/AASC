# Android 颜色选择器实现文档

## 双端颜色入口（2026-10-19）

```text
已有声明 := display.html 的背景光晕与 MMD 灯光颜色输入；upload.html 的背景光晕颜色输入
目标 := PC 保留原生 type=color；Android 以网页面板提供接近 PC 的选色流程

页面初始化:
    若 userAgent 不包含 Android，直接返回，不改变原始控件
    收集页面中所有 input[type=color]
    对每个原始控件保留 id、value 和事件监听器，将 type 改为 hidden
    在原位置插入带当前色块的按钮，并建立原始控件与按钮的映射
    只创建一份共享的选色弹层

打开选色器(input):
    读取 input 当前合法的 #RRGGBB，作为 originalColor 和 workingColor
    将 workingColor 换算为 HSV，更新色域、色相条、HEX 输入和预览色块
    显示弹层；焦点移入面板

选择色域或移动色相:
    将用户手势限制在色域/滑块边界内
    计算 HSV，再换算为规范化 #RRGGBB
    更新 input.value，并派发 bubbles=true 的 input 事件
    更新按钮色块、HEX 和预览

输入 HEX:
    接受 6 位十六进制，可省略 #，规范化为大写 #RRGGBB
    合法时按预览流程派发 input；非法时提示并禁止确认

确认:
    若 workingColor != originalColor，派发 bubbles=true 的 change 事件
    关闭弹层并恢复触发按钮焦点

取消、遮罩点击或 Escape:
    若预览已改变原值，恢复 originalColor 并派发 input 事件
    不派发 change；关闭弹层并恢复触发按钮焦点

外部配置回显:
    原有业务继续直接写原始 input.value
    包装原始 input.value 属性的原型 getter/setter；赋值后立即同步按钮色块
    每次打开时仍重新读取当前值，避免弹层使用过期值

验证 := PC 不转换控件；Android 显示页全部 8 个和控制页 1 个入口可打开；
        拖动预览、HEX、确认、取消、键盘和窄屏位置正常；原有配置事件契约不变
```
