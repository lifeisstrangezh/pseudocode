<template>
  <div class="voice-call-page">
    <div class="vc-container" :class="{ 'vc-record-container': shouldShowChatRecord }">
      <!-- 小知动画头像 -->
      <div class="vc-portrait" />
      <!-- 聊天文字记录容器 -->
      <div ref="scrollContainerRef" class="chat-record-container" v-show="shouldShowChatRecord">
        <template v-if="voiceChatList.length">
          <div class="chat-msg" v-for="(item, index) in voiceChatList" :key="index">
            <div class="user-question" v-if="item.role === 'user'">
              <chat-text :msg="item.contentHtml || item.content" />
            </div>
            <div class="assistant-answer" v-if="item.role === 'assistant'">
              <chat-text :msg="item.content" :chat-item="item" />
            </div>
          </div>
        </template>
        <span v-else class="voice-tip">{{ '暂无聊天记录' }}</span>
      </div>
    </div>
    <!-- 聊天状态：静音、正在听等 -->
    <div class="vc-status">
      <voice-status :status="callStatus" @click.native="handleStatusClick" />
    </div>
    <!-- 底部按钮组 -->
    <div class="vc-bottom">
      <ul class="btn-group">
        <li v-for="item in buttons" :key="item.key">
          <div :class="['icon-wrapper', item.className]" @click="handleControlClick(item.key)">
            <icon :class="item.icon" />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, nextTick, onBeforeUnmount, watch } from 'vue';
import voiceConversion from '@utils/voice-conversion';
import textConversion from '@utils/text-conversion';
import { debounce, throttle } from 'lodash-es';
import VoiceStatus from './status.vue';

// 1-正在听 2-说话或打断 3-您已静音
const [LISTENING, SPEAKING_INTERRUPT, MUTED] = [1, 2, 3];

const props = defineProps({
  chatList: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
});

const emit = defineEmits(['close', 'pauseChat']);

const isMicrophoneEnabled = ref(false); //  是否开启麦克风
const shouldShowChatRecord = ref(false); //  是否展示聊天记录
const scrollContainerRef = ref(null); // 滚动的容器
const callStatus = ref(LISTENING); // 通话状态 1-正在听 2-说话或打断 3-您已静音

const pendingTextContents = []; // 等待处理文字转语音的文字队列
let isTextServiceInitializing = false; // 文字转语音WebSocket-是否正在初始化
let sendTimer = null; // 定时器-麦克风关闭后2S后发问题给大模型

const ws = {
  wssData: null, // WebSocket 配置
  voiceToTextInstance: null, // 语音转文字-处理对象
  textToVoiceInstance: null, // 文字转语音-处理对象
  isTextToVoiceReady: false, // 文字转语音-初始化成功
};

// 底部按钮
const buttons = computed(() => {
  return [
    {
      key: 'microphone',
      icon: isMicrophoneEnabled.value ? 'icon-com-maikefeng-mianxing' : 'icon-com-maikefeng-guan',
      className: isMicrophoneEnabled.value ? '' : 'microphone-disabled'
    },
    {
      key: 'telephone',
      icon: 'icon-com-tonghua',
      className: 'telephone-active'
    },
    {
      key: 'chat-record',
      icon: shouldShowChatRecord.value ? 'icon-com-zimu-kai' : 'icon-com-zimu',
      className: shouldShowChatRecord.value ? 'chat-record-active' : ''
    }
  ];
});

// 通话聊天记录
const voiceChatList = computed(() => {
  // 只展示进入语音通话页面后的对话
  return props.chatList.filter((it, ix) => ix > initialChatIndex.value);
});

// 提交问题给大模型
const submitQuestion = (value) => {
  pendingTextContents.length = 0;
  if (value) {
    emit('toChat', {
      value,
      businessType: ChatType.ASSISTANT,
      needIntentionRecognition: true, // 让大模型固定走问答意图
      orderNo: orderNo.value || '',
    });
  }
  // 发送完一个问题，清空当前问题文案，避免下一个问题会带上历史问题
  if(ws.voiceToTextInstance) {
    ws.voiceToTextInstance.clearSentenceInfo();
  }
};

// 停止大模型回答吐字
const pauseChat = () => {
  try {
    if (!props.loading) return;
    emit('pauseChat');
  } catch(e) {
    return;
  }
};

// 获取语音转文字结果
const getVoiceResultText = () => {
  if (!ws.voiceToTextInstance) return '';
  const { sentenceInfo, resultText } = ws.voiceToTextInstance;
  if (!sentenceInfo) {
    return resultText || '';
  }
  const question = Object.values(sentenceInfo).reduce((acc, cur) => {
    return acc + (cur || '');
  }, '');
  return question || '';
};

// 关闭语音转文字WebSocket
const closeVoiceWebSocket = () => {
  try {
    ws.voiceToTextInstance.cancelTranscription();
    ws.voiceToTextInstance = null;
  } catch (e) {
    // 忽略异常错误
  }
};

