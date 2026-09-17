<template>
  <div class="voice-status-wrapper" v-if="statusRes">
    <div :class="statusRes.className" class="voice-status-icon">
      <template v-if="status === LISTENING">
        <div class="ellipse" />
        <div class="ellipse" />
        <div class="ellipse" />
      </template>
    </div>
    <span class="status-text">{{ $t(statusRes.text) }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({
  status: {
    type: Number,
    default: 1
  }
});
// 1-正在听 2-说话或打断 3-您已静音
const [LISTENING, SPEAKING_INTERRUPT, MUTED] = [1, 2, 3];

const statusMap = Object.freeze({
  [LISTENING]: {
    text: '正在听',
    className: 'status-listening'
  },
  [SPEAKING_INTERRUPT]: {
    text: '说话或打断',
    className: 'status-speaking-interrupt'
  },
  [MUTED]: {
    text: '您已静音',
    className: 'status-muted'
  }
});

const statusRes = computed(() => {
  return statusMap[props.status];
});
</script>

<style lang="less" scoped>
.voice-status-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  .voice-status-icon {
    margin-bottom: 10px;
    min-height: 24px;
  }
  .status-text {
    font-size: 13px;
    color: #3c4448;
  }
}
.status-listening {
  display: flex;
  align-items: center;
  height: 23px;
  .ellipse {
    width: 12px;
    height: 15px;
    background-color: #727475;
    border-radius: 40px;
    animation: wave 1s infinite ease-in-out;
    &:first-child {
      animation-delay: -0.2s;
    }
    &:nth-child(2) {
      margin: 0 4px;
      animation-delay: -0.1s;
    }
    &:last-child {
      animation-delay: 0s;
    }
  }
}
/**正在听的波形动画 */
@keyframes wave {
  0%, 100% {
    height: 17px;
  }
  25% {
    height: 21px;
  }
  50% {
    height: 15px;
  }
  75% {
    height: 17px;
  }
}
.status-speaking-interrupt {
  background-color: #727475;
  width: 24px;
  height: 24px;
  border-radius: 6px;
}
</style>
