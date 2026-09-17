# pdf Editor（在线 PDF 工具）

基于 **Vue 3 + Vite + Pinia + TypeScript + Element Plus** 构建。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3.5（Composition API + `<script setup>`） |
| 构建 | Vite 5、TypeScript 5.6、vue-tsc |
| 状态 | Pinia 3 + pinia-plugin-persistedstate（本地持久化） |

## 目录结构

```
├── src
│   ├── api/            # 接口层
│   ├── assets/         # 图片、svg 图标（vite-plugin-svg-icons 雪碧图）、全局 scss
│   ├── components/     # 通用组件
│   ├── hooks/          # 组合式函数（核心模块，见下文）
│   ├── language/       # i18n 实例与语言包（locales/*.json 动态加载）
│   ├── layout/         # Layout（侧边栏 + RouterView + SEO head）
│   ├── router/         # 路由与守卫（多语言 basePath）
│   ├── store/          # Pinia
│   ├── types/          # 业务类型
│   ├── utils/
│   │   ├── pdfWorker/  # ★ Worker 渲染线程池（核心模块，见下文）
```

## 核心模块详解：`src/utils/pdfWorker`（Worker 渲染线程池）

PDF 单页栅格化耗时 1~10 秒，若在主线程执行会卡死页面。本项目把全部栅格化搬进 **Worker 线程池**，主线程只负责编排与绘制，实现不卡帧的预览/缩略图。

### 架构总览

```
                        ┌────────────────────────────────────────────┐
                        │             主线程                          │
 Preview / View ──► PdfViewController（单文档控制器）                    │
                        │    ├─ PDFManage：解析/尺寸/大纲/打印/回退渲染  │
                        │    ├─ BitmapCache：字节预算 LRU 位图缓存      │
                        │    └─ PdfRenderEngine：Worker 池编排          │
                        └──────────────────┬─────────────────────────┘
                                           │ postMessage（结构化克隆 + ArrayBuffer transfer）
                        ┌──────────────────▼─────────────────────────┐
                        │   Worker × N（OffscreenCanvas 栅格化）        │
                        │   pdfRenderWorker.ts：open/render/measure/    │
                        │   cancel/closeDoc 消息循环，产出 ImageBitmap   │
                        └─────────────────────────────────────────────┘
```

### [PdfRenderEngine.ts](src/utils/pdfWorker/PdfRenderEngine.ts) — 双模 Worker 池

- **`broadcast` 模式**（/view 单文档）：同一份数据源铺满全池（2~6 个 worker），每次渲染取「在途任务最少」的 worker，左右两侧不同分辨率互不排队。
- **`sticky` 模式**（多文档缩略图）：每个 `docId` 粘性绑定到固定 worker，避免同一文档在多个 worker 上重复解析；池大小 [3, 6]，保证 11+ 文件均匀分摊。
- **内存控制**：本地 ArrayBuffer 数据源按上限复制（broadcast ≤3 份、sticky 每文档 1 份），发送时 `postMessage` + transfer 零拷贝移交给 worker。
- **可取消渲染**：`cancel(reqId)` 立即结算 promise 并通知 worker 中止在途 RenderTask，滚动离场时能真正停掉耗时的栅格化。
- **崩溃自愈**：worker `onerror` 后标记 `ready=false` 不再被选中，其余 worker 继续服务。
- **能力探测**：`engineAvailable` 运行时检测模块 Worker + OffscreenCanvas + transferToImageBitmap，不支持的环境直接降级主线程渲染。

### [pdfWorkerTypes.ts](src/utils/pdfWorker/pdfWorkerTypes.ts) — 通信协议

主线程 → Worker：`open` / `closeDoc` / `render` / `measure` / `cancel` / `close`；
Worker → 主线程：`opened` / `openError` / `rendered`（携带 ImageBitmap + scale=1 逻辑尺寸）/ `cancelled` / `renderError` / `measured` / `measureError`。

### [PdfViewController.ts](src/utils/pdfWorker/PdfViewController.ts) — 单文档视图控制器

- **单次解析**：主线程 PDFManage 解析与 worker 池预热并行执行（`Promise.all`），首屏最快。
- **主线程透明回退**：worker 打开失败时自动回退 `PDFManage.renderPage`，调用方无感知。
- **在途去重**：同一 `page@scale` 的并发请求合并为一个 promise，避免重复渲染。
- **离场清理**：`destroy()` 取消全部在途渲染、清空缓存、销毁 PDF 解析对象与 worker 池。

