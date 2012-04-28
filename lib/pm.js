
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const URL = require("url");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");
const SEMVER = require("semver");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const NPM = require("./npm");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
const GIT = require("sourcemint-pm-git/lib/git");
const PM_GIT = require("sourcemint-pm-git/lib/pm");
const SM_PM = require("sourcemint-pm-sm/lib/pm");


exports.status = function(pm, options) {
    ASSERT(typeof options.name !== "undefined", "'options.name' required!");
    ASSERT(typeof pm.context.metaBasePath !== "undefined", "'pm.context.metaBasePath' required!");
    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.homeBasePath, "url-cache"), {
        ttl: ((options.latest)?-1:(7 * 24 * 60 * 60 * 1000))    // 7 Days
    });
    return cache.get("https://registry.npmjs.org/" + options.name).then(function(response) {
        
        var summary = {};
        
        if (response.status === 200 || response.status === 304) {
            
            var descriptor = JSON.parse(response.body.toString());

            var versionSelector = options.versionSelector;
            if (versionSelector === true) {
                versionSelector = ">0";
            }
            else if (versionSelector === "latest") {
                versionSelector = ">0";
            }

            summary.published = true;
            summary.actualVersion = pm.context.package.descriptor.json.version;
            summary.latestVersion = descriptor["dist-tags"].latest;
            summary.usingLatest = (SEMVER.compare(summary.actualVersion, summary.latestVersion)===0)?true:false;
            summary.versions = Object.keys(descriptor.versions);
            if (versionSelector) {
                summary.versionSelector = versionSelector;
                summary.latestSatisfyingVersion = SEMVER.maxSatisfying(summary.versions, versionSelector);
                summary.usingLatestSatisfying = (SEMVER.compare(summary.actualVersion, summary.latestSatisfyingVersion)===0)?true:false;
            }
            if (descriptor.time) {
                if (summary.actualVersion && descriptor.time[summary.actualVersion]) {
                    summary.actualVersionTime = descriptor.time[summary.actualVersion];
                    summary.actualVersionAge = Math.floor((new Date().getTime() - new Date(summary.actualVersionTime).getTime())/1000/60/60/24);
                }
                if (summary.latestVersion && descriptor.time[summary.latestVersion]) {
                    summary.latestVersionTime = descriptor.time[summary.latestVersion];
                    summary.latestVersionAge = Math.floor((new Date().getTime() - new Date(summary.latestVersionTime).getTime())/1000/60/60/24);
                }
            }

        } else
        if (response.status === 404) {

            summary.published = false;

        } else {
            throw new Error("NPM info status '" + response.status + "' not handled!");
        }

        return summary;
    });
}


exports.path = function(pm) {
    return Q.call(function() {
        return PATH.join(pm.context.package.path, "../../node_modules", PATH.basename(pm.context.package.path));
    }); 
}


exports.update = function(pm, options) {

    options.update = true;

    return exports.install(pm, options);
}

exports.install = function(pm, options) {
    
    ASSERT(typeof options.locator !== "undefined", "'options.locator' required!");

    // TODO: Add option to install package into program's `node_modules/` folder.
    //       Requires version for all package instances (in dependency tree) with same name to be identical.
    //       This can be achieved via `sm trim ; sm freeze`.
    
    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.homeBasePath, "url-cache"), {
        ttl: 0    // Indefinite
    });
    var url = options.locator;

    TERM.stdout.writenl("\0cyan(Locating: " + url + "\0)");
    
    return exports.path(pm).then(function(path) {
    
        function install(fromPath) {
        
            return NPM.install(((fromPath===".")?path:PATH.join(path, "../..")), fromPath).then(function() {
    
                var descriptor = JSON.parse(FS.readFileSync(PATH.join(path, "package.json")));
    
                if (descriptor.name !== options.name) {
                    throw new Error("Package installed at '" + pm.context.package.path + "' from '" + fromPath + "' is not named '" + options.name + "' but '" + descriptor.name + "'!");
                }
            });
        }
        
        if (/^git(@|:\/\/)/.test(url)) {

            if (PATH.existsSync(path)) {
                FS_RECURSIVE.rmdirSyncRecursive(path);
            }

            return SM_PM.forPackagePath(path, pm).then(function(pm) {
                return pm.clone({
                    locator: url
                }).then(function() {
                    return install(".");
                });
            });
        }

        return cache.get(url, {
            loadBody: false,
            ttl: ((options.update)?-1:false)
        }).then(function(response) {
            if (response.status === 200 || (response.status === 304 && !PATH.existsSync(path))) {
                
                if (PATH.existsSync(path)) {
                    FS_RECURSIVE.rmdirSyncRecursive(path);
                }
                
                return install(response.cachePath);
            } else
            if (response.status === 304) {
                TERM.stdout.writenl("  \0green(Not modified\0)");
            } else
            if (response.status === 404) {
                throw new Error("URL '" + url + "' not found!");
            } else {
                throw new Error("Got status '" + response.status + "' when requesting URL '" + url + "'!");
            }
        });
    });
}


exports.publish = function(pm, options) {

    if (pm.context.package.descriptor.json.private === true) {
        TERM.stderr.writenl("\0orange(SKIP: Not publishing NPM package. It is marked 'private' in package descriptor '" + pm.context.package.descriptor.path + "'!\0)");
        return Q.ref();
    } else {
        
        return exports.status(pm, {
            name: pm.context.package.descriptor.json.name,
            latest: true
        }).then(function(status) {
            
            if (status.published && status.usingLatest) {
                TERM.stderr.writenl("\0orange(SKIP: Not publishing NPM package. It is already published for version '" + status.latestVersion + "'!\0)");
                var deferred = Q.defer();
                deferred.reject();
                return deferred.promise;
            }

            var packagePath = pm.context.package.path;
            
            return NPM.publish(packagePath).fail(function(err) {
                if (/http 409/.test(err.message) && /Cannot publish over existing version./.test(err.message)) {
                    TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot publish to NPM as package '" + pm.context.package.descriptor.json.name + "' at version '" + pm.context.package.descriptor.json.version + "' already exists!\0)\0)");
                    var deferred = Q.defer();
                    deferred.reject();
                    return deferred.promise;
                } else {
                    throw err;
                }
            }).then(function() {
                return exports.status(pm, {
                    name: pm.context.package.descriptor.json.name,
                    latest: true
                }).then(function(status) {
                    if (!status.usingLatest) {
                        TERM.stderr.writenl("\0red(\0bold(ERROR: Published package '" + pm.context.package.descriptor.json.name + "' at version '" + pm.context.package.descriptor.json.version + "' to NPM, but NPM still has version '" + status.latestVersion + "'!\0)\0)");
                        var deferred = Q.defer();
                        deferred.reject();
                        return deferred.promise;
                    }
                });                    
            });                    
        });
    }
}

