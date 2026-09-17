/**
 * usePdfThumbnails —— PDF 缩略图 Hook（单/多文件、动态增删）
 *
 * 内聚「Worker 池栅格化 + 空闲调度 + LRU 缓存 + 生命周期」：
 * - 进入可见区 → 空闲调度 → Worker 池一次往返产「ImageBitmap + scale=1 逻辑尺寸」
 *   → 主线程二次编码 JPEG Blob → createObjectURL → 写入响应式 thumbs。
 * - 离开可见区 → 取消空闲任务 + cancel 在途 worker RenderTask（真正停掉 1~10s 栅格化）。
 * - thumbs 即缓存（响应式 Record<string, string>），可直接绑 <img :src>。
 * - LRU 超额淘汰跳过当前可见 key 并 revokeObjectURL，杜绝快速滚动破图。
 * - 卸载自动清理：cancel 全部 worker 任务、revoke 全部 URL、closeDoc 释放 worker 内 PDF。
 *
 * 为什么不在主线程跑 page.render：
 *   单页满清缩略图（如 2k×2.8k）的 pdf.js 栅格化耗时 1~10s 全在主线程同步执行。
 *   Worker 池跑 OffscreenCanvas + transferToImageBitmap 后，主线程只剩
 *   `bitmap → drawImage → convertToBlob`（通常 < 30ms），不再卡帧。
 *
 * 模块级共享 sticky 引擎：
 *   多个 Hook 实例共享同一个 sticky 池，避免每个组件都启 N 个 worker。
 *   引擎由首个 Hook 懒启动，最后一个 Hook unmount 时引用计数归零并销毁。
 *
 * @example
 * const { thumbs, registerDoc } = usePdfThumbnails({
 *   getVisibleKeys: () => visibleKeys.value,
 *   resolve: (key) => ({ docId: 'doc1', page: Number(key), scale: 0.3 })
 * })
 * registerDoc('doc1', { url: 'https://...' })
 * // 模板：<img :src="thumbs[key]" />
 */
import { reactive, watch, onUnmounted } from 'vue'
import { scheduleIdleTask, cancelIdleTask, isOffscreenCanvasAvailable } from '@/utils/tools'
import { parsePDF } from '@/utils/pdfRender'
import { PdfRenderEngine, RenderCancelledError } from '@/utils/pdfWorker/PdfRenderEngine'
import type { PdfWorkerSource } from '@/utils/pdfWorker/pdfWorkerTypes'

/** 注册数据源：本地文件传 file（内部转 Blob URL），云文件传 url */
export interface ThumbnailSource {
  url?: string
  file?: Blob
  password?: string
}

/** 单次渲染请求 */
export interface ThumbnailRequest {
  docId: string
  /** 1-based 页码 */
  page: number
  /** 逻辑缩放比例，直接用于 getViewport({ scale }) */
  scale: number
  /** JPEG 质量 0~1，默认 0.7 */
  quality?: number
}

/** Hook 配置选项 */
export interface UsePdfThumbnailsOptions {
  /** 当前可见的 key 集合。返回 null/undefined 表示虚拟滚动未就绪 */
  getVisibleKeys: () => Set<string> | null | undefined
  /** 把 key 映射为渲染请求；返回 null 表示跳过（如空白页） */
  resolve: (key: string) => { docId: string; page: number; scale: number; quality?: number } | null
  /** 渲染完成回传该页 scale=1 逻辑尺寸（如 OrganizePDF 写回 page.width/height） */
  onSize?: (key: string, size: { width: number; height: number }) => void
  /** 透传给 scheduleIdleTask 的超时 ms，默认 2000 */
  timeout?: number
  /** 缩略图缓存上限（条数），超额按 LRU 淘汰（跳过可见 key）。默认 300 */
  maxCached?: number
}

/* ────────────── 模块级共享 sticky 引擎（多 Hook 共池，引用计数） ────────────── */

