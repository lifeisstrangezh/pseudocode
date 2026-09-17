<template>
  <VirtualGrid
    ref="virtualGridRef"
    :items="splitList"
    layout="grid"
    :item-width="itemWidth"
    :item-height="itemHeight"
    :gap-x="16"
    :gap-y="16"
    key-field="id"
    class="split-content scrollbar"
    :key="store.splitInfo.splitMode"
  >
    <template #default="{ item, index }">
      <!-- 其他内容 -->
    </template>
  </VirtualGrid>
</template>

<script lang="ts" setup>
import { computed, ref, shallowRef, watch } from 'vue'
import VirtualGrid from '@/components/common/VirtualGrid.vue'
import { useKeyboard } from '@/hooks/useKeyboard'
import { usePdfThumbnails } from '@/hooks/usePdfThumbnails'

/**
 * 缩略图：进入可见区 → 主线程空闲调度渲染；离开 → 取消在途；卸载 → 自动回收。
 * thumbs[key] 即缓存的 objectURL，直接绑 <img :src>。
 */
const { thumbs, registerDoc } = usePdfThumbnails({
  getVisibleKeys: () => visiblePageNums.value,
  resolve: (key) => {
    const pageNum = Number(key)
    if (!Number.isFinite(pageNum)) return null
    return {
      docId: SPLIT_DOC_ID,
      page: pageNum,
      scale: 0.3
    }
  }
})


const { isPressed } = useKeyboard({ target: virtualGridRef.value })
const shiftHeld = isPressed('Shift')
</script>