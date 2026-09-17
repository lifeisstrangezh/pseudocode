import * as Env from 'commons/utils/env';
import { Buffer } from 'buffer';

const callHandler = (method, params) => {}; // 调用安卓/IOS/鸿蒙原生方法

export function createHexRandomString(length = 32) {
  const arr = 'abcde0123456789'.split('');
  let str = '';
  for (let i = 0; i < length; i++) {
    const index = Math.floor(Math.random() * arr.length);
    str += arr[index];
  }
  return str;
}

class MediaDeviceVoiceRecord {
  async checkRecordPermission() {
    return new Promise((resolve, reject) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject();
        return;
      };
      navigator.mediaDevices.getUserMedia({ audio: true }).then((audioStream) => {
        this.audioStream = audioStream;
        resolve(audioStream);
      }).catch((error) => {
        reject(error);
      });
    });
  };
  async startVoiceRecord({ successCb, errorCb }) {
    try {
      this.successCb = successCb;
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });

      // 动态注册 AudioWorklet处理器
      const workletBlob = new Blob([workletProcessorCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(workletBlob);
      await this.audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl); // 清理内存

      // 创建 recorderNode
      this.audioInput = this.audioContext.createMediaStreamSource(this.audioStream);
      this.recorderNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      // 接收处理后的音频数据
      this.recorderNode.port.onmessage = (event) => {
        successCb(event.data);
      };
      this.audioInput.connect(this.recorderNode);
      this.recorderNode.connect(this.audioContext.destination); // 保持输出连接避免静音优化;
    } catch (error) {
      errorCb(error);
    };
  }
  stopVoiceRecord() {
    if (this.recorderNode) {
      this.recorderNode.disconnect();
      this.recorderNode = null;
    }
    if (this.audioInput) {
      this.audioInput.disconnect();
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.successCb(new ArrayBuffer());
  }
}

class NativeVoiceRecord {
  checkRecordPermission() {
    return new Promise(async (resolve, reject) => {
      const params = {
        successCb: code => {
          // 允许录音权限 则resolve()  否则reject()
          resolve(); // 允许录音权限
        },
        errorCb: error => {
          console.log('权限错误回调', error);
          reject(error);
        }
      };
      callHandler('checkRecordPermission', params);
    });
  };
  startVoiceRecord({ fileId, successCb, errorCb }) {
    const params = {
      key: fileId,
      successCb: successCb,
      errorCb: errorCb,
    };
    callHandler('startRecord', params);
  }
  stopVoiceRecord() {
    callHandler('stopRecord');
  }
}

function getVoiceHandler(useMediaDevices) {
  if (useMediaDevices) {
    return new MediaDeviceVoiceRecord();
  }
  return new NativeVoiceRecord();
}


class BaseVoiceConversion {
  constructor({
    wsData,
    authRefuse,
    recordEnd,
    recordError,
    recordStart,
    useMediaDevices = false, // 是否使用MediaDevices录音
    cacheAudioData = true, // 是否本地缓存录音的PCM数据
  }) {
    this.fileId = new Date().getTime();
    this.pcmBuffer = [];
    this.audioData = [];
    const { url = '' } = wsData;
    Object.assign(this, { 
      url,
      authRefuse,
      recordEnd,
      recordError,
      recordStart,
      useMediaDevices,
      cacheAudioData
    });
    this.voiceHandler = getVoiceHandler(useMediaDevices);
    return this;
  }
  initWebScoket() {
    const webSoket = (this.webSoket = new WebSocket(this.url));
    webSoket.onclose = e => {
      this.onclose(e);
    };
    webSoket.onerror = (e) => {
      this.onerror(e);
    };
    return webSoket;
  }
  checkRecordPermission() {
    return this.voiceHandler.checkRecordPermission();
  }
  startVoiceRecord({ successCb }) {
    this.voiceHandler.startVoiceRecord({
      fileId: this.fileId,
      successCb: (frameBuffer) => {
        if (this.cacheAudioData) {
          this.audioData.push(Buffer.from(frameBuffer));
          if (!frameBuffer.byteLength) {
            // 时长 = (文件字节数 / 采样率) / (声道数 * 每个采样点的字节数)
            // this.audioDuration = parseInt((len * 8) / 16000 / 16);
            this.pcmBuffer = Buffer.concat(this.audioData);
          }
        }
        successCb(frameBuffer);
      },
      errorCb: (message) => {
        if (this.transcriptionCompleted) return;
        this.recordError({ type: 'nativeError' }, message);
        this.webSoket.close();
      }
    });
  }
  stopVoiceRecord() {
    this.voiceHandler.stopVoiceRecord();
  }
  onclose(e) {
    this.wsClosed = true;
  }
  onerror(e) {
    this.stopVoiceRecord();
    this.webSoket.close();
    this.recordError('socketError', e);
  }
}

