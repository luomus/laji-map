var path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
	mode: "production",
	entry: {
		"laji-map": path.join(path.resolve(), "src", "index"),
		"laji-map-no-line-transect": path.join(path.resolve(), "src", "index-no-line-transect"),
		"utils": path.join(path.resolve(), "src", "utils"),
		styles: path.join(path.resolve(), "src", "styles")
	},
	output: {
		path: path.join(path.resolve(), "dist"),
		filename: "[name].js",
		libraryTarget: "umd"
	},
	plugins: [
		new MiniCssExtractPlugin({filename: "[name].css"})
	],
	module: {
		rules: [
			{
				test: /\.(t|j)s$/,
				loader: "ts-loader",
				include: [
					path.join(path.resolve(), "src")
				]
			},
			{
				test: /\.css$/,
				use: [
					MiniCssExtractPlugin.loader,
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
				test: /\.jpg$/,
				type: "asset/resource"
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
					name: "styles",
					test: /\.css$/,
					chunks: "all",
					enforce: true
				}
			}
		}
	},
	resolve: {
		extensions: [".ts", ".js"]
	}
};