### [BitmapCache.ts](src/utils/pdfWorker/BitmapCache.ts) — 字节预算 LRU

- 按「宽 × 高 × 4（RGBA）」估算每张 ImageBitmap 占用字节，默认预算 256MB。
- 命中即刷新到队尾（Map 插入序即 LRU 序）；超预算立即淘汰最久未用项并 `bitmap.close()` 释放显存。
- 至少保留 1 张，避免刚渲染好的位图立刻被自己挤掉。

> ⚠️ 注意：`pdfRenderWorker.ts` 为真实实现（fake-worker 模式：注入 `self.pdfjsWorker = { WorkerMessageHandler }`，解析+解码+栅格化全部在本 worker 线程内完成，不创建嵌套子 worker）；`WorkerMessageHandler` 来自 npm 依赖 `pdfjs-dist@4.10.38` 的 `build/pdf.worker.mjs`，主线程侧 `pdfRender.ts` 则通过 `GlobalWorkerOptions.workerSrc` 指向 `build/pdf.worker.min.mjs`。

## 核心模块详解：`src/hooks`

### [usePdfThumbnails.ts](src/hooks/usePdfThumbnails.ts) — PDF 缩略图管线

单/多文件缩略图的完整生命周期管理，融合了 5 项关键设计：

1. **可见区驱动 + 空闲调度**：只渲染虚拟滚动可见区的页面，通过 `scheduleIdleTask` 在浏览器空闲时发起，避免与交互抢 CPU。
2. **Worker 池 + 主线程二次编码**：worker 一次往返产出 ImageBitmap，主线程 `drawImage → convertToBlob`（< 30ms）转 JPEG Blob → objectURL 写入响应式 `thumbs`，模板直接 `<img :src="thumbs[key]">`。
3. **Token 失效机制**：每次渲染携带单调递增 token，离场即「取消空闲任务 + cancel worker RenderTask」，旧 promise 完成时凭 token 早退丢弃结果。
4. **LRU 缓存**：默认 300 条上限，淘汰时跳过当前可见 key，杜绝快速滚动破图；淘汰即 `revokeObjectURL`。
5. **模块级共享引擎**：多个 Hook 实例共享同一个 sticky 引擎（引用计数），首实例懒启动、末实例销毁。

另提供 `measure()`（不栅格化取 scale=1 逻辑尺寸，用于空白页插入兜底）、`releaseDoc()`（单文档级资源回收）与主线程 fallback 路径。

### [useVirtualGrid.ts](src/hooks/useVirtualGrid.ts) — 行级虚拟网格

基于 @tanstack/vue-virtual 的按行虚拟化封装：

- 每行一个虚拟 item，返回 `visibleRows`（行内 item 索引数组 + 行号），CSS flex 负责行内布局；
- **等高模式**（传数字）：grid / 定高 list，行为与旧实现完全一致；
- **变高模式**（传函数）：list 逐页精确高度 + `paddingStart` 顶部留白，配合 `VirtualRow.start` 绝对定位，像素精确零测量回流。

### [useGridLayout.ts](src/hooks/useGridLayout.ts) — 响应式列数

ResizeObserver 监听容器宽度，实时计算 `columns = floor((width + gapX) / (itemWidth + gapX))`（满足 `N*itemWidth + (N-1)*gapX ≤ width` 的最大 N）。支持 itemWidth/gapX 响应式动态切换（如 SplitPDF 在 234px ↔ 450px 卡片间切换），并保证与虚拟网格使用完全相同的 clientWidth 口径。

### [useKeyboard.ts](src/hooks/useKeyboard.ts) — 键盘状态与快捷键

两个正交能力共用一组监听器：

- **状态跟踪**：`pressedKeys` / `isPressed(key)` / `isShift` 等，用于「修饰键 + 鼠标」组合（如 Shift+click 范围选中）；
- **快捷键注册**：`shortcut('ctrl+s', handler)` / `shortcuts([...])`，返回取消注册函数；
- **跨平台**：`ctrl`/`mod` 别名自动适配（Win/Linux → Ctrl，macOS → Cmd），`formatShortcut()` 输出平台化展示文本；忽略 IME 拼音输入中的按键。