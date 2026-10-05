// Small failure-safety helpers for law refresh scripts. The CLI has its own retry;
// fetchWithRetry is only for direct HTTP requests, including reading their bodies.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_CLI = fileURLToPath(new URL("../../node_modules/korean-law-mcp/build/cli.js", import.meta.url));
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const RETRY_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

export function scrubError(error, secrets = [process.env.LAW_OC]) {
  let text = String(error?.message ?? error ?? "Unknown error");
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, "[request URL removed]")
    .replace(/\bOC\s*[=:]\s*[^\s&]+/gi, "OC=[redacted]");
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(secret).join("[redacted]")
      .split(encodeURIComponent(secret)).join("[redacted]");
  }
  return text.slice(0, 1200);
}

export function isMain(url) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
}

export function atomicWriteFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, contents, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function resolveCli(cli = process.env.KOREAN_LAW_CLI) {
  const entry = cli || (fs.existsSync(LOCAL_CLI) ? LOCAL_CLI : "korean-law");
  return /\.(?:mjs|cjs|js)$/i.test(entry)
    ? { command: process.execPath, args: [entry] }
    : { command: entry, args: [] };
}

export function runLawCli(args, { cli, spawn = spawnSync, timeoutMs = 120_000 } = {}) {
  const invocation = resolveCli(cli);
  const result = spawn(invocation.command, [...invocation.args, ...args], {
    encoding: "utf8", env: { ...process.env },
    maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(scrubError([
      `CLI ${args[0]} failed (exit=${result.status ?? "none"}, signal=${result.signal ?? "none"}, code=${result.error?.code ?? "none"})`,
      result.error?.message, result.stderr,
    ].filter(Boolean).join("; ")));
  }
  const output = (result.stdout || "").split("\n").filter((line) =>
    !/^\(node:\d+\)/.test(line) && !/UNDICI|EnvHttpProxyAgent|--trace-warnings/.test(line),
  ).join("\n");
  if (!output.trim() || /^\[(?:ERROR|NOT_FOUND|[A-Z_]+_ERROR)\]/m.test(output)) {
    throw new Error(scrubError(`CLI ${args[0]} returned empty/error output: ${output} ${result.stderr || ""}`));
  }
  return output;
}

function transient(error) {
  return error?.name === "TimeoutError" || RETRY_CODES.has(error?.code) ||
    RETRY_CODES.has(error?.cause?.code) || RETRY_STATUS.has(error?.status);
}

export async function fetchWithRetry(url, {
  fetchImpl = fetch, timeoutMs = 30_000, maxAttempts = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random, read = (response) => response.json(),
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid bounded request limits");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { signal: controller.signal });
          if (!response.ok) {
            // No error body/URL is copied into logs; it can include credentials.
            await response.body?.cancel();
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          return await read(response);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Request/body timeout after ${timeoutMs}ms`);
            error.name = "TimeoutError";
            reject(error);
            controller.abort(error);
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (attempt === maxAttempts || !transient(error)) {
        throw new Error(scrubError(`Request failed after ${attempt} attempt(s): ${error?.message ?? error}`));
      }
    } finally {
      clearTimeout(timer);
    }
    await sleep(1000 * 2 ** (attempt - 1) + Math.floor(random() * 250));
  }
}