let sharedEngine: PdfRenderEngine | null = null
let sharedRefCount = 0

const acquireEngine = (): PdfRenderEngine | null => {
  if (!sharedEngine) {
    const engine = new PdfRenderEngine({ mode: 'sticky' })
    if (!engine.available) {
      engine.destroy()
      return null
    }
    sharedEngine = engine
  }
  sharedRefCount++
  return sharedEngine
}

const releaseEngine = () => {
  sharedRefCount = Math.max(0, sharedRefCount - 1)
  if (sharedRefCount === 0 && sharedEngine) {
    sharedEngine.destroy()
    sharedEngine = null
  }
}

/** 在途渲染：单调递增 token + 可选 worker reqId（fallback 路径无 reqId） */
interface InflightEntry {
  token: number
  reqId: number | null
}

/* ────────────── 模块级 Canvas 工具（Offscreen 优先，DOM 兜底） ────────────── */

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
/** 确保 canvas 尺寸 ≥ 1px */
const safeCeil = (n: number) => Math.max(1, Math.ceil(n))

/** 建一块 2D 画布并取上下文（取不到即抛错） */
const createCanvas2d = (w: number, h: number, opts?: CanvasRenderingContext2DSettings) => {
  const canvas = isOffscreenCanvasAvailable
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d', opts) as Canvas2D | null
  if (!ctx) throw new Error('无法获取 Canvas 2D 上下文')
  return { canvas, ctx }
}

/** 画布 → JPEG Blob（Offscreen 用 convertToBlob，DOM 用回调版 toBlob） */
const canvasToJpeg = (canvas: OffscreenCanvas | HTMLCanvasElement, quality: number) => {
  if (isOffscreenCanvasAvailable) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))),
      'image/jpeg',
      quality
    )
  )
}

