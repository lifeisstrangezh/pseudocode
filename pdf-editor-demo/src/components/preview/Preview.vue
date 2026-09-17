<!-- 文件预览页（共享 controller + Worker 池渲染 + 变高虚拟列表） -->
<template>
  <div class="pdf-preview" ref="previewRef" @wheel="handleWheel">
    <VirtualGrid
      v-if="numPages > 0 && scale > 0"
      ref="virtualGridRef"
      layout="list"
      :items="pages"
      :item-height="pageHeightFn"
      :gap-y="baseMargin"
      :padding-top="topGap"
      :overscan="2"
      :show-scrollbar="true"
      @scroll="onGridScroll"
    >
      <template #default="{ index }">
        <!-- TODO -->
      </template>
    </VirtualGrid>
  </div>
</template>

<script lang="ts" setup>
import VirtualGrid from '@/components/common/VirtualGrid.vue'
import { scheduleIdleTask, cancelIdleTask, throttle } from '@/utils/tools'
import type { PDFManage } from '@/utils/pdfRender'
import type { PdfViewController } from '@/utils/pdfWorker/PdfViewController'

interface Props {
  /** 共享控制器（由 View 创建并 markRaw，左右两侧复用同一实例） */
  controller: PdfViewController
  info: FileObj
  password?: string
  showDes?: boolean // 是否显示描述信息
  isCatalog?: boolean // 是否为目录（缩略图）
  topGap?: number // 列表顶部留白px（首项与容器顶部的间隙），默认 12，传 0 贴顶
}
const props = withDefaults(defineProps<Props>(), {
  topGap: 12
})


const previewRef = ref<HTMLElement>()
const virtualGridRef = ref<InstanceType<typeof VirtualGrid>>()
/* ============================ 渲染调度 ============================ */

/** 当前可见页码集合（由 VirtualGrid 暴露的可见索引推导，随滚动同步重算） */
const visiblePageNums = computed(() => {
  const indices = virtualGridRef.value?.flatVisibleIndices as number[] | undefined
  const set = new Set<number>()
  if (indices) for (const i of indices) set.add(i + 1)
  return set
})

/** 进行中的空闲任务：page → idleTaskId */
const pendingTasks = new Map<number, number>()

/** 把位图绘到对应页 canvas（缩放已变则丢弃旧档） */
const draw = (page: number, atScale: number, bitmap: ImageBitmap) => {
  if (atScale !== scale.value) return
  const root = virtualGridRef.value?.scrollRef as HTMLElement | undefined
  const canvas = root?.querySelector(`canvas[data-page="${page}"]`) as HTMLCanvasElement | null
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
}

/** 调度单页渲染：命中缓存立即重绘；否则空闲入队，触发时复检仍可见再请求 */
const scheduleRender = (page: number) => {
  const atScale = scale.value
  const cached = props.controller.peekBitmap(page, atScale)
  if (cached) {
    nextTick(() => draw(page, atScale, cached))
    return
  }
  if (pendingTasks.has(page)) return
  const idleId = scheduleIdleTask(() => {
    pendingTasks.delete(page)
    // 关键：触发时复检仍可见，修复 v-visible「延迟回调不复检」导致的渲染错页
    if (!visiblePageNums.value.has(page)) return
    props.controller
      .requestBitmap(page, atScale)
      .then((bm) => draw(page, atScale, bm))
      .catch(() => {
        /* 取消/失败静默忽略 */
      })
  })
  pendingTasks.set(page, idleId)
}

/** 离场取消：清空闲任务 + 中止 worker 在途渲染 */
const cancelRender = (page: number, atScale = scale.value) => {
  const id = pendingTasks.get(page)
  if (id !== undefined) {
    cancelIdleTask(id)
    pendingTasks.delete(page)
  }
  props.controller.cancelBitmap(page, atScale)
}

/** 渲染当前所有可见页 */
const renderVisibleNow = () => {
  for (const p of visiblePageNums.value) scheduleRender(p)
}

// 可见集变化：进入 → 调度；离开 → 取消（真正中止在途，修复快速滚动错页）
watch(visiblePageNums, (now, old) => {
  for (const p of now) if (!old.has(p)) scheduleRender(p)
  for (const p of old) if (!now.has(p)) cancelRender(p)
})

/* ============================ 滚动 / 定位 ============================ */


/** 定位至指定页（page 从 1 开始）。catalog 居中、main 顶对齐偏移；跳转用 auto 即跳即渲 */
const positioningPage = (page: number, offsetY?: number) => {
  virtualGridRef.value?.scrollToOffset(Math.max(0, top), { behavior: 'auto' })
}
/* ============================ 生命周期 ============================ */

const gotoCurrentPage = () => {
  const positon = 0 // TODO 具体位置
  virtualGridRef.value?.scrollToIndex(positon, { align: 'start', behavior: 'auto' })
}

onUnmounted(() => {
  // 仅清理本实例的待执行/在途任务，不销毁共享 controller（View 持有）
  for (const [page, id] of pendingTasks) {
    cancelIdleTask(id)
    props.controller.cancelBitmap(page, scale.value)
  }
  pendingTasks.clear()
})

</script>