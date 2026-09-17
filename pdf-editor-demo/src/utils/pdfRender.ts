// 使用 legacy 构建：内联 core-js polyfill（如 Promise.withResolvers，Safari 17.4 以下缺失）并做语法降级，
// 保证旧版 Safari 可正常工作；现代构建在 Safari < 17.4 会直接抛 TypeError 导致 PDF 无法加载
import * as PDFJS from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cloneArrayBuffer } from './formatConversion'
import { markRaw } from 'vue'
import type { RawOutlineItem, ParsedOutlineItem } from '@/types/document'

// 设置PDF.js的worker路径（指向 npm 包 pdfjs-dist 的官方 worker bundle，legacy 版本与主库保持一致）
PDFJS.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// 配置CMap支持，解决中文等特殊字符显示问题
const CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/'
const CMAP_PACKED = true
// 配置标准字体支持
const STANDARD_FONT_DATA_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/'

/**
 * @description: 解析PDF文件，不能将 pdf 对象转为响应式对象！！！
 */
export const parsePDF = async (data: string | URL | ArrayBuffer, password?: string) => {
  const isurl = typeof data === 'string' || data instanceof URL
  try {
    const pdf = await PDFJS.getDocument({
      url: isurl ? data : undefined,
      data: !isurl ? cloneArrayBuffer(data) : undefined,
      password,
      // 添加CMap支持，解决中文等特殊字符显示问题
      cMapUrl: CMAP_URL,
      cMapPacked: CMAP_PACKED,
      // 添加标准字体支持
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      // 启用范围请求，优化大型PDF加载
      rangeChunkSize: 65536,
      // 禁用自动创建表单字段
      disableAutoFetch: true,
      // 禁用流式处理
      disableStream: false
    }).promise
    return pdf
  } catch (err: any) {
    console.error(err)
  }
}

/**
 * 渲染 PDF 页面
 * @param pdf pdf 文档对象
 * @param pageNum 页码
 * @param canvas 渲染的canvas元素
 * @param scale 缩放比例
 */
export const renderPage = async (
  pdf: PDFJS.PDFDocumentProxy,
  pageNum: number,
  scale: number = 1,
  canvas: HTMLCanvasElement = document.createElement('canvas')
) => {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale })

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法获取 Canvas 2D 上下文')
  }

  canvas.width = viewport.width
  canvas.height = viewport.height
  const renderContext = {
    canvasContext: context,
    viewport
  }
  await page.render(renderContext).promise
  return canvas
}

// 获取用于获取 PDF文件的大小
export const getPDFSize = async (
  pdf: PDFJS.PDFDocumentProxy,
  scale: number = 1,
  extensionSize: number = 0
) => {
  let page = 1
  let totalH = 0
  let maxW = 0
  const size = new Map<number | string, { w: number; h: number; top?: number }>()

  while (page <= pdf.numPages) {
    const wh = { w: 0, h: 0, top: 0 }
    const pageInfo = await pdf.getPage(page)
    const viewport = pageInfo.getViewport({ scale })
    wh.w = viewport.width
    wh.h = viewport.height + extensionSize
    wh.top = totalH
    size.set(page, wh)
    totalH += wh.h
    maxW = Math.max(maxW, wh.w)
    page++
  }
  size.set('total', { w: maxW, h: totalH })
  return size
}

/**
 * 渲染 PDF 页面为图片
 * @param pdf pdf 文档对象
 * @param pageNum 页码
 * @param quality 压缩比例
 */
export const renderPageToImg = async (
  pdf: PDFJS.PDFDocumentProxy,
  pageNum: number = 1,
  scale: number = 0.3,
  quality: number = 0.5
) => {
  const canvas = await renderPage(pdf, pageNum, scale)
  return canvas.toDataURL('image/jpeg', quality)
}

// 解析大纲项
export async function loadOutline(pdf: PDFJS.PDFDocumentProxy): Promise<ParsedOutlineItem[]> {
  try {
    // 获取原始大纲
    const rawOutline = (await pdf.getOutline()) as RawOutlineItem[]
    if (!rawOutline) return []
    // 解析并返回带页码的大纲
    return parseOutlineItems(rawOutline, pdf)
  } catch (err) {
    return []
  }
}

