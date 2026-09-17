import Ajax from './ajax';

const ajax = new Ajax({ url: '/' }); // 实例化

const dictResult = {};

const cacheLoading = {};

export const initAjax = (config = {}, clientType) => { // 初始化配置项
    ajax.config = { ...ajax.config, ...config };
    ajax.clientType = clientType;
    return ajax;
};

export const getDictFileApi = ({ cache, ...params }) => { // 平台级静态词条
    const languageCode = params.languageCode;
    const findResult = dictResult[languageCode];
    if (findResult && cache) {
        return Promise.resolve(findResult);
    }

    if (cacheLoading[languageCode] && !params.tagCodes) { // 处理同时发起多次请求，走缓存
        const result = {};
        cacheLoading[languageCode].push(result);
        return new Promise((resolve) => {
            result.resolve = function (data) {
                const res = data || {};
                resolve(res);
            };
        });
    }

    cacheLoading[languageCode] = [];
    return ajax.get('TODO', { ...params }, { companyId: true, timeout: 5000 }).then((res) => {
        dictResult[languageCode] = res;
        if (cacheLoading[languageCode] && cacheLoading[languageCode].length) {
            cacheLoading[languageCode].forEach((item) => {
                item.resolve(res);
            });
        }
        delete cacheLoading[languageCode];
        return res;
    }).catch(() => {
        delete cacheLoading[languageCode];
        return {};
    });
};

export const getDynamicDictFileApi = (params) => {
    return ajax.get('TODO', params, { companyId: true, timeout: 5000 });
};

/**
 * 根据key值获取所有语言
 * @param {key: string} params
 */
export const getDictDetails = (params) => {
    return ajax.get('TODO', params);
};

// 关联标签
export const saveDictApi = (params) => {
    return ajax.post('TODO', params);
};

/**
 * 删除标签
 * @param {tagCode: String} params
 */
export const delTag = (params) => {
    return ajax.post('TODO', params);
};

// 获取语言包
export const getJsonFile = (url) => {
    return ajax.get(url, {}, { type: 'json' }).catch(() => { return {}; });
};
