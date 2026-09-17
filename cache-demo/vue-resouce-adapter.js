import Vue from 'vue';
import cacheStore from './cache-store';

if (!window.cacheStorage) {
  window.cacheStorage = new cacheStore({});
}

const cacheStorage = window.cacheStorage;

// 缓存拦截器
Vue.http.interceptors.push((request, next) => {
  const resSetJson = function (req, body) {
    const resInstant = req.respondWith(body, {
      status: 200,
      statusText: 'ok',
    });
    try {
      resInstant.bodyText = JSON.stringify(body);
    } catch (error) {}
    resInstant.json = () => resInstant.body;
    return resInstant;
  };
  // 数据组装
  // 生成唯一的 Key
  const cacheConfig = request.cacheConfig || {};
  const isCache = cacheConfig.isCache;
  const tempParams = { ...request.params };
  delete tempParams._;
  const key = cacheStorage.getCacheKey({
    url: request.url,
    method: request.method,
    data: tempParams,
    skey: cacheConfig.skey
  });
  // 用于 get和set的必要参数
  const cacheParams = {
    store: cacheConfig.isStorage,
    expires: cacheConfig.isExpires
  };
  if (isCache) {
    const cacheValue = cacheStorage.get(key, cacheParams);
    const isPendingRequire = cacheStorage.checkPendingRequire(key);
    if (cacheValue) {
      // 接口缓存返回
      return resSetJson(request, cacheValue);
    }
    if (isPendingRequire) {
      // 重复接口请求等待
      return cacheStorage.pushRepeatRequest(key).then(res => {
        return resSetJson(request, res);
      });
    }
    cacheStorage.setPendingRequire(key, true);
  }

  next(res => {
    if (isCache && !cacheStorage.get(key, cacheParams)) {
      +res.status == 200 && cacheStorage.set(key, res.body, cacheParams);
      cacheStorage.resolvePendingRequire(key, cacheParams, res.body);
    }
    return res;
  });
});

export default cacheStorage;
