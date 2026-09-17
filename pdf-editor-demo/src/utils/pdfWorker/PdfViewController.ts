/**
 * 共享 PDF 视图控制器。
 *
 * View 创建唯一一个（非响应式）实例，以 prop 传给左右两个 Preview，实现：
 * - 单次解析：一个 PDFManage 提供逐页精确尺寸 / 大纲 / 打印 / 主线程回退渲染。
 * - 单一渲染池：PdfRenderEngine（broadcast 模式，docId='view'）线程池把 1~3s 栅格化移出主线程。
 * - 共享位图缓存：BitmapCache 按 `${page}@${scale}` 命中，左右两侧各自分辨率互不踩踏。
 *
 * 为何用普通 TS 类而非 Pinia：缓存的是二进制不透明资源（ImageBitmap / PDFDocumentProxy），
 * 响应式代理无收益且可能被 Vue 深度追踪；生命周期是「每次 View 挂载」而非全局。
 * 仅 ready 用一个轻量 ref 暴露，重数据保持非响应式。
 */
import { ref, type Ref } from 'vue'
import { PDFManage } from '@/utils/pdfRender'
import type { ParsedOutlineItem } from '@/types/document'
import type { CacheSize } from '@/types/preview'
import { PdfRenderEngine } from './PdfRenderEngine'
import { BitmapCache } from './BitmapCache'

export interface ControllerSource {
  url?: string
  data?: ArrayBuffer
  password?: string
}

interface InflightEntry {
  /** worker 路径的请求 id（>=0）；主线程回退为 -1（不可中止） */
  reqId: number
  promise: Promise<ImageBitmap>
}

/** /view 单文档场景固定的 docId（broadcast 模式下文档铺满全部 worker） */
const VIEW_DOC_ID = 'view'

export class PdfViewController {
  /** 主线程 PDFManage：尺寸 / 大纲 / 打印 / 回退渲染 */
  readonly manage = new PDFManage()
  private engine = new PdfRenderEngine({ mode: 'broadcast' })
  private cache = new BitmapCache()
  private inflight = new Map<string, InflightEntry>()
  private useWorker = false

  /** 文档就绪后置位，供 Preview / View watch */
  readonly ready: Ref<boolean> = ref(false)
  numPages = 0
  outline: ParsedOutlineItem[] = []

  constructor(private source: ControllerSource) {}

  get cacheSize(): CacheSize {
    return this.manage.cacheSize
  }

  /** 主线程解析与 worker 池预热并行，最大化首屏速度 */
  async init() {
    const docSource = (this.source.url || this.source.data) as string | ArrayBuffer

    const parseTask = (async () => {
      await this.manage.parsePDF(docSource, this.source.password)
      await this.manage.getPDFSize()
      this.numPages = this.manage.numPages
      this.outline = await this.manage.getOutline()
    })()

    const enginePromise = this.engine.open(VIEW_DOC_ID, {
      url: this.source.url,
      data: this.source.data,
      password: this.source.password
    })

    const [, workerOk] = await Promise.all([parseTask, enginePromise])
    this.useWorker = this.engine.available && workerOk
    this.ready.value = true
  }

  /** 缓存键：按缩放档区分左右两侧不同分辨率 */
  private keyOf(page: number, scale: number) {
    return `${page}@${scale.toFixed(3)}`
  }

  /** 同步探查缓存（命中即刷新 LRU）：供 Preview 在重入/缩放时立即重绘 */
  peekBitmap(page: number, scale: number): ImageBitmap | undefined {
    return this.cache.get(this.keyOf(page, scale))
  }

  /**
   * 请求某页某缩放的位图：命中缓存直接返回；否则去重后入队渲染。
   * worker 不可用时透明回退到主线程 PDFManage 渲染（仍返回 ImageBitmap，调用方无感）。
   */
  requestBitmap(page: number, scale: number): Promise<ImageBitmap> {
    const key = this.keyOf(page, scale)
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)

    const existing = this.inflight.get(key)
    if (existing) return existing.promise

    let reqId = -1
    let raw: Promise<ImageBitmap>
    if (this.useWorker) {
      const r = this.engine.render(VIEW_DOC_ID, page, scale)
      reqId = r.reqId
      // /view 不需要 PDF 逻辑尺寸（PDFManage 已提供），只取 bitmap
      raw = r.promise.then((frame) => frame.bitmap)
    } else {
      raw = this.mainThreadRender(page, scale)
    }

    const tracked = raw
      .then((bm) => {
        this.cache.set(key, bm)
        return bm
      })
      .finally(() => this.inflight.delete(key))

    this.inflight.set(key, { reqId, promise: tracked })
    return tracked
  }

  /** 离场取消：中止 worker 在途渲染（主线程回退路径无 reqId，无法中止） */
  cancelBitmap(page: number, scale: number) {
    const entry = this.inflight.get(this.keyOf(page, scale))
    if (entry && entry.reqId >= 0) this.engine.cancel(entry.reqId)
  }

  /** worker 不可用时的主线程回退：复用 PDFManage.renderPage（不挂 DOM，仅取像素） */
  private async mainThreadRender(page: number, scale: number): Promise<ImageBitmap> {
    const canvas = document.createElement('canvas')
    const rendered = (await this.manage.renderPage(page, scale, canvas)) as HTMLCanvasElement
    return createImageBitmap(rendered)
  }

  /** 供打印等场景获取底层 PDFManage（与原 PreviewType.getPDFInstance 一致） */
  getPDFInstance(): PDFManage {
    return this.manage
  }

  destroy() {
    for (const entry of this.inflight.values()) {
      if (entry.reqId >= 0) this.engine.cancel(entry.reqId)
    }
    this.inflight.clear()
    this.cache.clear()
    this.engine.destroy()
    try {
      this.manage.destroy()
    } catch {
      /* ignore */
    }
  }
}