// 关闭文字转语音WebSocket
const closeTextWebSocket = () => {
  try {
    ws.textToVoiceInstance.cancelTranscription();
  } catch (e) {
    // 忽略异常错误，继续关闭声音播报
  } finally {
    stopAnswerPlayback();
  }
};

// 关闭页面
const closePage = () => {
  emit('close');
};

// 滚动到底部
const scrollToBottom = throttle(() => {
  nextTick(() => {
    const el = scrollContainerRef.value;
    if (!el) return;
    // 使用平滑滚动效果
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth'
    });
  });
}, 200);

// 状态按钮点击事件
const handleStatusClick = () => {
  // 【说话或暂停】状态时，点击可取消大模型回答，进而停止语音播报
  if (callStatus.value === SPEAKING_INTERRUPT) {
    pauseChat();
  }
};

// 停止播放答案
const stopAnswerPlayback = () => {
  try {
    const { voicePlayer } = ws.textToVoiceInstance;
    voicePlayer.stopAudio();
    voicePlayer.reset();
    delete ws.textToVoiceInstance.voicePlayer;
  } catch (e) {
    return;
  }
};

const clearSendTimer = () => {
  clearTimeout(sendTimer);
  sendTimer = null;
};


// 打开麦克风
const openMicrophone = () => {
    // 打开麦克风时，正好处在即将关闭语音识别WebSocket的定时器事件内，则取消关闭语音识别WebSocket定时器
    if (ws.voiceToTextInstance && sendTimer) {
      clearSendTimer();
      callStatus.value = LISTENING;
      isMicrophoneEnabled.value = true;
      return;
    }
    initVoiceInstance();
};
// 关闭麦克风
const closeMicrophone = () => {
  // 使用场景：关闭麦克风后，是否手动发送语音转文字的内容给大模型，否则是recordSentenceEnd句子结束回调发
};

// 底部按钮点击事件
const handleControlClick = debounce((key) => {
  if (key === 'microphone') {
    if (isMicrophoneEnabled.value) {
      closeMicrophone();
    } else {
      openMicrophone();
    }
    return;
  }

  if (key === 'telephone') {
    closePage();
    return;
  }

  if (key === 'chat-record') {
    shouldShowChatRecord.value = !shouldShowChatRecord.value;
  }
}, 200);

// 获取 WebSocket 配置
const fetchWssConfig = async () => {
  // ws.wssData = { ... 配置 }  接口获取配置
  return ws.wssData;
};

// 初始化 语音转文字-WebSocket 对象
const initVoiceInstance = () => {
  return new Promise((resolve, reject) => {
    ws.voiceToTextInstance = voiceConversion({
      wsData: ws.wssData,
      cacheAudioData: false, // 不缓存PCM录音数据
      startPayload: {
        // 语音断句检测阈值, 代表没人说话2S才触发SentenceEnd（句子结束）事件
        max_sentence_silence: 2000,
        // 噪音参数阈值，参数范围：[-1,1]，取值越趋于+1，语音被判定为噪音的概率越大
        speech_noise_threshold: 1,
      },
      // 录音授权拒绝
      authRefuse: () => {
        // TODO 其他处理 授权拒绝
        reject();
      },
      // 录音开始
      recordStart: type => {
        if (type === 'nativeReady') {
          isMicrophoneEnabled.value = true;
          return;
        }
        if (type === 'WSReady') {
          callStatus.value = LISTENING;
          resolve();
          return;
        }
      },
      // 录音句子开始（代表有人在说话）
      recordSentenceBegin: () => {
        callStatus.value = LISTENING;
        // 停止大模型回复上一个问题
        pauseChat();
        // 停止上一个大模型答案播报
        closeTextWebSocket();
      },
      // 录音识别句子结束（代表一句话结束后有2S了）
      recordSentenceEnd: ({ resultText }) => {
        // 处于关闭麦克风后2S内，此时则由sendTimer内部来发问题
        if (sendTimer) return;
        submitQuestion(resultText);
        callStatus.value = SPEAKING_INTERRUPT;
        scrollToBottom();
      },
      // 录音错误
      recordError: ({ type }) => {
        // TODO 其他错误处理
        reject();
      },
    });
  });
};

// 初始化 文字转语音-WebSocket 对象
const initTextInstance = () => {
  return new Promise((resolve, reject) => {
    ws.textToVoiceInstance = textConversion({
      wsData: ws.wssData,
      recordStart: () => {
        ws.isTextToVoiceReady = true;
        resolve();
      },
      recordError: () => {
        ws.isTextToVoiceReady = false;
        reject();
      },
    });
    ws.textToVoiceInstance.startTranscription();
  });
};

