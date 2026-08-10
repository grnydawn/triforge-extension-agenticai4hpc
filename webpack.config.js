/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

/** @type WebpackConfig */
const config = {
    target: 'node', // extensions run in a node context
    mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

    entry: {
        extension: './src/extension.ts' // the entry point of this extension, 
    },
    output: {
        // the bundle is stored in the 'dist' folder (check package.json), 
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    devtool: 'nosources-source-map',
    externals: {
        'vscode': 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
        // 'canvas': 'commonjs canvas', // example for excluding canvas
    },
    resolve: {
        // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
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
                        }
                    },
                ],
            },
        ],
    },
    plugins: [
        // new webpack.IgnorePlugin({ resourceRegExp: /^((fs)|(path)|(os)|(crypto)|(source-map-support))$/, })
        // BUG-1: src/** is excluded from the packaged VSIX (.vscodeignore), so the
        // DEM fetch script must be copied into dist/ to exist at runtime. The host
        // resolves it as path.join(extensionPath, 'dist', 'fetch_dem.py').
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/scripts/fetch_dem.py', to: 'fetch_dem.py' },
            ],
        }),
        // TOOL-4: ts-loader runs with transpileOnly (speed), so it never type-checks.
        // ForkTsChecker runs `tsc --noEmit` in a side process and FAILS the build on
        // any type error, so type errors can no longer slip silently into dist/.
        new ForkTsCheckerWebpackPlugin(),
    ],
    infrastructureLogging: {
        level: "log", // enables logging required for problem matchers
    },
};

module.exports = config;
