// Firefox isn't run default since it has a bug with mousemove (See https://github.com/angular/protractor/issues/4715 )

const [width, height] = [800, 1000];
const common = {
	shardTestFiles: parseInt(process.env.THREADS) !== 1,
	maxInstances: process.env.THREADS ? parseInt(process.env.THREADS) :  4
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

let multiCapabilities = [chrome];
if (process.env.TEST_BROWSER === "firefox") {
	multiCapabilities = [firefox];
} else if (process.env.TEST_BROWSER === "multi") {
	multiCapabilities = [chrome, firefox];
}
if (process.env.HEADLESS && process.env.HEADLESS !== "true") multiCapabilities.forEach(capabilities => {
	const options = [capabilities["chromeOptions"], capabilities["firefoxOptions"], capabilities["moz:firefoxOptions"]];
	options.filter(o => o).forEach(_options => {
		_options.args = _options.args.filter(a => a !== "--headless");
	});
});

exports.config = {
	specs: ["test/*-spec.ts"],
	multiCapabilities,
	maxSessions: 4,
	SELENIUM_PROMISE_MANAGER: false,
	onPrepare: async () => {
		const path = await import("path");
		const tsNode = await import("ts-node");
		tsNode.register({
			project: path.join(path.resolve(),  "./tsconfig.test-run.json")
		});

		browser.waitForAngularEnabled(false);

		// Set manually since Firefox cli size options don't work.
		await browser.driver.manage().window().setSize(width, height);
	},
	plugins: multiCapabilities.length === 1 && multiCapabilities[0] === chrome && [{
		package: "protractor-console-plugin",
		exclude: [/Uncaught \(in promise\)/, /listener not found/, /Deprecated use of _flat/]
	}]
};