export class AliVoiceConversionAdapter extends BaseVoiceConversion {
  constructor({
    authRefuse,
    recordEnd,
    recordError,
    recordStart,
    wsData,
    useMediaDevices,
    recordSentenceBegin, // 录音句子开始
    recordSentenceEnd, // 录音识别句子结束
    cacheAudioData = true, // 是否本地缓存录音的PCM数据
    startPayload = {}, // 阿里语音转文字指令StartTranscription额外参数
  }) {
    super({ authRefuse, recordEnd, recordError, recordStart, wsData, useMediaDevices, cacheAudioData });
    this.config = {
      idLength: 32,
      namespace: 'SpeechTranscriber',
      appkey: wsData.appKey
    };
    this.task_id = createHexRandomString(this.config.idLength);
    this.resultText = '';
    this.sentenceInfo = {};
    this.startPayload = startPayload;
    this.recordSentenceBegin = recordSentenceBegin;
    this.recordSentenceEnd = recordSentenceEnd;
  }
  onmessage(event) {
    const data = (event.data && JSON.parse(event.data)) || {};
    const { header, payload } = data;
    if (header.name === 'TranscriptionStarted') {
      this.startVoiceRecord({
        successCb: frameBuffer => {
          if (this.taskFailed) return;
          if (this.wsClosed) {
            this.recordError({ type: 'networkError' });
            this.taskFailed = true;
            this.stopVoiceRecord();
            return;
          }
          if (!frameBuffer.byteLength) {
            this.callRecordStop = true; // 调用已停止
            const params = this.buildStopConfig();
            this.webSoket.send(JSON.stringify(params));
            return;
          }
          if (this.callRecordStop) return;
          this.sendVoiceRecord(frameBuffer);
        }
      });
      return;
    }
    // 句子开始
    if (header.name === 'SentenceBegin') {
      const { index } = payload;
      this.sentenceInfo[index] = '';
      if (this.recordSentenceBegin) {
        this.recordSentenceBegin();
      }
      return;
    }
    // 句子变化
    if (header.name === 'TranscriptionResultChanged') {
      const { index, result } = payload;
      this.sentenceInfo[index] = result;
      return;
    }
    // 句子结束
    if (header.name === 'SentenceEnd') {
      const { index, result } = payload;
      this.sentenceInfo[index] = result;
      if (this.recordSentenceEnd) {
        const question = Object.values(this.sentenceInfo).reduce((all, item) => {
          return all + (item || '');
        }, '');
        this.recordSentenceEnd({ resultText: question });
      }
      return;
    }

    if (header.name === 'TranscriptionCompleted') {
      if (this.taskFailed) return;
      this.transcriptionCompleted = true;
      this.resultText = Object.values(this.sentenceInfo).reduce((all, item) => {
        item = item || '';
        return all + item;
      }, '');
      this.recordEnd({ pcmBuffer: this.pcmBuffer, resultText: this.resultText, fileId: this.fileId });
      return;
    }

    if (header.name === 'TaskFailed') {
      if (this.transcriptionCompleted) return;
      this.taskFailed = true;
      this.recordError({ type: 'actionError' });
      this.stopVoiceRecord();
      this.webSoket.close();
      return;
    }
  }
  sendVoiceRecord(frameBuffer) {
    this.webSoket.send(new Int8Array(frameBuffer));
  }
  startTranscription() {
    console.log('开始调用语音转换-阿里');
    this.checkRecordPermission()
      .then(() => {
        console.log('权限校验通过,开始创建websokect');
        this.recordStart('nativeReady');
        const webSoket = this.initWebScoket();
        console.log('webSoket成功', webSoket);
        webSoket.onmessage = event => {
          this.onmessage(event);
        };
        webSoket.onopen = () => {
          if (this.webSoket.readyState !== 1) return;
          this.recordStart('WSReady');
          const params = this.buildStartConfig();
          webSoket.send(JSON.stringify(params));
        };
      })
      .catch(() => {
        this.authRefuse();
      });
  }
  stopTranscription() {
    console.log('停止录音!!!');
    this.stopVoiceRecord();
  }
  buildStartConfig() {
    const { idLength, namespace, appkey } = this.config;
    return {
      header: {
        message_id: createHexRandomString(idLength),
        task_id: this.task_id,
        namespace: namespace,
        name: 'StartTranscription',
        appkey: appkey
      },
      payload: {
        format: 'pcm',
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        special_word_filter: true,
        enable_words: true,
        ...this.startPayload
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
        name: 'StopTranscription',
        appkey: appkey
      }
    };
    return params;
  }
  cancelTranscription() {
    this.taskFailed = true;
    const params = this.buildStopConfig();
    this.webSoket.send(JSON.stringify(params));
    this.webSoket.close();
    this.stopVoiceRecord();
  }
  clearSentenceInfo() {
    this.sentenceInfo = {};
  }
}