// 递归解析大纲项
async function parseOutlineItems(
  items: RawOutlineItem[],
  pdf: PDFJS.PDFDocumentProxy
): Promise<ParsedOutlineItem[]> {
  const parsedItems: ParsedOutlineItem[] = []
  for (const item of items) {
    // 解析页码
    const page = await resolveDestinationPage(pdf, item.dest)
    // 递归解析子项
    const children = item.items ? await parseOutlineItems(item.items, pdf) : []
    parsedItems.push({
      title: item.title,
      page: page || 0,
      items: children
    })
  }

  return parsedItems
}

// 解析目标位置获取页码
async function resolveDestinationPage(
  pdf: PDFJS.PDFDocumentProxy,
  dest?: string | any[]
): Promise<number | null> {
  if (!dest) return null
  try {
    let resolvedDest: any[]
    if (typeof dest === 'string') {
      // 处理命名目标
      resolvedDest = (await pdf.getDestination(dest)) as any[]
    } else if (Array.isArray(dest)) {
      // 直接使用显式目标数组
      resolvedDest = dest
    } else {
      return null
    }
    // 提取页码（根据 PDF.js 的实现调整）
    if (resolvedDest[0].pageNumber) {
      return resolvedDest[0].pageNumber
    } else if (Array.isArray(resolvedDest)) {
      const pageRef = resolvedDest[0]
      if (typeof pageRef === 'number') {
        return pageRef + 1 // 处理从 0 开始的索引
      } else {
        const page = await pdf.getPageIndex(pageRef)
        return page + 1
      }
    }
    return null
  } catch (err) {
    console.warn('目标解析失败:', err)
    return null
  }
}

/**
 * 获取PDF基础信息
 * @param data PDF 文件数据
 * @param password
 * @returns
 */
export const getPDFInfo = async (data: string | URL | ArrayBuffer, password?: string) => {
  const info = {
    numPages: 0,
    preview: '',
    outline: [] as ParsedOutlineItem[]
  }
  const pdf = await parsePDF(data, password)
  if (pdf) {
    info.numPages = pdf.numPages
    const preview = await renderPageToImg(pdf)
    info.preview = preview
    const outline = await loadOutline(pdf)
    info.outline = outline
    pdf.destroy()
  }
  return info
}

// 导出PDFManage类
export class PDFManage {
  private pdf: PDFJS.PDFDocumentProxy = {} as PDFJS.PDFDocumentProxy
  public isLoaded: boolean = false
  public cacheSize: Map<number | string, { w: number; h: number; top?: number }> = new Map()
  public numPages: number = 1

  public parsePDF = async (data: string | URL | ArrayBuffer, password?: string) => {
    const isurl = typeof data === 'string' || data instanceof URL
    try {
      const pdf = await PDFJS.getDocument({
        url: isurl ? data : undefined,
        data: !isurl ? cloneArrayBuffer(data) : undefined,
        password,
        // 添加CMap支持，解决中文等特殊字符显示问题
        cMapUrl: CMAP_URL,
        cMapPacked: CMAP_PACKED,
        // 添加标准字体支持
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
        // 启用范围请求，优化大型PDF加载
        rangeChunkSize: 65536,
        // 禁用自动创建表单字段
        disableAutoFetch: true,
        // 禁用流式处理
        disableStream: false
      }).promise
      this.pdf = markRaw(pdf)
      this.numPages = this.pdf.numPages
      this.isLoaded = true
    } catch (err: any) {
      console.error(err)
    }
  }