export function usePdfThumbnails(options: UsePdfThumbnailsOptions) {
  const { getVisibleKeys, resolve, onSize, timeout = 1000, maxCached = 300 } = options

  /** 共享 sticky 引擎；不可用（无 OffscreenCanvas / 模块 worker）则全程走主线程回退 */
  const engine = acquireEngine()

  /** docId → { url, password }：仅主线程 fallback 解析使用 */
  const sources = new Map<string, { url: string; password?: string }>()
  /** docId → 自建的 Blob URL（仅 file→Blob URL 需 revoke，云端 url 不动） */
  const ownedUrls = new Map<string, string>()
  /** docId → 主线程 fallback 已解析的 PDFDocumentProxy（worker 路径不需要） */
  const fallbackPdfCache = new Map<string, any>()
  /** docId → fallback 解析中的 Promise，防并发重复加载 */
  const fallbackPdfLoading = new Map<string, Promise<any>>()
  /**
   * docId → worker open 完成的 Promise（true=worker 就绪，false=不可用/失败回退主线程）。
   * 渲染前 await 它，避免 open 仍在读 ArrayBuffer 时 render 落空、误回退主线程。
   */
  const opening = new Map<string, Promise<boolean>>()

  /** key → 在途渲染身份（token 用于离场时使原 promise 完成回调早退；reqId 用于 cancel worker） */
  const inflight = new Map<string, InflightEntry>()
  /** 全局递增 token，每发一次渲染 +1 */
  let tokenSeq = 0

  /** 响应式缩略图缓存：thumbs[key] = objectURL，直接绑 <img :src> */
  const thumbs = reactive<Record<string, string>>({})
  /** LRU 序（Map 插入序即最久未用序） */
  const lru = new Map<string, string>()
  /** key → 空闲任务 ID，用于取消与防重复调度 */
  const tasks = new Map<string, number>()

  /** 检查 key 是否在虚拟滚动可见区内 */
  const isVisible = (key: string) => getVisibleKeys()?.has(key) ?? false

  // ── 缓存操作 ──

  /** 写入/刷新一张缩略图：创建 objectURL → 写入 thumbs → 按预算淘汰不可见旧项 */
  const setThumb = (key: string, url: string) => {
    const old = lru.get(key)
    lru.delete(key) // 移除旧位置，重插到队尾刷新 LRU 序
    lru.set(key, url)
    thumbs[key] = url
    if (old && old !== url) URL.revokeObjectURL(old)
    evict()
  }

  /** 删除并回收一张缩略图的 objectURL */
  const drop = (key: string) => {
    const url = lru.get(key)
    if (url) {
      URL.revokeObjectURL(url)
      lru.delete(key)
      delete thumbs[key]
    }
  }

  /**
   * LRU 淘汰：超预算时移除最久未用且当前不可见的项。
   * 先收集后删除，避免在 Map 迭代中直接变异。
   */
  const evict = () => {
    if (lru.size <= maxCached) return
    const toDrop: string[] = []
    for (const key of lru.keys()) {
      if (lru.size - toDrop.length <= maxCached) break
      if (isVisible(key)) continue // 跳过可见 key，防止滚动时破图
      toDrop.push(key)
    }
    for (const key of toDrop) drop(key)
  }

  // ── 调度 / 取消 ──

  /** 取消某 key 的空闲任务 + 在途 worker 渲染（token 自然失效，旧 promise 完成时早退） */
  const cancelKey = (key: string) => {
    const id = tasks.get(key)
    if (id !== undefined) {
      cancelIdleTask(id)
      tasks.delete(key)
    }
    const entry = inflight.get(key)
    if (entry) {
      inflight.delete(key)
      if (entry.reqId !== null) engine?.cancel(entry.reqId)
    }
  }

  // ── 主线程 fallback：worker 不可用 / 出错时使用 ──

  const ensureFallbackPdf = async (docId: string) => {
    const cached = fallbackPdfCache.get(docId)
    if (cached) return cached
    const loading = fallbackPdfLoading.get(docId)
    if (loading) return loading
    const src = sources.get(docId)
    if (!src) return null
    const promise = (async () => {
      try {
        const pdf = await parsePDF(src.url, src.password)
        if (pdf) fallbackPdfCache.set(docId, pdf)
        return pdf ?? null
      } finally {
        fallbackPdfLoading.delete(docId)
      }
    })()
    fallbackPdfLoading.set(docId, promise)
    return promise
  }

  /** 主线程 fallback 渲染：返回缩略图帧 */
  const renderFallback = async (req: ThumbnailRequest) => {
    const pdf = await ensureFallbackPdf(req.docId)
    if (!pdf) throw new Error(`文档解析失败: ${req.docId}`)
    const page = await pdf.getPage(req.page)
    const baseVp = page.getViewport({ scale: 1 })
    const renderVp = page.getViewport({ scale: req.scale })
    const { canvas, ctx } = createCanvas2d(safeCeil(renderVp.width), safeCeil(renderVp.height), {
      willReadFrequently: true
    })
    await page.render({ canvasContext: ctx as any, viewport: renderVp }).promise
    page.cleanup()
    const blob = await canvasToJpeg(canvas, req.quality ?? 0.7)
    return {
      blob,
      size: {
        width: Math.floor(baseVp.width),
        height: Math.floor(baseVp.height)
      }
    }
  }

  /** 把 worker 产的 ImageBitmap 在主线程二次编码为 JPEG Blob（通常 < 30ms） */
  const encodeBitmap = async (bitmap: ImageBitmap, quality: number) => {
    const { canvas, ctx } = createCanvas2d(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    return canvasToJpeg(canvas, quality)
  }

  /**
   * 产出一帧缩略图：worker 优先，cancel/失效返回 null；worker 出错则告警后回退主线程。
   * token 失效（被 cancelKey 移除或被新调度覆盖）即视为取消，丢弃结果。
   */
  const produceFrame = async (key: string, req: ThumbnailRequest, token: number) => {
    const stillValid = () => inflight.get(key)?.token === token
    const quality = req.quality ?? 0.7

    // 先占位登记（reqId 待定），使下方 await open 期间也能被 cancelKey 标记失效
    inflight.set(key, { token, reqId: null })

    // 等待该 doc 的 worker open 完成；false = 不可用/失败 → 走主线程回退
    const opened = engine ? await (opening.get(req.docId) ?? Promise.resolve(false)) : false
    if (!stillValid()) return null

    if (engine && opened) {
      const r = engine.render(req.docId, req.page, req.scale)
      inflight.set(key, { token, reqId: r.reqId })
      try {
        const frame = await r.promise
        if (!stillValid()) {
          frame.bitmap.close()
          return null
        }
        const blob = await encodeBitmap(frame.bitmap, quality)
        frame.bitmap.close()
        return { blob, size: { width: frame.width, height: frame.height } }
      } catch (err: any) {
        if (err instanceof RenderCancelledError) return null
        console.warn(
          `[usePdfThumbnails] worker 渲染失败，回退主线程 ${req.docId} p${req.page}:`,
          err?.message || err
        )
        // 落入下方主线程回退
      }
    }

    if (!stillValid()) return null
    return renderFallback(req)
  }

  /** 单 key 渲染：产出帧 → 复检 token → 提交（写 thumbs + 回传尺寸） */
  const renderKey = async (key: string, req: ThumbnailRequest) => {
    const token = ++tokenSeq
    try {
      const frame = await produceFrame(key, req, token)
      if (!frame || inflight.get(key)?.token !== token) return
      setThumb(key, URL.createObjectURL(frame.blob))
      onSize?.(key, frame.size)
    } catch (err: any) {
      if (!(err instanceof RenderCancelledError)) {
        console.warn(`[usePdfThumbnails] 缩略图渲染失败 key=${key}:`, err?.message || err)
      }
    } finally {
      if (inflight.get(key)?.token === token) inflight.delete(key)
    }
  }

  /** 调度某 key 渲染：未缓存、未调度、未在途 → 起一个空闲任务 */
  const schedule = (key: string) => {
    if (tasks.has(key) || thumbs[key] || inflight.has(key)) return
    const id = scheduleIdleTask(() => {
      tasks.delete(key)
      /** 触发时复检：渲染间隔内可能已被缓存或离开可见区 */
      if (thumbs[key] || !isVisible(key)) return
      const req = resolve(key)
      if (!req) return // 空白页 / 无效 key
      renderKey(key, req)
    }, timeout)
    tasks.set(key, id)
  }

  // ── 可见集变化监听 ──

  const stopWatch = watch(getVisibleKeys, (newKeys, oldKeys) => {
    if (!newKeys) return
    /** 离开可见区的 key：取消空闲任务 + 丢弃在途渲染 */
    if (oldKeys) {
      for (const k of oldKeys) if (!newKeys.has(k)) cancelKey(k)
    }
    /** 进入可见区且未缓存的 key：触发空闲调度 */
    for (const k of newKeys) schedule(k)
  })

  // ── 公开 API ──

  /** 在共享引擎上打开文档，resolve 为 worker 是否就绪 */
  const openDocOnWorker = async (
    docId: string,
    file: Blob | undefined,
    cloudUrl: string,
    password?: string
  ) => {
    try {
      const payload: PdfWorkerSource = file
        ? { data: await file.arrayBuffer(), password }
        : { url: cloudUrl, password }
      if (!sources.has(docId)) return false // 已 release
      const ok = await engine!.open(docId, payload)
      if (!ok) console.warn('[usePdfThumbnails] worker 打开文档失败，回退主线程渲染:', docId)
      return ok
    } catch (e: any) {
      console.warn('[usePdfThumbnails] worker 打开文档异常，回退主线程渲染:', docId, e)
      return false
    }
  }

  /**
   * 注册数据源（幂等）。
   * 本地 file → 内部创建 Blob URL（fallback 用）+ 读 ArrayBuffer 给 worker；云 url → 直接复用。
   * worker open（含 arrayBuffer 读取）收敛为一个 promise 存入 opening，渲染前 await 它。
   */
  const registerDoc = (docId: string, source: ThumbnailSource) => {
    if (sources.has(docId)) return
    let url = source.url
    if (!url && source.file) {
      url = URL.createObjectURL(source.file)
      ownedUrls.set(docId, url)
    }
    if (!url) return
    sources.set(docId, { url, password: source.password })
    if (!engine) return
    // worker 侧数据源：本地文件传 ArrayBuffer（规避 blob URL 在 worker 内 useWorkerFetch 拉取失败），
    // 云端 https url 直接复用。主线程 fallback 仍走上面创建的 blob URL，互不影响。
    opening.set(docId, openDocOnWorker(docId, source.file, url, source.password))
  }

  /** 释放单份文档：取消在途渲染、回收缩略图、销毁 PDF 解析对象、revoke 自建 Blob URL */
  const releaseDoc = (docId: string) => {
    /** 清除属于该文档的缩略图缓存与在途任务 */
    for (const key of [...lru.keys()]) {
      const req = resolve(key)
      if (req?.docId === docId) {
        cancelKey(key)
        drop(key)
      }
    }
    engine?.closeDoc(docId)
    const pdf = fallbackPdfCache.get(docId)
    if (pdf) {
      try {
        pdf.destroy()
      } catch {
        /* ignore */
      }
      fallbackPdfCache.delete(docId)
    }
    fallbackPdfLoading.delete(docId)
    opening.delete(docId)
    const owned = ownedUrls.get(docId)
    if (owned) {
      URL.revokeObjectURL(owned)
      ownedUrls.delete(docId)
    }
    sources.delete(docId)
  }

  /** 回收单张缩略图（如删除某页时调用） */
  const release = (key: string) => {
    cancelKey(key)
    drop(key)
  }

  /** 取某页 scale=1 逻辑尺寸（不栅格化），用于空白页插入兜底 */
  const measure = async (
    docId: string,
    page: number
  ): Promise<{ width: number; height: number }> => {
    // 与渲染同样需等 open 完成，避免 doc 未就绪时落空
    const opened = engine ? await (opening.get(docId) ?? Promise.resolve(false)) : false
    if (engine && opened) return engine.measure(docId, page)
    const pdf = await ensureFallbackPdf(docId)
    if (!pdf) throw new Error(`measure: 文档解析失败 ${docId}`)
    const p = await pdf.getPage(page)
    const vp = p.getViewport({ scale: 1 })
    p.cleanup()
    return {
      width: Math.floor(vp.width),
      height: Math.floor(vp.height)
    }
  }

  /** 销毁：取消调度、revoke URL、销毁 PDF 解析对象、释放共享引擎引用 */
  const dispose = () => {
    stopWatch()
    for (const id of tasks.values()) cancelIdleTask(id)
    tasks.clear()
    for (const entry of inflight.values()) {
      if (entry.reqId !== null) engine?.cancel(entry.reqId)
    }
    inflight.clear()
    for (const url of lru.values()) URL.revokeObjectURL(url)
    lru.clear()
    for (const key of Object.keys(thumbs)) delete thumbs[key]
    for (const docId of sources.keys()) engine?.closeDoc(docId)
    for (const pdf of fallbackPdfCache.values()) {
      try {
        pdf.destroy()
      } catch {
        /* ignore */
      }
    }
    fallbackPdfCache.clear()
    fallbackPdfLoading.clear()
    opening.clear()
    for (const url of ownedUrls.values()) URL.revokeObjectURL(url)
    ownedUrls.clear()
    sources.clear()
    releaseEngine()
  }

  onUnmounted(dispose)

  return {
    thumbs,
    registerDoc,
    releaseDoc,
    release,
    measure,
    dispose
  }
}
