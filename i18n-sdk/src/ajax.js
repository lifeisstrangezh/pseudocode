class Ajax {
    constructor(config, clientType) {
        this.config = config;
        this.clientType = clientType;
    }

    request(method, url, params, config = {}) {
        // 创建xhr对象，兼容写法
        const xhr = new XMLHttpRequest();
        xhr.timeout = config.timeout || 10000;
        const baseUrl = 'api/v1';
        const token = localStorage.getItem('token');

        config = { ...this.config, ...config };

        // 将method转换成大写
        method = method.toUpperCase();

        // 参数拼接
        const pair = [];
        let k;
        for (k in params) {
            // 对参数值进行编码，防止特殊字符（如+）被错误解析
            pair.push(`${k}=${encodeURIComponent(params[k])}`);
        }
        const str = pair.join('&');
        // 判断请求方法
        if (method === 'GET') {
            url += `?${str}`;
        }
        if (!url.includes('http')) {
            url = config.url + baseUrl + url;
        }
        xhr.open(method, url);
        xhr.setRequestHeader('Authorization', `Bearer__${token}`);

        if (config.headers) { // 配置自定义请求头
            Object.keys(config.headers).forEach((key) => {
                xhr.setRequestHeader(key, config.headers[key]);
            });
        }

        let data = null;
        if (method === 'POST') {
            // 需要请求头
            xhr.setRequestHeader(
                'Content-Type',
                'application/x-www-form-urlencoded'
            );
            data = str;
        }
        xhr.send(data);

        // 指定xhr状态变化事件处理函数
        // 执行回调函数
        return new Promise((resolve, reject) => {
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200 || xhr.status === 304) {
                        if (typeof xhr.response === 'string') {
                            try {
                                resolve(JSON.parse(xhr.response));
                            } catch (error) {
                                resolve(xhr.response);
                            }
                        } else {
                            resolve(xhr.response);
                        }
                    } else {
                        // 错误
                        reject(xhr);
                    }
                }
            };
        });
    }

    get(url, params, config) {
        return this.request('get', url, params, config);
    }

    post(url, params, config) {
        return this.request('post', url, params, config);
    }

    put(url, params, config) {
        return this.request('put', url, params, config);
    }

    delete(url, params, config) {
        return this.request('delete', url, params, config);
    }
}

export default Ajax;