<template>
  <div class="deepseek-network-btn" v-if="btnList.length">
    <div
      :class="{
        btn: true,
        active: active.includes(item.key)
      }"
      @click="deepNetClick(item.key)"
      v-for="item in btnList"
      :key="item.key"
    >
      <icon :class="item.icon" />
      <span>{{ item.name }}</span>
    </div>
  </div>
</template>

<script>
const CALL_PHONE = 'callPhone';

export default {
  name: 'DeepseekNetworkBtn',
  data() {
    return {
      active: [],
    };
  },
  props: {
    chatList: {
      type: Array,
      default: () => []
    },
  },
  computed: {
    btnList() {
      return [
        {
          name: '深度思考',
          show: this.isShowDeepseek,
          icon: 'icon-com-pingtaizhengtiyunying',
          key: 'enableThinking'
        },
        {
          name: '语音通话',
          show: this.isShowPhone,
          icon: 'icon-com-phone',
          key: CALL_PHONE
        }
      ].filter(item => item.show);
    },
    // 当在任务助手时，任务助手除了首轮问答都可以展示
    isShowDeepseek() {
      let result = true;
      if (ChatType.TASK_ASSISTANT === this.chatType && !this.chatList.length) {
        result = false;
      }
      return result;
    },
    isShowPhone() {
      // 展示AI语言通话满足条件：是APP、且是AI助手、且云中心开启了语音合成
      return !__Wechat__ && this.webSearchStatusObj.voiceSynthesizeStatus === 1;
    },
  },
  methods: {
    deepNetClick(type) {
      if (type === CALL_PHONE) {
        this.$emit(CALL_PHONE);
        return;
      }
      const index = this.active.indexOf(type);
      if (index > -1) {
        this.active.splice(index, 1);
      } else {
        this.active.push(type);
      }
      this.$emit('deepNetClick', { type, val: !(index > -1) });
    },
    reset() {
      this.active = [];
    }
  }
};
</script>