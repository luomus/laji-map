var path = require("path");
var webpack = require("webpack");

module.exports = {
	mode: "development",
	devtool: "eval",
	entry: [
		path.join(__dirname, "playground", "app"),
	],
	output: {
		publicPath: "/build/",
		filename: "main.js"
	},
	plugins: [
		new webpack.HotModuleReplacementPlugin()
	],
	module: {
		rules: [
			{
				test: /\.(j|t)s$/,
				loader: "awesome-typescript-loader?module=es6",
				include: [
					path.join(__dirname, "src"),
					path.join(__dirname, "playground")
				]
			},
			{
				test: /\.css$/,
				loader: "style-loader!css-loader"
			},
			{
				test: /\.png$/,
				loader: "url-loader?limit=100000"
			},
			{
				test: /\.jpg$/,
				loader: "file-loader"
			},
			{
				test: /\.svg/,
				loader: "svg-url-loader"
			}
		],
		noParse: [
			/dist\/(ol|proj4).js/
		]
	}
};
