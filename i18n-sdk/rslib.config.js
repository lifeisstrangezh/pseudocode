export default {
    lib: [
        {
            format: 'umd',
            umdName: 'i18nSdk',
            autoExtension: false,
            output: {
                distPath: {
                    root: './dist',
                },
                filename: {
                    js: 'i18nSdk.js'
                }
            },
        },
    ],
};