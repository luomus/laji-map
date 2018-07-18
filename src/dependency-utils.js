const providerToDependency = {};
const dependencyToProvider = {};
const reflected = {};

/**
 * These utils allow functions to delay their initial execution until their dependencies have executed (they are
 * provided, as to speak).
 */


export function depsProvided(target, name, args) {
	initDepContextFor(target);
	const {depsExecuted, params} = target;
	if (!depsExecuted[name] && !depIsProvided(target, name)) {
		params[name] = args;
		return false;
	}
	return true;
}

/**
 * A decorator. If a function is reflected, it will execute always when some of it's dependencies is reprovided.
 */
export function reflect() {
	return (target, property) => {
		reflected[property] = true;
	};
}

/**
 * A decorator. If the dependencies are not provided on initial execution, the initial execution MUST be delayed until
 * all dependencies are provided. When all dependencies are provided, the initial execution is executed.
 *
 * NOTE: You MUST manually check in the function body if the dependencies are provided! Just put this as the first line
 * of the function body:
 *
 *   if (!depsProvided(this, "functionName", arguments)) return;
 *
 */
export function dependsOn(...deps) {
	return (target, property) => {
		if (dependencyToProvider[property]) return; // Dependency tree constructed already.

		deps.forEach(dep => {
			providerToDependency[dep] = [...(providerToDependency[dep] || []), property];
		});
		dependencyToProvider[property] = deps;
	};
}

/**
 * Provide a dependency. All delayed functions depending on this function are executed after this.
 */
export function provide(target, prov) {
	function executeDependencies(target, prov) {

		const {depsExecuted} = target;
		(providerToDependency[prov] || []).filter(dep => depIsProvided(target, dep)).forEach(dep => {
			if (!target.params[dep] && !reflected[dep]) return;
			target[dep](...(target.params[dep] || []));
			delete target.params[dep];
			depsExecuted[dep] = true;
		});
	}

	initDepContextFor(target);
	target.provided[prov] = true;
	executeDependencies(target, prov);
}

export function isProvided(target, prov) {
	return target.provided[prov];
}

function initDepContextFor(target) {
	["provided", "depsExecuted", "params", "reflected"].forEach(prop => {
		if (!target[prop]) {
			target[prop] = {};
		}
	});
}

function depIsProvided(target, dep) {
	let returnValue = false;
	const {depsExecuted, provided} = target;
	if (dependencyToProvider[dep].every(_prov => provided[_prov])) {
		if (depsExecuted[dep] && !reflected[dep]) return;
		returnValue = true;
	}
	return returnValue;
}