  public renderPage = async (
    pageNum: number,
    scale: number = 1,
    canvas: HTMLCanvasElement = document.createElement('canvas')
  ) => {
    const parent = canvas.parentElement
    const newCanvas = canvas.cloneNode(true) as HTMLCanvasElement
    const page = await this.pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: scale / 0.75 })
    const context = newCanvas.getContext('2d')
    if (!context) {
      throw new Error('无法获取 Canvas 2D 上下文')
    }
    newCanvas.width = viewport.width
    newCanvas.height = viewport.height
    newCanvas.setAttribute('data-page-scale', scale.toString())
    const renderContext = {
      canvasContext: context,
      viewport
    }
    await page.render(renderContext).promise
    if (parent) {
      newCanvas.style.width = ''
      newCanvas.style.height = ''
      parent.removeChild(canvas)
      parent.appendChild(newCanvas)
    }
    return newCanvas
  }

  public getPageCanvas = async (
    pageNum: number,
    containerWidth: number,
    canvas: HTMLCanvasElement
  ) => {
    const page = await this.pdf.getPage(pageNum)
    const unscaledViewport = page.getViewport({ scale: 1 })

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法获取 Canvas 2D 上下文')
    }
    let fitScale = 1
    if (containerWidth > 0) {
      fitScale = containerWidth / unscaledViewport.width
    }
    const viewport = page.getViewport({ scale: fitScale })

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.setAttribute('data-page-scale', fitScale.toString())

    const renderContext = {
      canvasContext: context,
      viewport,
      background: 'transparent'
    }

    await page.render(renderContext).promise

    return canvas // ✅ 返回同一个对象
  }

  /**
   * 渲染 PDF 文本层 (用于实现划词、复制)
   * @param pageNum 页码
   * @param scale 缩放比例 (必须与 renderPage 传入的 scale 一致)
   * @param container 挂载文本的 div 容器
   */
  public renderText = async (pageNum: number, scale: number = 1, container: HTMLDivElement) => {
    if (!this.isLoaded || !this.pdf) {
      throw new Error('PDF未加载完成')
    }

    if (!container) {
      throw new Error('必须提供文本层容器 DOM')
    }

    try {
      const page = await this.pdf.getPage(pageNum)

      // 保持和 renderPage 完全一致的缩放逻辑
      const viewport = page.getViewport({ scale: scale / 0.75 })

      // 获取文本数据
      const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true // <--- 加上这个，阻止强制空白压缩
      })

      const parent = container.parentElement
      const newContainer = container

      // 初始化容器样式
      newContainer.style.width = `${viewport.width}px`
      newContainer.style.height = `${viewport.height}px`
      newContainer.style.setProperty('--scale-factor', viewport.scale.toString())

      // 必须添加 textLayer 类名以应用官方 CSS
      if (!newContainer.classList.contains('textLayer')) {
        newContainer.classList.add('textLayer')
      }

      const textLayer = new PDFJS.TextLayer({
        textContentSource: textContent,
        container: newContainer,
        viewport: viewport
      })

      // 执行渲染
      await textLayer.render()

      if (parent) {
        parent.removeChild(container)
        parent.appendChild(newContainer)
      }

      return newContainer
    } catch (err) {
      console.error(`渲染第 ${pageNum} 页文本层失败:`, err)
      throw err
    }
  }

  public getPDFSize = async (scale: number = 1, extensionSize: number = 0) => {
    let page = 1
    let totalH = 0
    let maxW = 0
    let minW = Number.MAX_VALUE
    let minH = Number.MAX_VALUE
    this.cacheSize.clear()

    while (page <= this.numPages) {
      const wh = { w: 0, h: 0, top: 0 }
      const pageInfo = await this.pdf.getPage(page)
      const viewport = pageInfo.getViewport({ scale: scale / 0.75 })
      wh.w = viewport.width
      wh.h = viewport.height + extensionSize
      wh.top = totalH
      this.cacheSize.set(page, wh)
      totalH += wh.h
      maxW = Math.max(maxW, wh.w)
      minW = Math.min(minW, wh.w)
      minH = Math.min(minH, wh.h)
      page++
    }
    this.cacheSize.set('total', { w: maxW, h: totalH })
    this.cacheSize.set('min', { w: minW, h: minH })
  }

  public renderPageToImg = async (
    pageNum: number = 1,
    scale: number = 0.5,
    quality: number = 0.3
  ) => {
    const canvas = await this.renderPage(pageNum, scale)
    return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', quality)
  }

  /** 取文档大纲（复用已解析的 pdf 代理，避免再解析一次） */
  public getOutline = async (): Promise<ParsedOutlineItem[]> => {
    return this.isLoaded ? loadOutline(this.pdf) : []
  }

  public destroy = () => {
    this.pdf.destroy()
    this.cacheSize.clear()
  }

  // 使用PDF.js内部打印方法
  public printPDF = async () => {
    if (!this.isLoaded || !this.pdf) {
      throw new Error('PDF未加载完成')
    }
    return new Promise<void>((resolve, reject) => {
      try {
        // 创建一个隐藏的iframe用于打印
        const printIframe = document.createElement('iframe')
        printIframe.style.display = 'none'
        document.body.appendChild(printIframe)

        // 添加加载失败处理
        printIframe.onerror = () => {
          console.error('PDF加载失败')
          document.body.removeChild(printIframe)
        }

        // 设置iframe的src为空白页，确保能够访问contentDocument
        printIframe.src = 'about:blank'

        // 等待iframe加载完成后处理PDF
        printIframe.onload = async () => {
          try {
            const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document
            if (!iframeDoc) {
              throw new Error('iframe文档加载失败')
            }
            // 创建打印容器
            const printContainer = iframeDoc.createElement('div')
            iframeDoc.body.appendChild(printContainer)

            // 设置打印样式
            const styleSheet = iframeDoc.createElement('style')
            styleSheet.textContent = `
            @page { margin: 0px; text-align: center; }
            @media print {
              body { margin: 0; }
              canvas { page-break-after: always; }
            }
          `
            iframeDoc.head.appendChild(styleSheet)

            for (let i = 1; i <= this.pdf.numPages; i++) {
              const canvas = await this.renderPage(i, 1.5)
              if (!canvas) {
                throw new Error('Canvas获取失败!')
              }
              printContainer.appendChild(canvas)
            }

            // 等待渲染完成后打印
            setTimeout(() => {
              printIframe.contentWindow?.focus()
              printIframe.contentWindow?.print()
              resolve()
              // 打印对话框关闭后清理资源
              setTimeout(() => {
                document.body.removeChild(printIframe)
              }, 1000)
            }, 1000)
          } catch (error) {
            console.error('PDF处理失败:', error)
            reject(error)
            document.body.removeChild(printIframe)
          }
        }
      } catch (error) {
        console.error('打印失败:', error)
        reject(error)
      }
    })
  }
}

