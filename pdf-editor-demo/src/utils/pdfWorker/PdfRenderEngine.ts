/**
 * 主线程侧的 Worker 渲染线程池（双模 + 多文档）。
 *
 * **模式**
 * - `broadcast`：单文档铺满全部 worker（/view 场景，左右两侧不同分辨率打到不同 worker，最大并发）。
 *   open() 把同一份数据源分发给池内每个 worker；render() 取在途任务最少的 worker。
 * - `sticky`：多文档共享池，每个 docId 粘性绑定到固定 worker（OrganizePDF / SplitPDF 缩略图场景）。
 *   open() 仅对一个 worker 上传该文档；render() 路由到该 worker，避免跨 worker 重复解析。
 *
 * **池大小**
 * - broadcast：[2, 6]，与 /view 历史一致。
 * - sticky：[3, 6]，缩略图多文档粘性路由，3 起步保证 11+ 文件较均匀分摊到各 worker。
 *
 * **本地 ArrayBuffer 副本**
 * - broadcast：限制副本数 ≤3 控内存（与 isScannedPDF 历史一致）。
 * - sticky：每个 docId 仅 1 份副本（粘到单 worker），无副本爆炸风险。
 *
 * cancel() 立即结算并通知 worker 中止 RenderTask；available 为 OffscreenCanvas + 模块 Worker 特性探测。
 */
import type { PdfWorkerSource, WorkerRequest, WorkerResponse } from './pdfWorkerTypes'

/** 取消渲染时 promise 的 reject 标记，调用方据此静默忽略 */
export class RenderCancelledError extends Error {
  constructor() {
    super('render cancelled')
    this.name = 'RenderCancelledError'
  }
}

/** 池模式 */
export type EnginePoolMode = 'broadcast' | 'sticky'

interface WorkerSlot {
  worker: Worker
  /** worker 是否就绪（崩溃后置 false，不再被选中） */
  ready: boolean
  /** 进行中的请求数，用于负载均衡 */
  inFlight: number
  /** 该 worker 已持有的 docId 集合（仅 sticky 模式使用） */
  docs: Set<string>
}

/** 渲染产物：bitmap + scale=1 逻辑尺寸（worker 同次返回，无需二次 measure） */
export interface RenderedFrame {
  bitmap: ImageBitmap
  width: number
  height: number
}

interface PendingRender {
  resolve: (frame: RenderedFrame) => void
  reject: (err: any) => void
  slot: WorkerSlot
}

interface PendingMeasure {
  resolve: (size: { width: number; height: number }) => void
  reject: (err: any) => void
}

/** docId → open 解析结果（多 worker 都已就绪即视为就绪） */
interface DocState {
  /** 该文档绑定的 worker 集合（broadcast = 全部 worker；sticky = 单个） */
  slots: Set<WorkerSlot>
  /** open 完成的 promise，true 表示至少一个 worker 就绪 */
  ready: Promise<boolean>
}

/** 运行时特性探测：模块 Worker + OffscreenCanvas + transferToImageBitmap */
export const engineAvailable = (() => {
  try {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function'
    )
  } catch {
    return false
  }
})()

const HARDWARE = navigator.hardwareConcurrency || 4
const BROADCAST_POOL = Math.min(Math.max(HARDWARE, 2), 6)
/**
 * sticky 池 [3, 6]：缩略图多文档场景下 docId 粘性绑定到固定 worker，
 * 池太小会让 11+ 个 PDF 在 2 worker 上串行解析。3 起步保证 11 文件分组 ~4 个/worker。
 */
const STICKY_POOL = Math.min(Math.max(HARDWARE - 1, 3), 6)
const BROADCAST_LOCAL_DATA_CAP = 3

export interface PdfRenderEngineOptions {
  /** 池模式，默认 'broadcast'（与历史 /view 行为一致） */
  mode?: EnginePoolMode
}

export class PdfRenderEngine {
  available = engineAvailable
  private mode: EnginePoolMode
  private slots: WorkerSlot[] = []
  private docs = new Map<string, DocState>()
  /** reqId → 渲染请求 */
  private pendingRender = new Map<number, PendingRender>()
  /** reqId → measure 请求 */
  private pendingMeasure = new Map<number, PendingMeasure>()
  private reqSeq = 0
  private destroyed = false

  constructor(opts: PdfRenderEngineOptions = {}) {
    this.mode = opts.mode ?? 'broadcast'
  }

