
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");
const SEMVER = require("semver");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const NPM = require("./npm");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");


exports.status = function(pm, options) {
    ASSERT(typeof options.name !== "undefined", "'options.name' required!");
    ASSERT(typeof pm.context.metaBasePath !== "undefined", "'pm.context.metaBasePath' required!");
    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.metaBasePath, "url-cache"), {
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
            else if (versionSelector === false) {
                throw new Error("versionSelector is null for package: " + pm.context.package.path);
            }
            else if (versionSelector === "latest") {
                versionSelector = ">0";
            }

            summary.published = true;
            summary.versionSelector = versionSelector;
            summary.actualVersion = pm.context.package.descriptor.json.version;
            summary.latestVersion = descriptor["dist-tags"].latest;
            summary.versions = Object.keys(descriptor.versions);
            summary.latestSatisfyingVersion = SEMVER.maxSatisfying(summary.versions, versionSelector);
            summary.usingLatest = (SEMVER.compare(summary.actualVersion, summary.latestVersion)===0)?true:false;
            summary.usingLatestSatisfying = (SEMVER.compare(summary.actualVersion, summary.latestSatisfyingVersion)===0)?true:false;

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
    
    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.metaBasePath, "url-cache"), {
        ttl: 0    // Indefinite
    });
    var url = options.locator;

    TERM.stdout.writenl("\0cyan(Locating: " + url + "\0)");

    return cache.get(url, {
        loadBody: false,
        ttl: ((options.update)?-1:false)
    }).then(function(response) {
        return exports.path(pm).then(function(path) {
            
            if (response.status === 200 || (response.status === 304 && !PATH.existsSync(path))) {

                if (PATH.existsSync(path)) {
                    FS_RECURSIVE.rmdirSyncRecursive(path);
                }

                return NPM.install(PATH.join(path, "../.."), response.cachePath).then(function() {

                    var descriptor = JSON.parse(FS.readFileSync(PATH.join(path, "package.json")));

                    if (descriptor.name !== options.name) {
                        throw new Error("Package installed at '" + pm.context.package.path + "' from '" + response.cachePath + "' is not named '" + options.name + "' but '" + descriptor.name + "'!");
                    }
                });
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

    