// AI generated code. Secret lookup. The host passes getSecret(item, field) (preferred), or config.secretCommand
// names an existing helper to run (argv array, no shell) with "{item}" and "{field}" placeholders; stdout is the value.
import { execFile } from "node:child_process";

export function makeSecretGetter({ getSecret, secretCommand, timeoutMs = 30000 } = {}) {
  if (typeof getSecret === "function") return async (item, field) => String((await getSecret(item, field)) ?? "").trim();
  if (Array.isArray(secretCommand) && secretCommand.length > 0) {
    return (item, field) => new Promise((resolve, reject) => {
      const argv = secretCommand.map((a) => String(a).replaceAll("{item}", item).replaceAll("{field}", field));
      execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true }, (err, stdout) => {
        // Never include stdout/stderr in errors: they may hold the secret.
        if (err) return reject(new Error(`secret helper failed for "${item}" (${field}): exit ${err.code ?? "?"}`));
        resolve(String(stdout).trim());
      });
    });
  }
  return async () => { throw new Error("no secret source configured (pass getSecret or set secretCommand)"); };
}
