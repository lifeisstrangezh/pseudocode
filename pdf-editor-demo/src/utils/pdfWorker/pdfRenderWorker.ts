/**
 * PDF 栅格化 worker（多文档版）。
 *
 * 设计要点（已对 pdfjs-dist@4.10.38 legacy 构建的 pdf.worker.mjs 核对）：
 * - 注入 self.pdfjsWorker = { WorkerMessageHandler } → pdfjs 以 fake-worker 模式运行，
 *   解析 + 解码 + 栅格化全部在本 worker 线程内完成，不再创建嵌套子 worker，一个 worker = 一条 OS 线程。
 *   （pdf.worker.mjs 加载时其 WorkerMessageHandler 静态块会自动 initializeFromPort(self)：
 *    1）该 MessageHandler 以 addEventListener 监听消息，且对无 targetName 的请求直接 return，
 *       与本 worker 的消息循环互不干扰；
 *    2）其发出的 "ready" 消息主线程侧按 msg.type switch 分发会忽略；
 *    fake-worker 主库侧走的是 `WorkerMessageHandler.setup()`，不依赖 self.onmessage。）
 * - 注入 OffscreenCanvasFactory / NoopFilterFactory，避免 worker 内无 document 时崩溃。
 * - page.render() 输出到 OffscreenCanvas，transferToImageBitmap() 后零拷贝 transfer 回主线程。
 * - 以 reqId 跟踪 RenderTask，支持中途 cancel()（worker 内 rAF 被 `typeof window` 守卫自动禁用，cancel 安全）。
 * - 多文档：Map<docId, PDFDocumentProxy> + LRU cap=12（容纳 OrganizePDF 11+ 文件粘性路由的 docId 分布）。
 */
// 与主线程（pdfRender.ts）统一使用 legacy 构建：内联 polyfill，兼容旧版 Safari
import * as PDFJS from 'pdfjs-dist/legacy/build/pdf.mjs'
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import {
  CSS_PT_RATIO,
  type WorkerRequest,
  type WorkerResponse,
  type PdfWorkerSource
} from './pdfWorkerTypes'

// 让 pdfjs 在本 worker 内以 fake-worker 模式运行（依赖此全局，不创建嵌套 worker）
;(self as any).pdfjsWorker = { WorkerMessageHandler }

// 与 pdfRender.ts 完全一致的 CMap / 标准字体地址，保证中文等特殊字符正常显示
const CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/'
const STANDARD_FONT_DATA_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/'

/** worker 内同时持有的文档上限（按 LRU 淘汰，超出会销毁最久未用的 PDFDocumentProxy） */
const DOC_LRU_CAP = 12

/** 基于 OffscreenCanvas 的画布工厂，替代依赖 document 的 DOMCanvasFactory（含 group/软掩码等中间画布） */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    return { canvas, context }
  }
  reset(canvasAndContext: any, width: number, height: number) {
    canvasAndContext.canvas.width = Math.max(1, width)
    canvasAndContext.canvas.height = Math.max(1, height)
  }
  destroy(canvasAndContext: any) {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0
      canvasAndContext.canvas.height = 0
    }
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

/** 无 DOM 的滤镜工厂：worker 内无 document，软掩码等滤镜一律返回 'none'（等价于 pdfjs 的 BaseFilterFactory） */
class NoopFilterFactory {
  addFilter() {
    return 'none'
  }
  addHCMFilter() {
    return 'none'
  }
  addAlphaFilter() {
    return 'none'
  }
  addLuminosityFilter() {
    return 'none'
  }
  addHighlightHCMFilter() {
    return 'none'
  }
  destroy() {}
}

interface DocEntry {
  /** PDFDocumentProxy 实例 */
  pdf: any
  /** open 进行中或已完成；await 后可拿到最终 pdf 实例 */
  ready: Promise<any>
}

/** docId → 文档条目（Map 迭代序即 LRU 序） */
const docs = new Map<string, DocEntry>()
/** reqId → 进行中的 RenderTask，用于中途取消 */
const renderTasks = new Map<number, any>()

const post = (msg: WorkerResponse, transfer?: Transferable[]) => {
  ;(self as any).postMessage(msg, transfer || [])
}

const isCancel = (e: any) =>
  e?.name === 'RenderingCancelledException' || e instanceof PDFJS.RenderingCancelledException

/** 把 docId 移到 LRU 队尾（最近使用） */
const touch = (docId: string) => {
  const entry = docs.get(docId)
  if (!entry) return
  docs.delete(docId)
  docs.set(docId, entry)
}

/** 销毁单份文档（取消其在途任务、释放 PDFDocumentProxy） */
const destroyDoc = async (docId: string) => {
  const entry = docs.get(docId)
  if (!entry) return
  docs.delete(docId)
  try {
    const pdf = await entry.ready.catch(() => null)
    if (pdf) await pdf.destroy()
  } catch {
    /* ignore */
  }
}

