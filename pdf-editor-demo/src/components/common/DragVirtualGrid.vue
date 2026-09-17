<template>
  <div
    ref="scrollRef"
    class="scrollbar drag-virtual-grid"
    :class="{
      'is-dragging-active': dragUid !== null,
      'hide-scrollbar': !showScrollbar
    }"
  >
    <!-- 撑开滚动高度的占位层 -->
    <div :style="{ height: totalScrollHeight + 'px' }">
      <!-- 实际可见内容：flex-wrap 网格 + paddingTop 虚拟偏移 -->
      <div
        ref="dragRef"
        class="drag-virtual-grid__content"
        :style="{
          paddingTop: paddingTop + 'px',
          gap: gapY + 'px ' + gapX + 'px'
        }"
      >
        <div
          v-for="itemIdx in flatVisibleIndices"
          :key="items[itemIdx]?.[keyField] ?? itemIdx"
          class="drag-virtual-grid__cell"
          :data-uid="items[itemIdx]?.[keyField]"
          :style="{ width: itemWidth + 'px', height: itemHeight + 'px' }"
        >
          <slot :item="items[itemIdx]" :index="itemIdx" :drag-uid="dragUid" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDraggable } from 'vue-draggable-plus'
import { useGridLayout } from '@/hooks/useGridLayout'
import { useVirtualGrid } from '@/hooks/useVirtualGrid'

const props = withDefaults(
  defineProps<{
    itemWidth?: number
    itemHeight?: number
    gapX?: number
    gapY?: number
    keyField?: string
    overscan?: number
    showScrollbar?: boolean
  }>(),
  {
    /** 每个单元格宽度 */
    itemWidth: 197,
    /** 每个单元格高度 */
    itemHeight: 226,
    /** 单元格水平间距 */
    gapX: 24,
    /** 单元格垂直间距 */
    gapY: 24,
    /** 每个单元格的唯一标识字段 */
    keyField: 'uid',
    /** 预加载行数，影响性能 */
    overscan: 2,
    /** 是否显示滚动条 */
    showScrollbar: true
  }
)

const emit = defineEmits(['onEnd'])

const items = defineModel<any[]>({ required: true })

// 容器引用
const scrollRef = ref<HTMLElement | null>(null) // 滚动容器
const dragRef = ref<HTMLElement | null>(null) // flex-wrap 容器（拖拽区）

// 响应式列数
const { columns } = useGridLayout({
  containerRef: dragRef,
  itemWidth: props.itemWidth,
  itemHeight: props.itemHeight,
  gapX: props.gapX,
  gapY: props.gapY
})

// 虚拟滚动
const totalItems = computed(() => items.value.length)
const { visibleRows, totalScrollHeight } = useVirtualGrid({
  scrollRef,
  totalItems,
  columns,
  itemHeight: props.itemHeight,
  gapY: props.gapY,
  overscan: props.overscan
})

const flatVisibleIndices = computed(() => visibleRows.value.flatMap((row) => row.items))

/** 首行的 Y 偏移 = 行号 × 行高，作为 paddingTop 实现虚拟滚动 */
const paddingTop = computed(() => {
  const first = visibleRows.value[0]
  return first ? first.rowIndex * (props.itemHeight + props.gapY) : 0
})

// 拖拽排序
const dragUid = ref<string | number | null>(null)

// 不传 list → vue-draggable-plus 仅处理 DOM 拖拽动画，我们手动管理数组
// 避免虚拟滚动下 DOM 索引 ≠ 数据索引导致的数组污染
useDraggable(dragRef, {
  animation: 200,
  forceFallback: true,
  fallbackTolerance: 5, // 移动 5px 后才启动拖拽，单击不触发拖拽，避免吞 click 事件
  filter: 'button', // 显式排除所有 button 元素
  preventOnFilter: false, // 不阻止过滤元素上的默认行为
  ghostClass: 'dragging-ghost',
  onStart(evt) {
    // DOM 索引 → 数据索引（通过 flatVisibleIndices 映射）
    const dataIdx = flatVisibleIndices.value[evt.oldIndex!]
    const item = items.value[dataIdx] as Record<string, unknown> | undefined
    dragUid.value = (item?.[props.keyField] as string | number) ?? dataIdx
  },
  onEnd(evt) {
    // 已将被拖拽 DOM 元素移到新位置，通过邻居 data-uid 定位目标
    const draggedEl = evt.item as HTMLElement
    const nextEl = draggedEl.nextElementSibling as HTMLElement | null
    const prevEl = draggedEl.previousElementSibling as HTMLElement | null
    const nextUid = nextEl?.dataset.uid
    const prevUid = prevEl?.dataset.uid

    let targetIdx: number
    if (nextUid != null) {
      targetIdx = items.value.findIndex((item) => item[props.keyField] === nextUid)
    } else if (prevUid != null) {
      targetIdx = items.value.findIndex((item) => item[props.keyField] === prevUid) + 1
    } else {
      targetIdx = -1
    }

    if (targetIdx !== -1 && dragUid.value != null) {
      const currentIdx = items.value.findIndex((item) => item[props.keyField] === dragUid.value)
      if (currentIdx !== -1 && targetIdx !== currentIdx) {
        const [moved] = items.value.splice(currentIdx, 1)
        const adjTarget = currentIdx < targetIdx ? targetIdx - 1 : targetIdx
        items.value.splice(adjTarget, 0, moved)
        emit('onEnd')
      }
    }

    dragUid.value = null
  }
})

defineExpose({ flatVisibleIndices })
</script>

<style scoped lang="scss">
.drag-virtual-grid {
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
.drag-virtual-grid__content {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}
.drag-virtual-grid__cell {
  flex-shrink: 0;
}

:global(.dragging-ghost) {
  opacity: 0.4;
}

// 拖拽中隐藏所有卡片的 hover 操作按钮
:global(.is-dragging-active .page-hover-actions) {
  opacity: 0 !important;
  pointer-events: none !important;
}

// 拖拽镜像中的 hover 按钮（镜像在 body 下）
:global(.sortable-drag .page-hover-actions) {
  opacity: 0 !important;
  pointer-events: none !important;
}
</style>