export class XunfeiVoiceConversionAdapter extends BaseVoiceConversion {
  constructor({
    authRefuse,
    recordEnd,
    recordError,
    recordStart,
    wsData,
    useMediaDevices,
    recordSentenceBegin, // 录音句子开始
    recordSentenceEnd, // 录音识别句子结束
    cacheAudioData = true, // 是否本地缓存录音的PCM数据
  }) {
    super({
      authRefuse,
      recordEnd,
      recordError,
      recordStart,
      wsData,
      useMediaDevices,
      recordSentenceBegin,
      recordSentenceEnd,
      cacheAudioData
    });
    this.resultText = '';
  }
  onmessage(event) {
    console.log('onmessage  eventeventevent', event);
    const data = JSON.parse(event.data);
    const { action } = data;
    if (action === 'started') return;
    if (action === 'result') {
      const result = JSON.parse(data.data);
      let resultTextTemp = '';
      result.cn.st.rt[0].ws.forEach(k => {
        resultTextTemp += k.cw[0].w;
      });

      // type: 0-最终结果；1-中间结果
      if (result.cn.st.type == 1 && resultTextTemp && this.recordSentenceBegin) {
        this.recordSentenceBegin();
      }
      if (result.cn.st.type == 0) {
        this.resultText += resultTextTemp;
        if (this.recordSentenceEnd) {
          this.recordSentenceEnd({ resultText: this.resultText });
        }
      }
      console.log('this.resultText', this.resultText);

      if (result.ls) {
        if (this.taskFailed) return;
        this.transcriptionCompleted = true;
        this.recordEnd({ pcmBuffer: this.pcmBuffer, resultText: this.resultText, fileId: this.fileId });
      }
      return;
    }
    if (action === 'error') {
      console.log('xunfei onmessage error!', data);
      this.taskFailed = true;
      if (this.transcriptionCompleted) return;
      this.recordError({ type: 'actionError' });
      this.stopVoiceRecord();
      this.webSoket.close();
      return;
    }
    console.log('讯飞识别--- 未知动作');
  }
  startTranscription() {
    console.log('开始调用语音转换-讯飞');
    this.checkRecordPermission()
      .then(() => {
        console.log('权限校验通过,开始创建websokect');
        this.recordStart('nativeReady');
        const webSoket = this.initWebScoket();
        console.log('webSoket成功', webSoket);
        webSoket.onmessage = event => {
          this.onmessage(event);
        };
        webSoket.onopen = () => {
          console.log('开始调用原生录音');
          this.recordStart('WSReady');
          this.startVoiceRecord({
            successCb: frameBuffer => {
              if (this.taskFailed) return;
              if (this.wsClosed) {
                this.recordError({ type: 'networkError' });
                this.taskFailed = true;
                this.stopVoiceRecord();
                return;
              }
              if (this.webSoket.readyState !== 1) return;
              if (!frameBuffer.byteLength) {
                this.webSoket.send('{"end": true}');
                return;
              }
              this.sendVoiceRecord(frameBuffer);
            }
          });
        };
      })
      .catch(() => {
        this.authRefuse();
      });
  }
  sendVoiceRecord(frameBuffer) {
    this.webSoket.send(new Int8Array(frameBuffer));
  }
  stopTranscription() {
    console.log('停止录音!!!');
    this.stopVoiceRecord();
  }
  cancelTranscription() {
    this.taskFailed = true;
    this.webSoket.send('{"end": true}');
    this.webSoket.close();
    this.stopVoiceRecord();
  }
}

export default function voiceConversion(options) {
  const { type } = options;
  let instance;
  if (type === 1) {
    instance = new XunfeiVoiceConversionAdapter(options);
  } else if (type === 2) {
    instance = new AliVoiceConversionAdapter(options);
  }
  instance.startTranscription();
  return instance;
}