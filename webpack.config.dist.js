var path = require("path");
var webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
	mode: "production",
	entry: {
		"laji-map": "./src/map",
		styles: "./src/styles"
	},
	output: {
		path: path.join(__dirname, "dist"),
		filename: "[name].js",
		libraryTarget: "umd"
	},
	plugins: [
		new MiniCssExtractPlugin({filename: "[name].css"})
	],
	module: {
		rules: [
			{
				test: /\.js$/,
				loader: "awesome-typescript-loader?module=es6",
				include: [
					path.join(__dirname, "src")
				]
			},
			{
				test: /\.json$/,
				loader: "json-loader"
			},
			{
				test: /\.css$/,
				use: [
					MiniCssExtractPlugin.loader,
					"css-loader"
				]
			},
			{
				test: /\.png$/,
				loader: "url-loader?limit=100000"
			},
			{
				test: /\.jpg$/,
				loader: "file-loader?name=images/[name].[ext]"
			},
			{
				test: /\.svg/,
				loader: "svg-url-loader"
			}
		],
		noParse: [
			/node_modules\/proj4leaflet\/lib\/proj4-compressed\.js/,
			/node_modules\/proj4\/dist\/proj4\.js/
		]
	},
	optimization: {
		splitChunks: {
			cacheGroups: {
				styles: {
					name: 'styles',
					test: /\.css$/,
					chunks: 'all',
					enforce: true
				}
			}
		}
	},
};
