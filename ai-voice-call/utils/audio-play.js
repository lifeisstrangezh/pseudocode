const callHandler = (method, params) => {}; // 调用安卓/IOS/鸿蒙原生方法

let audioInstance = null;
const playCacheList = [];
export function init() {
  audioInstance = document.createElement('audio');
  audioInstance.classList.add('audio-player');
  document.body.appendChild(audioInstance);
  audioInstance.addEventListener('ended', () => {
    // 播放结束
    stopPlay();
  });
}

export function updatePlayCacheList(item) {
  playCacheList.push(item);
}

export async function toPlay(data) {
  if (!audioInstance) init();

  stopPlay();
  playCacheList.push(data);

  let { fileId, filePath } = data;
  if (filePath && fileId) {
    audioInstance.src = filePath;
    audioInstance.play().then(() => {
      console.log('data', data);
      data.playing = true;
    });
    return;
  }
  // 使用原生播放
  data.playing = true;
  const params = {
    key: fileId,
    successCb: res => {
      console.log('answer-msg play successCb', res);
      if (res === 0) {
        data.playing = true;
      } else {
        data.playing = false;
      }
    },
    errorCb: err => {
      console.log('answer-msg play errorCb', err);
      data.playing = false;
    }
  };
  callHandler('playRecord', params);
}

export function stopPlay() {
  if (!audioInstance) init();
  audioInstance.pause();
  playCacheList.forEach((item) => {
    item.playing = false;
    if (item.conversionInstance) {
      item.conversionInstance.voicePlayer.stopAudio();
    }
    callHandler('stopPlayRecord', { key: item.fileId });
  });
}

export function destory() {

}