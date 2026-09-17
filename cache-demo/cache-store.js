/**
 * 用于接口缓存的Cache-Store
 * /**
   *   开启缓存
   *   $.ajax({
   *      isCache: true
   *   })
   *  
   *   自定义 (models上同等配置)
   *   $.ajax({
   *      isCache: false, // 默认是关闭的
   *      isStorage: 'vuexStore', // 默认缓存
   *      cacheTime： 10 * 60 // 缓存10分钟
   *   })
   *  
   *    axios.get(url, { cacheConfig: {
            isStorage: 'localStorage',
            isExpires: 900,
            isCache: true
   *    } })
   * 
   */

/** ****************工具方法**************** */
var qs = require('qs');
var jsonTransformer = {
  str: function (data) {
    return JSON.stringify(data);
  },
  json: function (data) {
    try {
      return data && JSON.parse(data);
    } catch (error) {
      return null;
    }
  },
};
// qs的参数过滤，把空字符串和未定义的参数去除
function qsFilterFunc(prefix, value) {
  if (value === '' || value === undefined) {
    return;
  }
  return value;
}
// // qs的参数排序，避免相同接口不同参数排序导致的问题
function alphabeticalSort(a, b) {
  return a.localeCompare(b);
}
/** ***************工具方法End************** */

/** 构造函数 */
function createCacheStore(defaultOptions) {
  this.defaultOptions = Object.assign({}, defaultOptions);
  this.vuexStore = {};
  this.localStorage = window.localStorage || {};
  this.pendingRequests = {}; // 用于记录缓存状态
  this.pendingPromises = {}; // 用于保存重复接口的promise
  this.blackList = [];
  this._deleteAllExpiresTimer = null;
}
/**
 * 类型定义：
 *
 * cacheItem: <缓存的数据对象> {
 *  e: String,
 *  data: Object,
 * }
 *
 * options: <缓存参数配置> {
 *  store: Enum<String>['localstorage', 'vuexStore'],
 *  expires: String 秒
 * }
 *
 * opts: <接口require请求数据> {
 *  url: String,
 *  method: String,
 *  data: Object
 * }
 */

/** 原型继承 */
createCacheStore.prototype = {
  set: function (key, val, options) {
    // 格式化储存内容
    var formatValue = jsonTransformer.str({
      e: this._getExpiresDate(+options.expires),
      data: val,
    });
    if (this[options.store]) {
      this[options.store][key] = formatValue;
    }
    // return this.vuexStore;
  },
  get: function (key, options) {
    if (!this[options.store]) return false;
    var cacheItem = jsonTransformer.json(this[options.store][key]);
    // 清理过期缓存
    this.deleteAllExpires();

    // 判断是否缓存对象
    if (!this._checkCacheItem(cacheItem)) {
      return false;
    }
    // 判断是否过期
    if (!this._checkExpires(cacheItem)) {
      // 过期数据清理
      this.deleteCache(key, options);
      return false;
    }
    return cacheItem.data;
  },
  replace: function () {
    return {};
  },
  deleteCache: function (key, options) {
    if (!this[options.store]) return false;
    delete this[options.store][key];
  },
  /**
   * 清楚过期缓存数据
   * @param {Boolean} clearAll clearAll为true时立即销毁所有缓存，不校验是否过期
   */
  deleteAllExpires: function (clearAll) {
    var time = clearAll ? 0 : 10000;
    clearTimeout(this._deleteAllExpiresTimer);
    var _this = this;
    this._deleteAllExpiresTimer = setTimeout(function () {
      Object.keys(_this.localStorage).forEach(function (cacheKey) {
        var data = jsonTransformer.json(_this.localStorage[cacheKey]);
        // 校验是否缓存的数据
        if (data && _this._checkCacheItem(data)) {
          // 校验是否清除所有缓存
          if (clearAll) {
            delete _this.localStorage[cacheKey];
            return;
          }
          // 非清楚所有缓存时要判断是否过期
          if (!_this._checkExpires(data)) {
            delete _this.localStorage[cacheKey];
          }
        }
      });
      if (clearAll) {
        _this.vuexStore = {};
      }
    }, time);
  },
  clear: function () {
    return {};
  },
  getLength: function () {
    return {};
  },
  /**
   * 根据请求参数生成唯一的key
   * @param {
   *  url: String,
   *  method: String,
   *  data: Object
   *  skey: String 用于区分不同场景下同一个接口会返回不同的值
   * } opts
   * @returns
   */
  getCacheKey: function (opts) {
    var url = opts.url.split('?')[0].replace(/^\//, '');
    var data = jsonTransformer.json(jsonTransformer.str(opts.data)) || {};
    var skey = opts.skey || '';
    if (opts.url.split('?')[1]) {
      var params = qs.parse(opts.url.split('?')[1]);
      if (typeof data !== 'object') data = {};
      Object.assign(data, params);
    }
    // Todo: 参数是否需要排序
    data = data && jsonTransformer.str(qs.parse(qs.stringify(data, {
      filter: qsFilterFunc,
      sort: alphabeticalSort
    })));
    var method = opts.method.toLocaleUpperCase();
    var str = skey + method + url + data;
    return str;
  },
  pushRepeatRequest: function (cacheKey, cb) {
    if (!this.pendingPromises[cacheKey]) {
      this.pendingPromises[cacheKey] = [];
    }
    var result = {};
    result.promise = new Promise(function (resolve, reject) {
      result.resolve = resolve;
      result.reject = reject;
    });
    this.pendingPromises[cacheKey].push(result);
    return result.promise;
  },

  /** 完成等待中的请求 */
  resolvePendingRequire: function (key, config, response) {
    var that = this;
    var data = that.get(key, config);

    if (this.pendingPromises[key] && (this.pendingPromises[key] instanceof Array)) {
      this.pendingPromises[key].forEach(function (item) {
        // 重复请求等待中接口响应
        item.resolve(data);
      });
      delete this.pendingPromises[key];
    }
    delete this.pendingRequests[key];
  },

  /** 请求是否处于pending状态  */
  checkPendingRequire: function (key) {
    return Boolean(this.pendingRequests[key]);
  },

  /** 设置缓存状态 */
  setPendingRequire: function (key, bool) {
    this.pendingRequests[key] = bool;
  },

  /** 判断是否过期 */
  _checkExpires: function (cacheItem) {
    return Date.now() < cacheItem.e;
  },
  /** 判断是否缓存对象 */
  _checkCacheItem: function (cacheItem) {
    if (typeof cacheItem !== 'object') {
      return false;
    }
    if ('e' in cacheItem && 'data' in cacheItem) {
      return true;
    }
    return false;
  },
  // 计算失效日期
  _getExpiresDate: function (expiresTime) {
    var expires = Date.now();
    if (typeof expiresTime === 'number') {
      expires += expiresTime * 1000;
    }
    return expires;
  },
};

module.exports = createCacheStore;
