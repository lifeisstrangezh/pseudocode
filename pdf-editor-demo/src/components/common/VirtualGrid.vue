<template>
  <div
    ref="scrollRef"
    class="scrollbar virtual-grid"
    :class="{
      'virtual-grid--list': layout === 'list',
      'virtual-grid--grid': layout === 'grid',
      'hide-scrollbar': !showScrollbar
    }"
  >
    <!-- 撑开滚动高度的占位层 -->
    <div class="virtual-grid__spacer" :style="{ height: totalScrollHeight + 'px' }">
      <!-- 变高 list：逐行绝对定位（item-height 传函数时启用） -->
      <template v-if="isVariableList">
        <div
          v-for="row in visibleRows"
          :key="items[row.items[0]]?.[keyField] ?? row.rowIndex"
          class="virtual-grid__row-abs"
          :style="{ transform: `translateY(${row.start}px)`, height: row.size + 'px' }"
        >
          <slot :item="items[row.items[0]]" :index="row.items[0]" />
        </div>
      </template>
      <!-- 等高 grid / list：保持原 paddingTop + flex 布局，旧调用方零影响 -->
      <div v-else ref="contentRef" class="virtual-grid__content" :style="contentStyle">
        <div
          v-for="itemIdx in flatVisibleIndices"
          :key="items[itemIdx]?.[keyField] ?? itemIdx"
          class="virtual-grid__cell"
          :style="cellStyle"
        >
          <slot :item="items[itemIdx]" :index="itemIdx" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import { useGridLayout } from '@/hooks/useGridLayout'
import { useVirtualGrid } from '@/hooks/useVirtualGrid'

const props = withDefaults(
  defineProps<{
    /** 数据数组 */
    items: any[]
    /** 布局模式：grid 多列网格 / list 单列列表 */
    layout?: 'grid' | 'list'
    /** 每格宽度px（仅 grid 模式生效） */
    itemWidth?: number
    /** 每格高度px：传数字为等高；传 (index)=>number 开启变高（仅 list 模式生效） */
    itemHeight?: number | ((index: number) => number)
    /** 水平间距px（仅 grid 模式生效） */
    gapX?: number
    /** 垂直间距px（两种模式都生效） */
    gapY?: number
    /** 列表顶部留白px（仅变高 list 生效）：让首项与容器顶部留出间隙；默认 0 贴顶 */
    paddingTop?: number
    /** 唯一键字段名，fallback 到 index */
    keyField?: string
    /** 视口外预渲染行数 */
    overscan?: number
    /** 是否显示原生滚动条 */
    showScrollbar?: boolean
    /** 最小列数（仅 grid 模式生效） */
    minColumns?: number
  }>(),
  {
    layout: 'grid',
    itemWidth: 197,
    itemHeight: 226,
    gapX: 24,
    gapY: 24,
    paddingTop: 0,
    keyField: 'uid',
    overscan: 2,
    showScrollbar: true,
    minColumns: 1
  }
)

// 容器引用
const scrollRef = ref<HTMLElement | null>(null) // 滚动容器
const contentRef = ref<HTMLElement | null>(null) // 内容容器（用于 ResizeObserver，仅等高模式）

/** 变高 list：每页精确高度 + 绝对定位（grid / 定高 list 仍走原路径） */
const isVariableList = computed(
  () => props.layout === 'list' && typeof props.itemHeight === 'function'
)

// useGridLayout 仅用数字高度估算，变高时退化为 0 不影响列数计算
const gridLayoutHeight = computed(() =>
  typeof props.itemHeight === 'number' ? props.itemHeight : 0
)

// 响应式列数：list 模式强制 1 列，grid 模式走 useGridLayout 动态计算
const { columns: gridColumns } = useGridLayout({
  containerRef: contentRef,
  itemWidth: toRef(props, 'itemWidth'),
  itemHeight: gridLayoutHeight,
  gapX: toRef(props, 'gapX'),
  gapY: toRef(props, 'gapY'),
  minColumns: props.minColumns
})

const columns = computed(() => (props.layout === 'list' ? 1 : gridColumns.value))

// 虚拟滚动
const totalItems = computed(() => props.items.length)
const { visibleRows, totalScrollHeight, refresh, scrollToIndex, scrollToOffset } = useVirtualGrid({
  scrollRef,
  totalItems,
  columns,
  itemHeight: props.itemHeight,
  gapY: props.gapY,
  paddingStart: props.paddingTop,
  overscan: props.overscan
})

/** 当前可见的所有 item 的原始索引（扁平数组） */
const flatVisibleIndices = computed(() => visibleRows.value.flatMap((row) => row.items))

/** 首个可见行的 Y 偏移，作为 paddingTop 实现虚拟滚动（仅等高模式） */
const paddingTop = computed(() => {
  const first = visibleRows.value[0]
  const fixedHeight = typeof props.itemHeight === 'number' ? props.itemHeight : 0
  return first ? first.rowIndex * (fixedHeight + props.gapY) : 0
})

/** 内容容器样式：paddingTop 偏移 + gap */
const contentStyle = computed(() => {
  const base = { paddingTop: paddingTop.value + 'px' }
  if (props.layout === 'list') {
    return {
      ...base,
      gap: `${props.gapY}px 0`
    }
  }
  return {
    ...base,
    gap: `${props.gapY}px ${props.gapX}px`
  }
})

/** 单元格样式：list 模式占满宽度，grid 模式固定宽度（仅等高模式） */
const cellStyle = computed(() => {
  const fixedHeight = typeof props.itemHeight === 'number' ? props.itemHeight : 0
  if (props.layout === 'list') {
    return {
      width: '100%',
      height: `${fixedHeight}px`
    }
  }
  return {
    width: `${props.itemWidth}px`,
    height: `${fixedHeight}px`
  }
})

defineExpose({
  scrollRef,
  refresh,
  columns,
  flatVisibleIndices,
  scrollToIndex,
  scrollToOffset
})
</script>

<style scoped lang="scss">
.virtual-grid {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
  ::-webkit-scrollbar {
    display: none;
  }
}

.virtual-grid__spacer {
  position: relative;
}

.virtual-grid__row-abs {
  position: absolute;
  left: 0;
  right: 0;
  width: 100%;
}

.virtual-grid__content {
  display: flex;

  // grid 模式：多行换行 + 水平居中
  .virtual-grid--grid & {
    flex-wrap: wrap;
    justify-content: center;
  }

  // list 模式：纵向排列
  .virtual-grid--list & {
    flex-direction: column;
  }
}

.virtual-grid__cell {
  flex-shrink: 0;
}
</style>
