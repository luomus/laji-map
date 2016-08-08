var path = require('path');
var webpack = require('webpack');

module.exports = {
  devtool: 'eval',
	entry: [
		path.join(__dirname, "playground", "app"),
	],
	output: {
		publicPath: "/build/",
		filename: "main.js"
	},
  plugins: [
    new webpack.HotModuleReplacementPlugin(),
	  new webpack.IgnorePlugin(/^(buffertools)$/) // unwanted "deeper" dependency
  ],
  module: {
    loaders: [
      {
        test: /\.css$/,
        loader: 'style-loader!css-loader'
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
        test: /\.js$/,
        loaders: ['react-hot', 'babel'],
        include: [
	        path.join(__dirname, 'src'),
	        path.join(__dirname, "playground")
				]
      },
	    {
		    test: /\.svg/,
		    loader: 'svg-url-loader'
	    }
    ],
    noParse: [
	    /dist\/(ol|proj4).js/
		]
  }
};
