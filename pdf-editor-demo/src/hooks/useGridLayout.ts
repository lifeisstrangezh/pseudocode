import { ref, toRef, watch, onMounted, onUnmounted, type Ref, type MaybeRef } from 'vue'

/** useGridLayout 配置项 */
interface UseGridLayoutOptions {
  /** 要监听宽度变化的容器元素引用 */
  containerRef: Ref<HTMLElement | null>
  /** 每个网格项的宽度（px），默认 197，支持响应式 */
  itemWidth?: MaybeRef<number>
  /** 每个网格项的高度（px），默认 226，支持响应式 */
  itemHeight?: MaybeRef<number>
  /** 水平间距（px），默认 24，支持响应式 */
  gapX?: MaybeRef<number>
  /** 垂直间距（px），默认 24，支持响应式 */
  gapY?: MaybeRef<number>
  /** 最小列数，即使容器宽度不足也至少保留此列数，默认 1 */
  minColumns?: number
}

/** useGridLayout 返回值 */
interface UseGridLayoutReturn {
  /** 当前容器宽度下能容纳的列数（响应式） */
  columns: Ref<number>
  /** 容器内容区宽度（px），已扣除滚动条宽度（响应式） */
  containerWidth: Ref<number>
  /** 每个网格项的宽度（px） */
  itemWidth: number
  /** 每个网格项的高度（px） */
  itemHeight: number
  /** 水平间距（px） */
  gapX: number
  /** 垂直间距（px） */
  gapY: number
}

/**
 * 通用的响应式网格列数计算 Hook
 *
 * 基于 ResizeObserver 监听容器宽度变化，实时计算出每行能容纳的列数。
 * 计算公式：(containerWidth + gapX) / (itemWidth + gapX) 向下取整，
 * 即满足 `N * itemWidth + (N-1) * gapX <= containerWidth` 的最大 N。
 *
 * 适用于需要根据容器宽度自动调整布局列数的虚拟网格、瀑布流等场景。
 */
export function useGridLayout(options: UseGridLayoutOptions): UseGridLayoutReturn {
  const {
    containerRef,
    itemWidth = 197,
    itemHeight = 226,
    gapX = 24,
    gapY = 24,
    minColumns = 1
  } = options

  // 转为响应式引用，支持外部传入 computed ref 实现动态切换
  const resolvedItemWidth = toRef(itemWidth)
  const resolvedItemHeight = toRef(itemHeight)
  const resolvedGapX = toRef(gapX)
  const resolvedGapY = toRef(gapY)

  const columns = ref(minColumns)
  const containerWidth = ref(0)

  let resizeObserver: ResizeObserver | null = null

  /** 根据容器宽度计算可容纳的列数 */
  const calculateColumns = (width: number) => {
    // 每列占用的水平空间 = itemWidth + gapX（最后一列不需要 gapX）
    // 所以 N 列需要的宽度 = N * itemWidth + (N-1) * gapX = N * (itemWidth + gapX) - gapX
    // 反过来 N = (width + gapX) / (itemWidth + gapX)
    const effectiveItemWidth = resolvedItemWidth.value + resolvedGapX.value
    const raw = Math.floor((width + resolvedGapX.value) / effectiveItemWidth)
    columns.value = Math.max(raw, minColumns)
  }

  onMounted(() => {
    if (!containerRef.value) return
    // 初始读取：使用 clientWidth，与 useVirtualGrid 内部保持一致的宽度来源
    containerWidth.value = containerRef.value.clientWidth
    calculateColumns(containerWidth.value)

    // 监听容器尺寸变化：使用 clientWidth 而非 contentBoxSize，
    // 确保与 useVirtualGrid 居中计算使用完全相同的宽度值
    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.value) return
      const width = containerRef.value.clientWidth
      containerWidth.value = width
      calculateColumns(width)
    })
    resizeObserver.observe(containerRef.value)
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })

  // 监听 itemWidth/gapX 响应式变化，重新计算列数
  // 例如 SplitPDF 在 234px ↔ 450px 间切换时需要此逻辑
  watch([resolvedItemWidth, resolvedGapX], () => {
    if (containerRef.value) {
      calculateColumns(containerRef.value.clientWidth)
    }
  })

  return {
    columns,
    containerWidth,
    itemWidth: resolvedItemWidth.value,
    itemHeight: resolvedItemHeight.value,
    gapX: resolvedGapX.value,
    gapY: resolvedGapY.value
  }
}