/** PDF 图像操作符集合：操作符列表中命中任一即判定该页含图 */
const IMAGE_OPS = new Set([
  PDFJS.OPS.paintImageXObject, // 85 - 绘制 XObject 图像
  PDFJS.OPS.paintInlineImageXObject, // 86 - 绘制内联图像
  PDFJS.OPS.beginInlineImage, // 63 - 内联图像数据开始
  PDFJS.OPS.beginImageData,
  PDFJS.OPS.endInlineImage,
  PDFJS.OPS.paintImageMaskXObject,
  PDFJS.OPS.paintImageMaskXObjectGroup,
  PDFJS.OPS.paintInlineImageXObjectGroup,
  PDFJS.OPS.paintImageXObjectRepeat,
  PDFJS.OPS.paintImageMaskXObjectRepeat,
  PDFJS.OPS.paintSolidColorImageMask
])

/** 可见绘制操作符：用于识别“无文本、无图片对象，但页面由矢量路径绘制”的 PDF */
const VISIBLE_DRAWING_OPS = new Set([
  PDFJS.OPS.stroke,
  PDFJS.OPS.closeStroke,
  PDFJS.OPS.fill,
  PDFJS.OPS.eoFill,
  PDFJS.OPS.fillStroke,
  PDFJS.OPS.eoFillStroke,
  PDFJS.OPS.closeFillStroke,
  PDFJS.OPS.closeEOFillStroke,
  PDFJS.OPS.shadingFill
])

/** 并行扫描线程数：基于硬件并发数，区间 [2, 6] */
const SCAN_THREADS = Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 6)
/** 判断是否包含图像 */
const hasImageOperator = (fnArray: number[]): boolean => {
  for (let i = 0; i < fnArray.length; i++) {
    if (IMAGE_OPS.has(fnArray[i])) return true
  }
  return false
}

/** 判断页面是否存在可见非文本绘制内容；命中后不能再按纯空白页处理 */
const hasVisibleDrawingOperator = (fnArray: number[]): boolean => {
  for (let i = 0; i < fnArray.length; i++) {
    if (VISIBLE_DRAWING_OPS.has(fnArray[i])) return true
  }
  return false
}

