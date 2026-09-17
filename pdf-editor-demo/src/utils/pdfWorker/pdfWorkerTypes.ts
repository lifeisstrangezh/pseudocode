/**
 * pdfRenderWorker 与主线程（PdfRenderEngine）之间的消息协议。
 *
 * 多文档：所有渲染消息都带 docId，worker 内 Map<docId, pdf> + LRU 持有解析对象。
 *
 * 主线程 → worker：open / render / measure / cancel / closeDoc / close
 * worker → 主线程：opened / openError / rendered / measured / measureError / cancelled / renderError
 *
 * 渲染产物为零拷贝 transfer 回主线程的 ImageBitmap（postMessage 第二参传 [bitmap]）。
 */

/** CSS px ↔ PDF pt 换算系数（96 / 72 = 1 / 0.75），与 PDFManage 的缩放约定保持一致 */
export const CSS_PT_RATIO = 0.75

/** PDF 数据源：远程 URL 由 worker 自取（ranged fetch，几乎不额外占内存）或本地 ArrayBuffer（每 worker 一份副本） */
export interface PdfWorkerSource {
  url?: string
  data?: ArrayBuffer
  password?: string
}

/* ----------------------------- 主线程 → worker ----------------------------- */

export interface ReqOpen {
  type: 'open'
  /** 文档身份；同 docId 重复 open 视为幂等 */
  docId: string
  source: PdfWorkerSource
}
export interface ReqRender {
  type: 'render'
  reqId: number
  docId: string
  page: number
  /** 逻辑缩放（与 PDFManage 一致，worker 内部再除以 0.75 得到栅格化 viewport） */
  scale: number
}
export interface ReqMeasure {
  type: 'measure'
  reqId: number
  docId: string
  page: number
}
export interface ReqCancel {
  type: 'cancel'
  reqId: number
}
/** 关闭单份文档（保留 worker，仅释放该 docId 的解析对象与 LRU 占位） */
export interface ReqCloseDoc {
  type: 'closeDoc'
  docId: string
}
/** 关闭整个 worker（释放所有文档） */
export interface ReqClose {
  type: 'close'
}
export type WorkerRequest = ReqOpen | ReqRender | ReqMeasure | ReqCancel | ReqCloseDoc | ReqClose

/* ----------------------------- worker → 主线程 ----------------------------- */

export interface ResOpened {
  type: 'opened'
  docId: string
  numPages: number
}
export interface ResOpenError {
  type: 'openError'
  docId: string
  message: string
}
export interface ResRendered {
  type: 'rendered'
  reqId: number
  bitmap: ImageBitmap
  /** scale=1 时的逻辑宽（CSS px），与 bitmap 同次往返带回，免二次 measure */
  width: number
  /** scale=1 时的逻辑高（CSS px） */
  height: number
}
export interface ResMeasured {
  type: 'measured'
  reqId: number
  width: number
  height: number
}
export interface ResMeasureError {
  type: 'measureError'
  reqId: number
  message: string
}
export interface ResCancelled {
  type: 'cancelled'
  reqId: number
}
export interface ResRenderError {
  type: 'renderError'
  reqId: number
  message: string
}
export type WorkerResponse =
  | ResOpened
  | ResOpenError
  | ResRendered
  | ResMeasured
  | ResMeasureError
  | ResCancelled
  | ResRenderError
