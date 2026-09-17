import { getDictFileApi, initAjax, setDynamicKey, getJsonFile, getDictDetails, delTag } from './api';

class I18nSdk {
    constructor({ lang = 'zh_cn', initTagCode = () => {}, clientType = 0 }, ajaxConfig = {}) {
        this.lang = lang; // 语种
        this.clientType = clientType; // 客户端类型：PC-1，APP-2
        this.initTagCode = initTagCode;
        this.ajax = initAjax(ajaxConfig, clientType);
    }

    static cacheDictionary = {
        0: {},
        1: {},
        2: [],
    }; // 缓存词条   key: // 0:新增 1:更新 2:删除

    static cacheTag = {}; // 缓存标签

    static cacheLoading = {}; // 重复请求缓存状态

    cleanDictCache() { // 清理词条缓存
        this.constructor.cacheDictionary = {
            0: {},
            1: {},
            2: [],
        };
    }

    delTag(tagCode) { // 删除标签
        return delTag({ tagCode });
    }

    getDict(key) { // 获取缓存中的词条
        return this.constructor.cacheDictionary[0][key]
            || this.constructor.cacheDictionary[1][key]
            || null;
    }

    // 获取静态词条内容
    getTagDict(code, cache = true, tagCodes) {
        const params = { cache, tagCode: code, languageCode: this.lang, clientType: this.clientType, type: this.clientType === 0 ? 1 : 0 };
        this.constructor.cacheTag[this.lang] = this.constructor.cacheTag[this.lang] || {};
        if (this.constructor.cacheTag[this.lang][code]) { // 取缓存
            const result = this.constructor.cacheTag[this.lang][code];
            return Promise.resolve(result);
        }
        if (tagCodes) Object.assign(params, { tagCodes });
        return new Promise((resolve) => {
            this.constructor.getTagDictHandler(params).then((url) => {
                if (url) {
                    return getJsonFile(url).then((data) => {
                        if (cache) {
                            this.constructor.cacheTag[this.lang][code] = data;
                        }
                        resolve(data);
                    }).catch(() => {
                        resolve({});
                    });
                }
                return resolve({});
            }).catch((err) => {
                resolve(err);
            });
        });
    }

    getKeyDetails(key) { // 根据key获取词条内容
        return this.constructor.getDictDetailsHabdler(key).then((res) => {
            // 缓存中的词条覆盖服务中的内容，以缓存中的为主
            const dict = this.getDict(key);
            return dict ? this.constructor.mergeDetails(res, dict.details) : res;
        });
    }

    changeLang(lang) { // 切换语种方法
        this.lang = lang;
        return this.initTag();
    }

    getI18nLang(tagCodes, cache = true) { // 获取国际化语言
        return new Promise((resolve) => {
            this.constructor.getI18nLangHandler({ cache, tagCodes, languageCode: this.lang, clientType: this.clientType, type: 0 }).then((list) => {
                if (list && list.length) {
                    resolve(list);
                }
                return resolve([]);
            }).catch((err) => {
                resolve(err);
            });
        });
    }
}

export default I18nSdk;
