<!-- 文件预览页：共享 PdfViewController + Worker 池渲染 + 变高虚拟列表 -->
<template>
  <div
    class="view"
    v-loading="isPrintLoading"
    :element-loading-text="$t('common.loading')"
    :element-loading-spinner="getLoadingIcon"
  >
    <div class="view-main" v-if="currentFile && controller" v-show="isLoaded">
      <div
        class="view-main-catalog"
        v-show="catalogVisible"
        :style="{
          width: catalogWidth + 'px'
        }"
      >
        <div class="view-main-catalog-conten" v-show="catalogType === 'thumbnail'">
          <Preview
            ref="catalogRef"
            :controller="controller"
            :info="currentFile"
            :password="currentFilePaw"
            :is-catalog="true"
            :show-file="currentFile.fileId"
            @page-click="handlePageClick"
          />
        </div>
        <div class="view-main-catalog-conten" v-show="catalogType === 'outline'">
          <Outline ref="outlineRef" :outline="outlineData" :onJumpPage="handlePageClick" />
        </div>
        <div class="view-main-catalog-resizer" @mousedown="startResize"></div>
      </div>
      <div
        class="view-main-middle"
        ref="previewEl"
      >
        <Preview
          ref="previewRef"
          :controller="controller"
          :info="currentFile"
          :wheel-zoom="true"
          :is-catalog="false"
          :zoom-operate="zoomOperateRef"
          :page-operate="pageOperateRef"
          @page-scroll="handlePageScroll"
          @loading-complete="loadingComplete"
        />
        <div class="operate-wrapper" v-if="isLoaded">
          <div class="operate-wrapper-page" ref="pageOperateRef"></div>
          <div class="operate-wrapper-line"></div>
          <div class="operate-wrapper-zoom" ref="zoomOperateRef"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router'
import { ref, computed, onUnmounted, watch, nextTick, markRaw, shallowRef } from 'vue'
import Preview, { type PreviewType } from '@/components/preview/Preview.vue'
import Outline, { type OutlineType } from '@/components/preview/Outline.vue'
import { PdfViewController } from '@/utils/pdfWorker/PdfViewController'

// 共享控制器（非响应式，markRaw）：左右两侧 Preview 复用同一实例
const controller = shallowRef<PdfViewController | null>(null)


/** 创建共享控制器并解析（替代原 getPDFInfo 的第 3 次解析） */
const createController = async (password?: string) => {
  controller.value?.destroy()
  const instance = markRaw(new PdfViewController({ url, password }))
  controller.value = instance
  await instance.init()
  outlineData.value = instance.outline
  return instance
}

onMounted(() => {
  createController()
})

onUnmounted(() => {
  controller.value?.destroy()
  controller.value = null
  currentFile.value = null
})
</script>
