# Agent 图像输出规范

> 当你在聊天回复里需要引用一张图片时（截图、生成的图表、CLI 输出可视化等），**必须**按下面的标准格式输出绝对路径。本项目的前端 (`transformLocalImagePaths`) 会识别这些格式并直接在聊天气泡里渲染，**用户无需手动打开**。

## 标准格式（必用）

```markdown
![一句话描述](/绝对/路径/到/image.png)
```

- **描述（alt 文字）必填**，1 行内、≤ 15 字最佳。例如：`架构图` / `运行截图` / `Mermaid 流程图` / `diff 视图` / `生成结果`
- **路径必须是绝对路径**：Unix 形式 `/Users/me/...` 或 Windows 形式 `C:\Users\me\...`
- 支持的图片后缀：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.bmp` `.ico` `.avif`
- 前端会**自动**转成 `asset://localhost/...` 并通过 Tauri webview 直接渲染，**不要**自己加 `file://` 或 `asset://` 前缀

## 推荐写法 vs 兜底写法

| 写法 | 渲染效果 | 推荐度 |
|---|---|---|
| `![描述](/abs/x.png)` | ✓ 气泡里显示图 + alt 文字 | **必用** |
| `<img src="/abs/x.png" />` | ✓ 气泡里显示图，无 alt | 可用（实在想不出描述时） |
| 裸路径 `/abs/x.png` | △ 会被前端兜底识别为图，**但没 alt** | 仅作最后兜底 |

## 反例（不要这样写）

- ❌ `图片：/Users/me/x.png`（裸路径，无 alt，依赖前端兜底且有误伤风险）
- ❌ `![](file:///Users/me/x.png)`（多余 `file://` 前缀，前端会剥但增加噪音）
- ❌ `![](asset://localhost/Users/me/x.png)`（不要前端协议，由前端转换）
- ❌ `![](/abs/x.png 800x600)`（不要在 URL 段加尺寸 / 标题）
- ❌ `./x.png` 或 `x.png`（相对路径，不在工作目录时找不到）
- ❌ `[点击查看](/abs/x.png)`（**不要**用链接语法，链接不会被识别为图，要用图片语法）

## 多张图

按出现顺序排列，**每张都要有 alt**：

```markdown
实现方案：
![架构图](/Users/me/diagram.png)
![类图](/Users/me/class.png)
```

## 说明 + 图片

```markdown
下面这张是 dev agent 跑完的截图：
![screenshot](/Users/me/shot.png)
```

## 在终端里画图后输出

如果用了 `codex --image`、Mermaid CLI、ASCII-to-image 之类的工具，**最后一步把生成的绝对路径按标准格式写出来**，不要只说"已生成 image.png"了事。

## 一行 TL;DR

**每张图 = `![一句话描述](/abs/path/to/image.png)`，别用其他写法。**
