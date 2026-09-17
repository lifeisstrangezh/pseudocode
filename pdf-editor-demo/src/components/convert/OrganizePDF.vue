<template>
  <DragVirtualGrid
    ref="dvgRef"
    v-model="flatPages"
    :item-width="197"
    :item-height="226"
    :gap-x="24"
    :gap-y="24"
    key-field="uid"
    class="organize-pdf-dvg"
    @onEnd="testEnd"
  >
    <template #default="{ item, index, dragUid }">
      <!-- TODO -->
    </template>
  </DragVirtualGrid>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import DragVirtualGrid from '@/components/common/DragVirtualGrid.vue'
import { usePdfThumbnails } from '@/hooks/usePdfThumbnails'

/**
 * 缩略图：进入可见区 → 主线程空闲调度渲染；离开 → 取消在途；卸载 → 自动回收。
 * thumbs[uid] 即缓存（objectURL），onSize 把 PDF 真实尺寸写回页面对象（供空白页定向）。
 */
const { thumbs, registerDoc, releaseDoc, release, measure } = usePdfThumbnails({
  getVisibleKeys: () => visibleUids.value,
  resolve: (uid) => {
    const page = flatPages.value.find((p) => p.uid === uid)
    if (!page || page.isBlank) return null
    return {
      docId: page.fileId,
      page: page.originalIndex + 1,
      scale: 0.3
    }
  },
  onSize: (uid, { width, height }) => {
    const page = flatPages.value.find((p) => p.uid === uid)
    if (page) {
      page.width = width
      page.height = height
    }
  }
})

</script>