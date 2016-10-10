var path = require("path");
var webpack = require("webpack");

module.exports = {
	devtool: "eval",
	entry: [
		path.join(__dirname, "playground", "app"),
	],
	output: {
		publicPath: "/build/",
		filename: "main.js"
	},
	plugins: [
		new webpack.HotModuleReplacementPlugin(),
		new webpack.IgnorePlugin(/^(buffertools)$/), // unwanted "deeper" dependency
		new webpack.DefinePlugin({'process.env.NODE_ENV': '"development"'})
	],
	module: {
		loaders: [
			{
				test: /\.js$/,
				loaders: ["babel"],
				include: [
					path.join(__dirname, "src"),
					path.join(__dirname, "playground")
				]
			},
			{
				test: /\.json$/,
				loader: "json"
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