  /** 懒启动 worker 池（首次 open 触发） */
  private ensurePool() {
    if (this.slots.length > 0 || !this.available || this.destroyed) return
    const size = this.mode === 'broadcast' ? BROADCAST_POOL : STICKY_POOL
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./pdfRenderWorker.ts', import.meta.url), {
        type: 'module'
      })
      const slot: WorkerSlot = {
        worker,
        ready: true,
        inFlight: 0,
        docs: new Set()
      }
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(slot, ev.data)
      worker.onerror = (e) => {
        console.error('[PdfRenderEngine] worker 崩溃', this.mode, (e as ErrorEvent)?.message || e)
        slot.ready = false
      }
      this.slots.push(slot)
    }
  }

  /**
   * 打开/注册文档。
   * - broadcast：分发给池内全部 worker；
   * - sticky：分配给在途负载最轻的 worker，仅它持有该文档。
   * resolve 为 true 表示至少一个 worker 完成 open。
   */
  async open(docId: string, source: PdfWorkerSource): Promise<boolean> {
    if (!this.available || this.destroyed) return false
    const cached = this.docs.get(docId)
    if (cached) return cached.ready

    this.ensurePool()

    const targets = this.pickOpenTargets(source)
    if (targets.length === 0) {
      const settled = Promise.resolve(false)
      this.docs.set(docId, { slots: new Set(), ready: settled })
      return settled
    }

    const openPromises = targets.map((slot) => this.openOnSlot(slot, docId, source))
    const ready = Promise.all(openPromises).then((rs) => rs.some(Boolean))
    this.docs.set(docId, { slots: new Set(targets), ready })
    return ready
  }

  /** 选 open 目标 worker：sticky → 负载最轻的单个；broadcast → 全池（本地数据按上限控副本数） */
  private pickOpenTargets(source: PdfWorkerSource): WorkerSlot[] {
    if (this.mode === 'sticky') {
      const slot = this.pickStickySlot()
      return slot ? [slot] : []
    }
    const cap = source.url
      ? this.slots.length
      : Math.min(this.slots.length, BROADCAST_LOCAL_DATA_CAP)
    return this.slots.slice(0, cap)
  }

  /** 在单个 worker 上打开文档：一次性监听 opened/openError，resolve 该 worker 是否成功 */
  private openOnSlot(slot: WorkerSlot, docId: string, source: PdfWorkerSource): Promise<boolean> {
    slot.docs.add(docId)
    return new Promise<boolean>((resolve) => {
      const listener = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data
        if (msg.type === 'opened' && msg.docId === docId) {
          slot.worker.removeEventListener('message', listener)
          resolve(true)
          return
        }
        if (msg.type === 'openError' && msg.docId === docId) {
          slot.worker.removeEventListener('message', listener)
          slot.docs.delete(docId)
          console.warn('[PdfRenderEngine] worker 打开文档失败', this.mode, docId, msg.message)
          resolve(false)
          return
        }
      }
      slot.worker.addEventListener('message', listener)

      // 每 worker 各自数据：URL 直接复用；ArrayBuffer clone 后 transfer（原 buffer 不受影响）
      const payload: PdfWorkerSource = source.url
        ? { url: source.url, password: source.password }
        : { data: source.data!.slice(0), password: source.password }
      const transfer = payload.data ? [payload.data] : []
      slot.worker.postMessage({ type: 'open', docId, source: payload } as WorkerRequest, transfer)
    })
  }

  /** 关闭单份文档：通知所有持有它的 worker 释放 */
  closeDoc(docId: string) {
    const state = this.docs.get(docId)
    if (!state) return
    for (const slot of state.slots) {
      slot.docs.delete(docId)
      try {
        slot.worker.postMessage({ type: 'closeDoc', docId } as WorkerRequest)
      } catch {
        /* ignore */
      }
    }
    this.docs.delete(docId)
  }

  /** 分发一次渲染，返回 reqId（供 cancel）与位图+尺寸 promise */
  render(docId: string, page: number, scale: number) {
    const reqId = ++this.reqSeq
    const slot = this.pickRenderSlot(docId)
    if (!slot) {
      return { reqId, promise: Promise.reject(new Error(`无可用渲染 worker: ${docId}`)) }
    }
    const promise = new Promise<RenderedFrame>((resolve, reject) => {
      this.pendingRender.set(reqId, { resolve, reject, slot })
      slot.inFlight++
      slot.worker.postMessage({ type: 'render', reqId, docId, page, scale } as WorkerRequest)
    })
    return { reqId, promise }
  }

  /** 取页尺寸（不栅格化） */
  measure(docId: string, page: number): Promise<{ width: number; height: number }> {
    const reqId = ++this.reqSeq
    const slot = this.pickRenderSlot(docId)
    if (!slot) return Promise.reject(new Error(`无可用渲染 worker: ${docId}`))
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      this.pendingMeasure.set(reqId, { resolve, reject })
      slot.worker.postMessage({ type: 'measure', reqId, docId, page } as WorkerRequest)
    })
  }

  /** 中止一次渲染：立即结算并通知 worker 取消在途 RenderTask */
  cancel(reqId: number) {
    const p = this.pendingRender.get(reqId)
    if (!p) return
    p.slot.worker.postMessage({ type: 'cancel', reqId } as WorkerRequest)
    this.finishRender(reqId)
    p.reject(new RenderCancelledError())
  }

  destroy() {
    this.destroyed = true
    for (const p of this.pendingRender.values()) p.reject(new RenderCancelledError())
    this.pendingRender.clear()
    for (const p of this.pendingMeasure.values()) p.reject(new RenderCancelledError())
    this.pendingMeasure.clear()
    for (const slot of this.slots) {
      try {
        slot.worker.postMessage({ type: 'close' } as WorkerRequest)
      } catch {
        /* ignore */
      }
      slot.worker.terminate()
    }
    this.slots = []
    this.docs.clear()
  }

  /** sticky 模式 open 时挑 worker：选持有 docId 数最少 + 在途任务最少 */
  private pickStickySlot(): WorkerSlot | null {
    let best: WorkerSlot | null = null
    for (const slot of this.slots) {
      if (!slot.ready) continue
      if (
        !best ||
        slot.docs.size < best.docs.size ||
        (slot.docs.size === best.docs.size && slot.inFlight < best.inFlight)
      ) {
        best = slot
      }
    }
    return best
  }

  /** render 时挑 worker：broadcast = 在途最少；sticky = 持有 docId 的 worker（必单一） */
  private pickRenderSlot(docId: string): WorkerSlot | null {
    const state = this.docs.get(docId)
    if (!state) return null
    let best: WorkerSlot | null = null
    for (const slot of state.slots) {
      if (!slot.ready) continue
      if (!best || slot.inFlight < best.inFlight) best = slot
    }
    return best
  }

  /** 渲染请求离开 pending：归还 inFlight 配额并返回原记录 */
  private finishRender(reqId: number): PendingRender | undefined {
    const p = this.pendingRender.get(reqId)
    if (p) {
      p.slot.inFlight = Math.max(0, p.slot.inFlight - 1)
      this.pendingRender.delete(reqId)
    }
    return p
  }

  private onMessage(_slot: WorkerSlot, msg: WorkerResponse) {
    if (this.destroyed) {
      // 已销毁：仍可能收到在途位图，关闭以防泄漏
      if (msg.type === 'rendered') msg.bitmap.close()
      return
    }
    switch (msg.type) {
      case 'rendered': {
        const p = this.finishRender(msg.reqId)
        if (p) {
          p.resolve({ bitmap: msg.bitmap, width: msg.width, height: msg.height })
        } else {
          msg.bitmap.close() // 已被取消，丢弃避免泄漏
        }
        break
      }
      case 'cancelled': {
        const p = this.finishRender(msg.reqId)
        p?.reject(new RenderCancelledError())
        break
      }
      case 'renderError': {
        const p = this.finishRender(msg.reqId)
        p?.reject(new Error(msg.message))
        break
      }
      case 'measured': {
        const m = this.pendingMeasure.get(msg.reqId)
        if (m) {
          this.pendingMeasure.delete(msg.reqId)
          m.resolve({ width: msg.width, height: msg.height })
        }
        break
      }
      case 'measureError': {
        const m = this.pendingMeasure.get(msg.reqId)
        if (m) {
          this.pendingMeasure.delete(msg.reqId)
          m.reject(new Error(msg.message))
        }
        break
      }
      case 'opened':
      case 'openError':
        // open() 内部以临时 listener 单独处理，这里忽略
        break
    }
  }
}
