
const TERM = require("sourcemint-util-js/lib/term");


if (process.env.SM_CLI_CALL !== "true") {
    TERM.stdout.writenl("\0red(" + "------------------------------------------------------------------------------------------------------------" + "\0)");
    TERM.stdout.writenl("\0red(" + "|\0bold(  Use the `sm` command from `npm install -g sm` to `sm [install|update|link|...] .` this package/program. \0)|" + "\0)");
    TERM.stdout.writenl("\0red(" + "------------------------------------------------------------------------------------------------------------" + "\0)");
}
