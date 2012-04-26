/**
 * This script runs for all packages once the top-level [program] package that triggered
 * all dependency packages to be installed has finished installing.
 * 
 * CWD is always the path of the top-level package.
 * 
 * TODO: Add support for this to NPM. See: https://github.com/isaacs/npm/issues/2354
 */

// TODO: Prevent this from running multiple times if multiple packages have the
//       "mappings" package set as a dependency.

require("sourcemint-pm-sm/lib/pm").forProgramPath(process.cwd()).then(function(pm) {
    return pm.install();
}).then(function() {
    process.exit(0);
}).fail(function(err) {
    require("sourcemint-util-js/lib/error").print(err);
    process.exit(1);
});
