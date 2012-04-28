
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
    
    var installCachePath = PATH.join(pm.context.homeBasePath, "install-cache");

    // TODO: Add option to install package into program's `node_modules/` folder.
    //       Requires version for all package instances (in dependency tree) with same name to be identical.
    //       This can be achieved via `sm trim ; sm freeze`.
    
    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.homeBasePath, "url-cache"), {
        ttl: 0    // Indefinite
    });
    var url = options.locator;
    
    return exports.path(pm).then(function(path) {
        
        TERM.stdout.writenl("\0cyan(Locating NPM package '" + url + "' to be installed at '" + path + "'\0)");

        function makeCachePath(path) {
            return PATH.join(installCachePath, path.replace(/[:@#]/g, "/").replace(/\/+/g, "/"))
        }
        
        
        function installGlobal(cachePath, status) {
            
            if (status === 304) {
                return Q.call(function() {
                    return cachePath;
                });
            }

            TERM.stdout.writenl("\0cyan(Installing in cache: " + cachePath + "\0)");
            
            return NPM.install(cachePath, ".").then(function() {
                
                var descriptor = JSON.parse(FS.readFileSync(PATH.join(cachePath, "package.json")));
    
                if (descriptor.name !== options.name) {
                    throw new Error("Package going to be installed at '" + path + "' from '" + url + "' is not named '" + options.name + "' but '" + descriptor.name + "'!");
                }
                
                return cachePath;
            });
        }
    
        function install(cachePath, status) {
            return installGlobal(cachePath, status).then(function(cachePath) {

                if (PATH.existsSync(path)) {
                    TERM.stdout.writenl("\0cyan(Deleting existing content at: " + path + "\0)");

                    FS_RECURSIVE.rmdirSyncRecursive(path);
                }
                FS_RECURSIVE.mkdirSyncRecursive(path);
                
                TERM.stdout.writenl("\0cyan(Copying cached install from '" + cachePath + "' to '" + path + "'.\0)");

                return FS_RECURSIVE.osCopyDirRecursive(cachePath, path);
            });
        }
        
        if (/^git(@|:\/\/)/.test(url)) {

            var cachePath = makeCachePath(url);

            if (PATH.existsSync(cachePath)) {
                FS_RECURSIVE.rmdirSyncRecursive(cachePath);
            }

            return SM_PM.forPackagePath(cachePath, pm).then(function(pm) {
                return pm.clone({
                    locator: url
                }).then(function() {
                    return install(cachePath);
                });
            });
        }

        var cachePath = makeCachePath(url);

        return SM_PM.forPackagePath(cachePath, pm).then(function(pm) {
            return pm.install({
                pm: "tar",
                locator: url
            }).then(function(status) {
                if (status === 200 || !PATH.existsSync(path)) {
                    return install(cachePath, status);
                }
            });
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

