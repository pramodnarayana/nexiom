const nodeExternals = require('webpack-node-externals');

module.exports = function webpack_(options, webpack) {
    return {
        ...options,
        externals: [
            nodeExternals({
                allowlist: [/^@nexiom/],
            }),
        ],
    };
};
