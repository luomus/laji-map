var path = require("path");
var webpack = require("webpack");
var ExtractTextPlugin = require("extract-text-webpack-plugin");

module.exports = {
	entry: {
		"laji-map": ["./src/map"],
		styles: "./src/styles"
	},
	output: {
		path: path.join(__dirname, "dist"),
		filename: "[name].js",
		libraryTarget: "umd"
	},
	plugins: [
		new ExtractTextPlugin("[name].css", {allChunks: true}),
		new webpack.IgnorePlugin(/^(buffertools)$/), // unwanted "deeper" dependency
		new webpack.DefinePlugin({'process.env.NODE_ENV': '"production"'})
	],
	module: {
		loaders: [
			{
				test: /\.js$/,
				loaders: ["babel"],
				include: [
					path.join(__dirname, "src")
				]
			},
			{
				test: /\.json$/,
				loader: "json"
			},
			{
				test: /\.css$/,
				loader: ExtractTextPlugin.extract("css-loader")
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
			/node_modules\/proj4leaflet\/lib\/proj4-compressed\.js/
		]
	}
};
