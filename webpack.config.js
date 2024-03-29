var path = require("path");
var webpack = require("webpack");

module.exports = {
	mode: "development",
	devtool: "eval",
	entry: [
		path.join(path.resolve(), "playground", "app"),
	],
	output: {
		publicPath: "/build/",
		filename: "main.js"
	},
	devServer: {
		static: {
			directory: path.join(path.resolve(), "playground"),
		},
		host: "0.0.0.0",
		port: 4000,
		hot: true
	},
	module: {
		rules: [
			{
				test: /\.(j|t)s$/,
				use: [{
					loader: "ts-loader"
				}],
				include: [
					path.join(path.resolve(), "src"),
					path.join(path.resolve(), "playground")
				]
			},
			{
				test: /\.css$/,
				use: [
					{
						loader: "style-loader"
					},
					{
						loader: "css-loader"
					}
				]
			},
			{
				test: /\.png$/,
				type: "asset/inline"
			},
			{
				test: /\.(jpg|svg)$/,
				type: "asset/resource"
			}
		],
		noParse: [
			/dist\/(ol|proj4).js/
		]
	},
	resolve: {
		extensions: [".ts", ".js"]
	},
	watchOptions: {
		ignored: /\.swp$/,
	}
};