const filterText = (text) => {
  // 转义HTML标签
  let content = decodeXSS(text);
  // 过滤HTML标签
  content = filters.filterHTMLTag(content);
  // 去除换行符，否则阿里无法识别会停止后续文字转语音；去掉-#等不需要播报的字符
  content = content.replace(/[\n*#-]/g, '');
  // 中文逗号替换为空格，解决句子很短时，阿里不返回逗号后的音频
  content = content.replace(/[，]/g, ' ');
  return content || '';
};

// 大模型回复后，吐字文案处理函数
const processTextContent = async (payload) => {
  const { finished, deltaText } = payload;
  const content = filterText(deltaText);
  textUsedTotal += content.length;
  // 滚动到底部
  scrollToBottom();
  if (finished) {
    ws.textToVoiceInstance.stopTranscription();
    trackSynthesisMetrics();
  }
  if (!content) return;

  // 如果已经初始化成功，直接发送内容
  if (ws.isTextToVoiceReady && ws.textToVoiceInstance) {
    ws.textToVoiceInstance.sendRunSynthesis(content);
    return;
  }
  
  // 添加到等待队列
  pendingTextContents.push(content);
  
  // 如果没有在初始化，开始初始化过程
  if (!isTextServiceInitializing) {
    isTextServiceInitializing = true;
    stopAnswerPlayback();
    try {
      await initTextInstance();
      // 初始化成功后，发送队列中所有内容
      const combinedContent = pendingTextContents.join('');
      if (combinedContent) {
        ws.textToVoiceInstance.sendRunSynthesis(combinedContent);
      }
      // 清空队列
      pendingTextContents.length = 0;
    } catch (error) {
      // 忽略异常错误
    } finally {
      isTextServiceInitializing = false;
    }
  }
};

/**
 * 获取语音识别用量毫秒
 */
const getVoiceUsedTotal = () => {
  if (voiceStartTime) {
    const duration = Date.now() - voiceStartTime;
    voiceUsedTotal += duration;
  }
  return voiceUsedTotal;
};

// 监听麦克风状态
watch(isMicrophoneEnabled, (newVal) => {
  if (newVal) {
    // 开启麦克风时记录开始时间
    voiceStartTime = Date.now();
  } else if (voiceStartTime !== null) {
    // 关闭麦克风时计算时长并累加
    getVoiceUsedTotal();
    voiceStartTime = null;
  }
});

const init = async () => {
  // 校验权限和用量-语音通话账号开关、服务用量，通过后再获取WebSocket配置
  await checkAccountAndUsage();
  // 1.获取WebSocket配置
  await fetchWssConfig();
  // 2.初始化语音转文字实例
  await initVoiceInstance();
  // 3.初始化文字转语音实例
  initTextInstance();
};

onMounted(() => {
  // 初始化当前chatList最大索引，用于过滤历史对话，只展示语音通话记录
  initialChatIndex.value = props.chatList.length - 1;
  init();
});

onBeforeUnmount(() => {
  clearSendTimer();
  closeVoiceWebSocket();
  closeTextWebSocket();
  pauseChat();
  pendingTextContents = [];
});

defineExpose({
  processTextContent,
});
</script>

<style lang="less" scoped>
.voice-call-page {
  height: 100%;
  background: #f4f4f4;
  display: flex;
  flex-direction: column;
}
.vc-container {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding-top: 46px;
  margin-bottom: 32px;
  overflow: hidden;
  .vc-portrait {
    width: 250px;
    height: 250px;
    background-size: 2750px 250px;
    background-image: url('~@/pages/ai/assets/images/xiaozhi-voice-call.png');
    background-repeat: no-repeat;
    animation: portraitLargeAnimation 3.2s steps(11, end) infinite;
    margin: 0 auto 32px;
  }
  &.vc-record-container {
    display: block;
    .vc-portrait {
      width: 120px;
      height: 120px;
      background-size: 1320px 120px;
      animation: portraitAnimation 3.2s steps(11, end) infinite;
    }
  }
}
.vc-status {
  flex-shrink: 0;
  margin-bottom: 32px;
}
.vc-bottom {
  flex-shrink: 0;
  padding-bottom: 44px;
}
.btn-group {
  display: flex;
  align-items: center;
  justify-content: space-around;
  li {
    border-radius: 50%;
  }
}
.icon-wrapper {
  width: 66px;
  height: 66px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #3c4448;
  border-radius: 50%;
  &.telephone-active {
    background: #f34131;
    color: #ffffff;
  }
  &.microphone-disabled {
    color: #f34131;
  }
  &.chat-record-active {
    color: #36c982;
  }
  .icon-com {
    font-size: 30px;
  }
}
.chat-record-container {
  height: calc(100% - 152px);
  overflow-y: auto;
  padding: 0 40px;
  .voice-tip {
    color: #B8B9BA;
  }
}
.user-question,
.assistant-answer {
  margin-bottom: 16px;
  ::v-deep .text * {
    color: #727475 !important;
    font-size: 15px !important;
    font-weight: 500 !important;
  }
}
.assistant-answer ::v-deep .text * {
  color: #3c4448 !important;
}
@keyframes portraitAnimation {
  0% {
    background-position: 0px;
  }
  37.5%  {
    background-position: -1320px;
  }
  37.51% {
    background-position: 0px;
  }
  100% {
    background-position: 0px;
  }
}
@keyframes portraitLargeAnimation {
  0% {
    background-position: 0px;
  }
  37.5%  {
    background-position: -2750px;
  }
  37.51% {
    background-position: 0px;
  }
  100% {
    background-position: 0px;
  }
}
</style>
