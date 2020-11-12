// Firefox isn't run default since it has a bug with mousemove (See https://github.com/angular/protractor/issues/4715 )

const [width, height] = [800, 1000];
const common = {
	shardTestFiles: true,
	maxInstances: 4
};
const chrome = {
	...common,
	browserName: "chrome",
	chromeOptions: {
		args: ["--headless", "--disable-gpu", `window-size=${width}x${height}`, "--no-sandbox", "--disable-dev-shm-usage"]
	},
};

const firefox = {
	...common,
	browserName: "firefox",
	"firefoxOptions": {
		args: ["--headless", `--width=${width}', '--height=${height}`]
	},
	"moz:firefoxOptions": {
		args: ["--headless", `--width=${width}', '--height=${height}`]
	}
};

let multiCapabilities = [chrome, firefox]
if (process.env.TEST_BROWSER === "chrome") {
	multiCapabilities = [chrome];
} else if (process.env.TEST_BROWSER === "firefox") {
	multiCapabilities = [firefox];
}
if (process.env.HEADLESS && process.env.HEADLESS !== "true") multiCapabilities.forEach(capabilities => {
	const options = [capabilities["chromeOptions"], capabilities["firefoxOptions"], capabilities["moz:firefoxOptions"]];
	options.filter(o => o).forEach(_options => {
		_options.args = _options.args.filter(a => a !== "--headless");
	});
});

exports.config = {
	seleniumAddress: "http://localhost:4444/wd/hub",
	specs: ["test/*-spec.ts"],
	multiCapabilities,
	SELENIUM_PROMISE_MANAGER: false,
	onPrepare: async () => {
		require('ts-node').register({
			project: require('path').join(__dirname, './tsconfig.json')
		});

		browser.waitForAngularEnabled(false);

		var env = jasmine.getEnv();
		env.clearReporters();
		var SpecReporter = require("jasmine-spec-reporter").SpecReporter;
		env.addReporter(new SpecReporter({
			displayStacktrace: true
		}));

		// Set manually since Firefox cli size options don't work.
		//await browser.driver.manage().window().setRect({width, height});
	},
	plugins: [{
		package: "protractor-console-plugin",
		exclude: ["Failed to load resource"]
	}]
};
