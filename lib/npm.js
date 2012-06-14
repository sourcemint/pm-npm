
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const SPAWN = require("child_process").spawn;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");


exports.install = function(basePath, uri, options) {

    return callNPM(basePath, [
        "install",
        uri,
        "--production"
    ], options);
}


exports.update = function(basePath, options) {

    return callNPM(basePath, [
        "update"
    ], options);
}

exports.publish = function(basePath, options) {

    return callNPM(basePath, [
        "publish"
    ], options);
}

function callNPM(basePath, args, options) {
    
    options = options || {};
    
    var deferred = Q.defer();
    
    TERM.stdout.writenl("\0cyan(Running: npm " + args.join(" ") + " (cwd: " + basePath + ")\0)");

    var opts = {
        cwd: basePath
    };
    if (options.env) {
        opts.env = UTIL.copy(process.env);
        for (var key in options.env) {
            opts.env[key] = options.env[key];
        }
    }

    var proc = SPAWN("npm", args, opts);
    var buffer = "";

    proc.on("error", function(err) {
        deferred.reject(err);
    });
    
    proc.stdout.on("data", function(data) {
        TERM.stdout.write(data.toString());
        buffer += data.toString();
    });
    proc.stderr.on("data", function(data) {
        TERM.stderr.write(data.toString());
        buffer += data.toString();
    });
    proc.on("exit", function(code) {
        if (code !== 0) {
            deferred.reject(new Error("NPM error: " + buffer));
            return;
        }
        if (/npm ERR!/.test(buffer)) {
            
            // WORKAROUND: NPM sometimes gives this error but all seems to be ok.
            if (/cb\(\) never called!/.test()) {

                TERM.stdout.writenl("\0red(IGNORING NPM EXIT > 0 AND HOPING ALL OK!\0)");

            } else {

                deferred.reject(new Error("NPM error: " + buffer));
                return;
            }
        }
        deferred.resolve();
    });

    return deferred.promise;
}

