import { Buffer } from 'buffer';
import { createHexRandomString } from './voice-conversion';
import VoicePlayer from './voice-player';

class BaseTextConversion {
  constructor({ wsData }) {
    const { url = '', appKey, params } = wsData;
    this.config = { url, appkey: appKey, params };
    this.fileId = new Date().getTime();
    return this;
  }
  initWebScoket() {
    const webSoket = (this.webSoket = new WebSocket(this.config.url));
    webSoket.binaryType = 'arraybuffer';
    webSoket.onclose = e => {
      this.onclose(e);
    };
    webSoket.onerror = (e) => {
      this.onerror(e);
    };
    return webSoket;
  }
  onclose() {
    this.wsClosed = true;
    this.webSoket = null;
    this.recordError('socketClose');
  }
  onerror(e) {
    this.webSoket.close();
    this.webSoket = null;
    this.recordError('socketError', e);
  }
}

export class AliTextConversionAdapter extends BaseTextConversion {
  constructor({ wsData, recordStart, recordEnd, recordError, playingCallback, disablePlayback }) {
    super({ wsData });
    this.config.namespace = 'FlowingSpeechSynthesizer';
    this.config.idLength = 32;
    this.isSynthesisStarted = false;
    this.task_id = createHexRandomString(this.config.idLength);
    this.recordError = recordError;
    this.recordStart = recordStart;
    this.recordEnd = recordEnd || (() => {});
    this.voicePlayer = new VoicePlayer({ sampleRate: 16000, playingCallback, disablePlayback });
    this.audioData = [];
  }
  onmessage(event) {
    if (event.data instanceof ArrayBuffer) {
      const int16Array = new Int16Array(event.data);
      this.audioData.push(Buffer.from(int16Array.buffer));

      this.voicePlayer.pushPCM(event.data);
      return;
    }
    const data = (event.data && JSON.parse(event.data)) || {};
    const { header } = data;
    // 转换状态开始
    if (header.name === 'SynthesisStarted' && header.status === 20000000) {
      this.isSynthesisStarted = true;
      this.recordStart(); // 转换开始
      return;
    }
    // 转换结束
    if (header.name === 'SynthesisCompleted' && header.status === 20000000) {
      this.webSoket.close(); // 关闭 WebSocket 连接
      this.webSoket = null;
      this.isSynthesisStarted = false;
      this.recordEnd({ audioData: this.audioData }); // 转换结束
      return;
    }
    // 转换失败
    if (header.name === 'TaskFailed') {
      this.webSoket.close(); // 关闭 WebSocket 连接
      this.webSoket = null;
      this.isSynthesisStarted = false;
      this.recordError(); // recordError
      return;
    }
  }
  sendRunSynthesis(text) {
    if (!this.isSynthesisStarted || !this.webSoket) {
      return;
    }
    const data = this.buildSendConfig(text);
    this.webSoket.send(JSON.stringify(data));
  }
  startTranscription() {
    const webSoket = this.initWebScoket();
    webSoket.onmessage = event => {
      this.onmessage(event);
    };
    webSoket.onopen = () => {
      if (this.webSoket.readyState !== 1) return;
      const params = this.buildStartConfig();
      webSoket.send(JSON.stringify(params));
    };
  }
  stopTranscription() {
    if (!this.isSynthesisStarted || !this.webSoket) {
      return;
    }
    const data = this.buildStopConfig();
    this.webSoket.send(JSON.stringify(data));
  }
  buildStartConfig() {
    const { idLength, namespace, appkey, params } = this.config;
    return {
      header: {
        message_id: createHexRandomString(idLength),
        task_id: this.task_id,
        namespace: namespace,
        name: 'StartSynthesis',
        appkey,
      },
      payload: {
        voice: 'zhishuo', // 选择音色
        format: 'PCM', // 文件格式
        sample_rate: 16000, // 采样率
        volume: 100, // 音量
        speech_rate: 0, // 语速
        pitch_rate: 0, // 音调
        enable_subtitle: true, // 是否启用字幕
        platform: 'javascript',
        ...(params || {})
      }
    };
  }
  buildSendConfig(text) {
    const { idLength, namespace, appkey } = this.config;
    return {
      header: {
        message_id: createHexRandomString(idLength),
        task_id: this.task_id,
        namespace: namespace,
        name: 'RunSynthesis',
        appkey: appkey
      },
      payload: {
        text
      }
    };
  }
  buildStopConfig() {
    const { idLength, namespace, appkey } = this.config;
    const params = {
      header: {
        message_id: createHexRandomString(idLength),
        task_id: this.task_id,
        namespace: namespace,
        name: 'StopSynthesis',
        appkey: appkey
      }
    };
    return params;
  }
  cancelTranscription() {
    const params = this.buildStopConfig();
    try {
      this.webSoket.send(JSON.stringify(params));
      this.webSoket.close();
    } catch (error) {
      
    }
  }
}

export default function textConversion(options) {
  const instance = new AliTextConversionAdapter(options);
  return instance;
}