/** getTextContent 返回的 items 中是否存在非空白字符串 */
const hasVisibleText = (items: any[]): boolean => items.some((item: any) => item.str?.trim())

/**
 * 多线程并行判定 PDF 是否为扫描件
 *
 * 判定规则
 * ───────────────────────────────────────────
 * 任意页有文字            → false  非扫描件
 * 全页无文字 && 含图像     → true   扫描件
 * 全页无文字 && 有绘制内容 → true   疑似扫描/不可提取文本 PDF
 * 全页无文字 && 无可见内容 → false  纯空白页
 *
 * @param sourceData      PDF 源数据（URL 字符串 或 ArrayBuffer）
 * @param password         文件密码（可选）
 * @param knownPageCount   已知页数（可选，传入可跳过探针加载节省一次 PDF 解析）
 */
export const isScannedPDF = async (
  sourceData: string | ArrayBuffer,
  password?: string,
  knownPageCount?: number
): Promise<boolean> => {
  // 归一化数据源：ArrayBuffer → Blob URL，避免 N 线程各 clone 一份撑爆内存
  const isUrl = typeof sourceData === 'string'
  let pdfUrl: string
  let revokeUrl: (() => void) | null = null

  if (isUrl) {
    pdfUrl = sourceData as string
  } else {
    const blob = new Blob([sourceData], { type: 'application/pdf' })
    pdfUrl = URL.createObjectURL(blob)
    revokeUrl = () => URL.revokeObjectURL(pdfUrl)
  }

  try {
    // 1：获取总页数（探针仅读取 PDF 文件头/尾结构，不解析页面内容）
    let numPages = knownPageCount
    if (!numPages) {
      const probe = await parsePDF(pdfUrl, password)
      if (!probe) return false
      numPages = probe.numPages
      probe.destroy()
    }
    if (!numPages) return false

    // 2：多线程并行逐页扫描
    const pagesPerThread = Math.ceil(numPages / SCAN_THREADS)

    // 跨线程共享标志（写入均为 = true，幂等无竞态）
    let foundText = false
    let foundImage = false
    let foundVisibleDrawing = false

    /**
     * 单线程任务：分配 [start, end] 页段。
     * 每页先 getTextContent 查文字，未命中再 getOperatorList 查图像。
     */
    const scan = async (threadId: number) => {
      const start = threadId * pagesPerThread + 1
      const end = Math.min(start + pagesPerThread - 1, numPages)
      if (start > numPages) return

      const docWorker = new PDFJS.PDFWorker({
        // 4.10.38 类型定义中 name 误标为 null，运行时实际接受 string
        name: `scanner-${threadId}` as any
      })
      let pdf: PDFJS.PDFDocumentProxy | null = null

      try {
        pdf = await PDFJS.getDocument({
          url: pdfUrl,
          password,
          worker: docWorker,
          cMapUrl: CMAP_URL,
          cMapPacked: CMAP_PACKED,
          standardFontDataUrl: STANDARD_FONT_DATA_URL,
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          disableStream: false
        }).promise
        if (!pdf) return

        for (let p = start; p <= end; p++) {
          if (foundText) return

          const page = await pdf.getPage(p)
          try {
            const { items } = await page.getTextContent()
            if (hasVisibleText(items)) {
              foundText = true
              return
            }
            if (!foundImage || !foundVisibleDrawing) {
              const ops = await page.getOperatorList()
              if (!foundImage && hasImageOperator(ops.fnArray)) foundImage = true
              if (!foundVisibleDrawing && hasVisibleDrawingOperator(ops.fnArray)) {
                foundVisibleDrawing = true
              }
            }
          } finally {
            page.cleanup()
          }
        }
      } catch (e) {
        console.error(`[isScannedPDF] thread ${threadId} failed:`, e)
      } finally {
        pdf?.destroy()
        docWorker.destroy()
      }
    }

    await Promise.all(Array.from({ length: SCAN_THREADS }, (_, i) => scan(i)))
    return foundText ? false : foundImage || foundVisibleDrawing
  } finally {
    revokeUrl?.()
  }
}
