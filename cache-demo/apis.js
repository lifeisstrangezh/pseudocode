/** 使用示例 */
export const getList = params => {
  return Vue.http
    .get('/your url', {
      params,
      cacheConfig: {
        isStorage: 'vuexStore', // 或 localStorage、sessionStorage
        isCache: true, // 开启缓存
        isExpires: 10 * 60 // 缓存10分钟
      }
    })
    .then(res => res.data);
};