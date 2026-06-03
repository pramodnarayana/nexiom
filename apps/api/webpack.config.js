const nodeExternals = require('webpack-node-externals');

module.exports = function webpack_(options) {
    return {
        ...options,
        externals: [
            nodeExternals({
                allowlist: [/^@soopa/],
            }),
        ],
    };
};
