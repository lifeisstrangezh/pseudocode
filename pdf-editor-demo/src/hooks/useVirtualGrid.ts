import { computed, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/** 虚拟行数据：包含该行的 item 索引列表和行号 */
export interface VirtualRow {
  /** pages 数组中本行各 item 的索引 */
  items: number[]
  /** 行号（从 0 开始） */
  rowIndex: number
  /** 本行在滚动区内的绝对起始 Y（px），变高列表绝对定位用 */
  start: number
  /** 本行高度（px，不含行间距），变高列表绝对定位用 */
  size: number
}

/** 每项高度：定值（所有项等高）或按索引返回（变高，仅单列 list 模式有意义） */
type ItemHeight = number | ((index: number) => number)

/** 滚动对齐方式 */
type ScrollAlign = 'auto' | 'start' | 'center' | 'end'

/** useVirtualGrid 配置项 */
interface UseVirtualGridOptions {
  /** 滚动容器元素引用 */
  scrollRef: Ref<HTMLElement | null>
  /** 总项数（响应式） */
  totalItems: Ref<number>
  /** 每行列数（响应式，通常由 useGridLayout 提供） */
  columns: Ref<number>
  /** 每个网格项的高度（px）：传函数即开启变高（list 模式逐页精确高） */
  itemHeight: ItemHeight
  /** 垂直间距（px） */
  gapY: number
  /** 列表顶部留白（px）：仅变高 list 生效，使首项与容器顶部留出间隙；默认 0 贴顶 */
  paddingStart?: number
  /** 视口外预渲染的行数，默认 2 */
  overscan?: number
}

/** useVirtualGrid 返回值 */
interface UseVirtualGridReturn {
  /** 可见行列表，每行包含该行的 item 索引数组、行号、绝对起始 Y 与高度 */
  visibleRows: Ref<VirtualRow[]>
  /** 滚动区域总高度（px） */
  totalScrollHeight: Ref<number>
  /** 触发虚拟化器重新测量（itemHeight 为函数且其依赖变化后需手动调用） */
  refresh: () => void
  /** 滚动到指定项（list 模式 index 即页索引） */
  scrollToIndex: (index: number, opts?: { align?: ScrollAlign; behavior?: ScrollBehavior }) => void
  /** 滚动到指定像素偏移 */
  scrollToOffset: (
    offset: number,
    opts?: { align?: ScrollAlign; behavior?: ScrollBehavior }
  ) => void
}

/**
 * 基于 @tanstack/vue-virtual 的虚拟网格 Hook
 *
 * 按行虚拟化——每个虚拟 item 代表一行。返回可见行的行号列表，
 * 调用方负责按行渲染，CSS flex 负责行内 item 布局和居中对齐。
 *
 * itemHeight 传数字时为等高模式（grid / 定高 list，与旧行为完全一致）；
 * 传函数时为变高模式（仅单列 list 有意义），estimateSize 逐行取精确高，配合
 * VirtualRow.start 做绝对定位，像素精确、零测量回流。
 */
export function useVirtualGrid(options: UseVirtualGridOptions): UseVirtualGridReturn {
  const {
    scrollRef,
    totalItems,
    columns,
    itemHeight,
    gapY,
    paddingStart = 0,
    overscan = 2
  } = options

  /** 取第 index 行（等高模式下与行号无关）的高度 */
  const sizeFor = (index: number) =>
    typeof itemHeight === 'function' ? itemHeight(index) : itemHeight

  // 总行数 = 总项数 / 列数 向上取整
  const totalRows = computed(() => Math.ceil(totalItems.value / columns.value))

  const rowVirtualizer = useVirtualizer(
    computed(() => ({
      count: totalRows.value,
      getScrollElement: () => scrollRef.value,
      estimateSize: (index: number) => sizeFor(index) + gapY,
      // 仅变高 list 应用顶部留白；等高 grid/list 恒为 0，旧调用方零影响
      paddingStart: typeof itemHeight === 'function' ? paddingStart : 0,
      overscan,
      getItemKey: (index: number) => `row-${columns.value}-${index}`
    }))
  )

  /** 可见行列表：每行携带该行内的 item 索引数组及绝对定位信息 */
  const visibleRows = computed<VirtualRow[]>(() => {
    const cols = columns.value
    const total = totalItems.value
    return rowVirtualizer.value.getVirtualItems().map((vRow) => {
      const start = vRow.index * cols
      const end = Math.min(start + cols, total)
      const items: number[] = []
      for (let i = start; i < end; i++) items.push(i)
      // size 扣除行间距，得到内容真实高度
      return { items, rowIndex: vRow.index, start: vRow.start, size: vRow.size - gapY }
    })
  })

  /** 滚动区域总高度 */
  const totalScrollHeight = computed(() => rowVirtualizer.value.getTotalSize())

  /** 触发重新测量 */
  const refresh = () => rowVirtualizer.value.measure()

  const scrollToIndex: UseVirtualGridReturn['scrollToIndex'] = (index, opts) =>
    rowVirtualizer.value.scrollToIndex(index, opts)

  const scrollToOffset: UseVirtualGridReturn['scrollToOffset'] = (offset, opts) =>
    rowVirtualizer.value.scrollToOffset(offset, opts)

  return { visibleRows, totalScrollHeight, refresh, scrollToIndex, scrollToOffset }
}
