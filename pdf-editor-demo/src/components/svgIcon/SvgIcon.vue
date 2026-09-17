<template>
  <svg
    class="icon"
    aria-hidden="true"
    :style="{
      width: size ? size : 'auto',
      height: size ? size : 'auto'
    }"
  >
    <use :xlink:href="iconName" :color="color" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
interface Props {
  name: string
  color?: string
  size?: string
}
const props = withDefaults(defineProps<Props>(), {
  name: '',
  color: '',
  size: '24px'
})

const iconName = computed(() => `#icon-${props.name}`)
</script>

<style scoped lang="scss">
.c-icon {
  position: relative;
  // @include icon-color-custom('icon-level2-color');
}
</style>