/** 超出 LRU 上限时淘汰最久未用的文档（除当前正被使用的之外） */
const evictDocs = () => {
  while (docs.size > DOC_LRU_CAP) {
    const oldest = docs.keys().next().value as string | undefined
    if (!oldest) break
    destroyDoc(oldest)
  }
}

async function open(docId: string, source: PdfWorkerSource) {
  // 幂等：同 docId 已开则直接报告 opened（仍移到队尾）
  const existing = docs.get(docId)
  if (existing) {
    touch(docId)
    try {
      const pdf = await existing.ready
      post({ type: 'opened', docId, numPages: pdf.numPages })
    } catch (e: any) {
      post({ type: 'openError', docId, message: String(e?.message || e) })
    }
    return
  }

  const ready = (async () => {
    const loadingTask = PDFJS.getDocument({
      url: source.url ? new URL(source.url) : undefined,
      data: source.data,
      password: source.password,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      rangeChunkSize: 65536,
      disableAutoFetch: true,
      disableStream: false,
      // —— worker 内必须项：杜绝任何 document / FontFace / 系统字体探测 ——
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoopFilterFactory,
      isOffscreenCanvasSupported: true,
      isImageDecoderSupported: true,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: true
    })
    return loadingTask.promise
  })()

  // 先占位再 await，防并发重复 open
  docs.set(docId, { pdf: null, ready })
  evictDocs()

  try {
    const pdf = await ready
    const entry = docs.get(docId)
    if (entry) entry.pdf = pdf
    post({ type: 'opened', docId, numPages: pdf.numPages })
  } catch (e: any) {
    docs.delete(docId)
    post({ type: 'openError', docId, message: String(e?.message || e) })
  }
}

async function render(reqId: number, docId: string, pageNum: number, scale: number) {
  const entry = docs.get(docId)
  if (!entry) {
    post({ type: 'renderError', reqId, message: `PDF 未就绪: ${docId}` })
    return
  }
  touch(docId)
  try {
    const pdf = await entry.ready
    const page = await pdf.getPage(pageNum)
    // 同次拿 base + render viewport，免主线程二次 measure 往返
    const baseVp = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: scale / CSS_PT_RATIO })
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height))
    )
    const context = canvas.getContext('2d')
    if (!context) {
      post({ type: 'renderError', reqId, message: '无法获取 OffscreenCanvas 2D 上下文' })
      return
    }
    const task = page.render({ canvasContext: context as any, viewport })
    renderTasks.set(reqId, task)
    await task.promise
    renderTasks.delete(reqId)
    // transferToImageBitmap 会清空画布，必须在此之后不再使用 canvas
    const bitmap = canvas.transferToImageBitmap()
    post(
      {
        type: 'rendered',
        reqId,
        bitmap,
        width: Math.floor(baseVp.width),
        height: Math.floor(baseVp.height)
      },
      [bitmap]
    )
  } catch (e: any) {
    renderTasks.delete(reqId)
    if (isCancel(e)) {
      post({ type: 'cancelled', reqId })
    } else {
      post({ type: 'renderError', reqId, message: String(e?.message || e) })
    }
  }
}

async function measure(reqId: number, docId: string, pageNum: number) {
  const entry = docs.get(docId)
  if (!entry) {
    post({ type: 'measureError', reqId, message: `PDF 未就绪: ${docId}` })
    return
  }
  touch(docId)
  try {
    const pdf = await entry.ready
    const page = await pdf.getPage(pageNum)
    const vp = page.getViewport({ scale: 1 })
    page.cleanup()
    post({
      type: 'measured',
      reqId,
      width: Math.floor(vp.width),
      height: Math.floor(vp.height)
    })
  } catch (e: any) {
    post({ type: 'measureError', reqId, message: String(e?.message || e) })
  }
}

function cancel(reqId: number) {
  const task = renderTasks.get(reqId)
  if (task) {
    try {
      task.cancel()
    } catch {
      /* 已结束的任务 cancel 抛错可忽略 */
    }
    renderTasks.delete(reqId)
  }
}

async function close() {
  for (const task of renderTasks.values()) {
    try {
      task.cancel()
    } catch {
      /* ignore */
    }
  }
  renderTasks.clear()
  // 销毁全部文档
  for (const docId of [...docs.keys()]) {
    await destroyDoc(docId)
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  switch (msg.type) {
    case 'open':
      open(msg.docId, msg.source)
      break
    case 'render':
      render(msg.reqId, msg.docId, msg.page, msg.scale)
      break
    case 'measure':
      measure(msg.reqId, msg.docId, msg.page)
      break
    case 'cancel':
      cancel(msg.reqId)
      break
    case 'closeDoc':
      destroyDoc(msg.docId)
      break
    case 'close':
      close()
      break
  }
}
