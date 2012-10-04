
if (process.env.SM_CLI_CALL !== "true") {
    process.stdout.write("--------------------------------------------------------------------------------------------------------------------" + "\n");
    process.stdout.write("|  Use the `sm` command (`npm install -g sm`) to `sm [install|update|run|test|deploy|...] .` this package/program. |" + "\n");
    process.stdout.write("--------------------------------------------------------------------------------------------------------------------" + "\n");
}
