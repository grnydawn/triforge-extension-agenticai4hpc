/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');

module.exports = {
    mode: 'production', // or 'development'
    devtool: false,
    entry: {
        map: './src/webview-ui/map/index.ts',
        executionSetup: './src/webview-ui/executionSetup/main.ts',
        computationSetup: './src/webview-ui/computationSetup/main.ts' // Uncomment when ready
    },
    target: 'web',
    output: {
        path: path.resolve(__dirname, 'dist', 'webview'),
        filename: '[name].bundle.js',
        library: {
            type: 'window',
        },
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true, // speed up build
                            configFile: 'tsconfig.json'
                        },
                    },
                ],
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            },
        ],
    },
    optimization: {
        minimize: false // easier debugging for now
    },
    // Ensure we don't try to bundle node specific stuff 
    // (Leaflet relies on browser APIs which is fine)
    externals: {
        vscode: 'commonjs vscode' // Exclude vscode module from bundle
    }
};
