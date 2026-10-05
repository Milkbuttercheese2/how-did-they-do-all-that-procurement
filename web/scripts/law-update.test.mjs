import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteFile, fetchWithRetry, resolveCli, runLawCli, scrubError } from "./lib/law-update.mjs";
import { main, processFile } from "./populate-article-texts.mjs";

function fixture(t, sources = [{ law: "테스트법", mst: "123" }], bases = ["제1조", "제2조"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "law-update-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "test.json");
  const data = {
    verification: { sources, articleTexts: { old: { text: "기존 데이터 보존" } } },
    process: { nodes: [{ legal_basis: bases.map((article) => ({ law: "테스트법", article })) }] },
  };
  const bytes = JSON.stringify(data, null, 3) + "\n\n";
  fs.writeFileSync(file, bytes);
  return { dir, file, bytes, data };
}

const output = "제1조(목적)\n첫 조문 본문\n제2조(정의)\n둘째 조문 본문";

test("CLI command names run directly while JS paths use current node", () => {
  assert.deepEqual(resolveCli("korean-law"), { command: "korean-law", args: [] });
  for (const ext of ["js", "mjs", "cjs"]) {
    assert.deepEqual(resolveCli(`/tmp/cli.${ext}`), { command: process.execPath, args: [`/tmp/cli.${ext}`] });
  }
  const calls = [];
  const result = runLawCli(["get_batch_articles", "--mst", "123"], {
    cli: "korean-law", spawn: (...args) => {
      calls.push(args);
      return { status: 0, stdout: output, stderr: "warning must not reach body" };
    },
  });
  assert.equal(result, output);
  assert.equal(calls.length, 1); // CLI already retries internally.
  assert.deepEqual(calls[0].slice(0, 2), ["korean-law", ["get_batch_articles", "--mst", "123"]]);
  assert.equal(calls[0][2].timeout, 120_000);
});

test("CLI launch, exit, signal and timeout errors include diagnosis, never output", () => {
  const cases = [
    { status: 2, stderr: "auth error" },
    { status: null, signal: "SIGTERM" },
    { status: null, error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
    { status: null, error: Object.assign(new Error("not found"), { code: "ENOENT" }) },
  ];
  for (const result of cases) {
    assert.throws(() => runLawCli(["get_law_text"], { spawn: () => ({ ...result, stdout: output }) }), /CLI get_law_text failed/);
  }
  assert.throws(() => runLawCli(["x"], { spawn: () => ({ status: 1, stderr: "explanation" }) }), /explanation/);
  for (const stdout of ["", "  ", "[ERROR] bad", "[NOT_FOUND] missing", "[NETWORK_ERROR] timeout"]) {
    assert.throws(() => runLawCli(["x"], { spawn: () => ({ status: 0, stdout }) }), /empty\/error/);
  }
});

test("real executable and JS entrypoint invocation both work without a shell", (t) => {
  const f = fixture(t);
  for (const name of ["fake-korean-law", "fake cli.mjs"]) {
    const cli = path.join(f.dir, name);
    fs.writeFileSync(cli, `#!${process.execPath}\nconsole.log(process.argv.slice(2).join('|'));\n`, { mode: 0o755 });
    assert.equal(runLawCli(["get_batch_articles", "literal;no-shell"], { cli }).trim(), "get_batch_articles|literal;no-shell");
  }
});

test("real CLI timeout and nonzero stderr are surfaced", (t) => {
  const f = fixture(t);
  const cli = path.join(f.dir, "fake.mjs");
  fs.writeFileSync(cli, "console.error('fixture exit diagnosis'); process.exit(7);\n");
  assert.throws(() => runLawCli(["get_law_text"], { cli }), /exit=7.*fixture exit diagnosis/s);
  fs.writeFileSync(cli, "setInterval(() => {}, 1000);\n");
  assert.throws(() => runLawCli(["get_law_text"], { cli, timeoutMs: 50 }), /ETIMEDOUT/);
});

for (const [name, runCli] of [
  ["CLI failure", () => { throw new Error("CLI exit=1"); }],
  ["empty retrieval", () => ""],
  ["partial retrieval", () => "제1조(목적)\n성공한 조문"],
  ["error beside a valid article", () => `${output}\n[ERROR] partial failure`],
  ["network error beside a valid article", () => `${output}\n[NETWORK_ERROR] partial timeout`],
  ["truncated output with every requested header", () => `${output}\n⚠️ 응답이 너무 길어 50,000자로 잘렸습니다.`],
]) {
  test(`${name} keeps the complete institution bytes`, async (t) => {
    const f = fixture(t);
    await assert.rejects(processFile("test.json", { dataDir: f.dir, runCli }));
    assert.equal(fs.readFileSync(f.file, "utf8"), f.bytes);
    assert.deepEqual(fs.readdirSync(f.dir), ["test.json"]);
  });
}

test("a later batch failure preserves previously retrieved article data", async (t) => {
  const f = fixture(t, undefined, Array.from({ length: 21 }, (_, i) => `제${i + 1}조`));
  let calls = 0;
  await assert.rejects(processFile("test.json", { dataDir: f.dir, runCli: () => {
    if (++calls === 2) throw new Error("second batch timeout");
    return output;
  } }), /second batch/);
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(f.file, "utf8"), f.bytes);
});

test("admin-rule fallback failure leaves institution bytes intact", async (t) => {
  const f = fixture(t, [{ law: "테스트법", adminRuleSerial: "123" }]);
  await assert.rejects(processFile("test.json", {
    dataDir: f.dir, runCli: () => `${output}\n응답이 너무 길어`,
    fetchFull: async () => { throw new Error("fallback timeout"); },
  }), /fallback timeout/);
  assert.equal(fs.readFileSync(f.file, "utf8"), f.bytes);
});

test("admin-rule fallback must recover the final cut article, even with its CLI header present", async (t) => {
  const f = fixture(t, [{ law: "테스트법", adminRuleSerial: "123" }]);
  const runCli = () => `${output}\n응답이 너무 길어`;
  await assert.rejects(processFile("test.json", {
    dataDir: f.dir, runCli, fetchFull: () => "제1조(목적)\n앞부분만",
  }), /누락/);
  assert.equal(fs.readFileSync(f.file, "utf8"), f.bytes);
  await processFile("test.json", {
    dataDir: f.dir, runCli, fetchFull: () => "제1조(목적)\n다른 앞부분\n제2조(정의)\n완전한 마지막 조문",
  });
  const texts = JSON.parse(fs.readFileSync(f.file, "utf8")).verification.articleTexts;
  assert.equal(texts["테스트법::제1조"].text, "첫 조문 본문");
  assert.equal(texts["테스트법::제2조"].text, "완전한 마지막 조문");
});

test("complete article refresh atomically replaces only articleTexts", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await processFile("test.json", { dataDir: f.dir, runCli: () => output }), { file: "test.json", filled: 2 });
  const written = JSON.parse(fs.readFileSync(f.file, "utf8"));
  assert.equal(written.verification.articleTexts["테스트법::제2조"].text, "둘째 조문 본문");
  assert.deepEqual(written.process, f.data.process);
  assert.deepEqual(fs.readdirSync(f.dir), ["test.json"]);
});

test("main writes scrubbed failure report and signals nonzero", async (t) => {
  const f = fixture(t);
  const priorOc = process.env.LAW_OC;
  const priorExit = process.exitCode;
  process.env.LAW_OC = "fixture-secret";
  try {
    const result = await main({ dataDir: f.dir, reportDir: path.join(f.dir, "reports"), runCli: () => {
      throw new Error("timeout https://law.go.kr/?OC=fixture-secret fixture-secret");
    } });
    assert.equal(result.failures.length, 1);
    assert.equal(process.exitCode, 1);
    assert.equal(fs.readFileSync(f.file, "utf8"), f.bytes);
    const report = fs.readFileSync(path.join(f.dir, "reports", "article-texts.json"), "utf8");
    assert.doesNotMatch(report, /fixture-secret|https:\/\//);
    assert.match(report, /preserved/);
  } finally {
    process.exitCode = priorExit;
    if (priorOc === undefined) delete process.env.LAW_OC;
    else process.env.LAW_OC = priorOc;
  }
});

for (const status of [429, 502, 503, 504]) {
  test(`HTTP ${status} retries boundedly and can recover`, async () => {
    let attempts = 0;
    const delays = [];
    const result = await fetchWithRetry("https://example.test", {
      fetchImpl: async () => ++attempts < 3 ? new Response("busy", { status }) : Response.json({ ok: true }),
      sleep: async (delay) => delays.push(delay), random: () => 0,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
  });
}

test("persistent transient failure stops after three attempts", async () => {
  let attempts = 0;
  await assert.rejects(fetchWithRetry("https://example.test", {
    fetchImpl: async () => { attempts++; return new Response("busy", { status: 503 }); },
    sleep: async () => {},
  }), /3 attempt/);
  assert.equal(attempts, 3);
});

test("connection timeouts retry, including fetch cause codes", async () => {
  let attempts = 0;
  const value = await fetchWithRetry("https://example.test", {
    fetchImpl: async () => {
      if (++attempts === 1) throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
      return Response.json({ ok: true });
    }, sleep: async () => {},
  });
  assert.equal(attempts, 2);
  assert.equal(value.ok, true);
});

test("timeout covers stalled response body, then aborts and retries", async () => {
  let attempts = 0;
  const signals = [];
  const result = await fetchWithRetry("https://example.test", {
    timeoutMs: 5, sleep: async () => {},
    fetchImpl: async (_, { signal }) => {
      signals.push(signal);
      attempts++;
      return { ok: true, json: () => attempts === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true }) };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
  assert.equal(signals[0].aborted, true);
});

for (const status of [400, 401, 403, 404, 500]) {
  test(`HTTP ${status} is not retried`, async () => {
    let attempts = 0;
    await assert.rejects(fetchWithRetry("https://example.test", {
      fetchImpl: async () => { attempts++; return new Response("error", { status }); },
      sleep: async () => assert.fail("must not retry"),
    }), new RegExp(`HTTP ${status}`));
    assert.equal(attempts, 1);
  });
}

test("HTML and malformed JSON fail once without becoming empty results", async () => {
  for (const body of ["<html>authentication failed</html>", "{broken", ""]) {
    let attempts = 0;
    await assert.rejects(fetchWithRetry("https://example.test", {
      fetchImpl: async () => { attempts++; return new Response(body); },
      sleep: async () => assert.fail("must not retry malformed JSON"),
    }), /1 attempt/);
    assert.equal(attempts, 1);
  }
});

test("atomic writes replace successfully and leave no temporary file", (t) => {
  const f = fixture(t);
  atomicWriteFile(f.file, "replacement\n");
  assert.equal(fs.readFileSync(f.file, "utf8"), "replacement\n");
  assert.deepEqual(fs.readdirSync(f.dir), ["test.json"]);
});

test("errors scrub credentials and complete request URLs", () => {
  const result = scrubError("failed https://www.law.go.kr/DRF?OC=abc%2Bdef OC=abc+def abc+def", ["abc+def"]);
  assert.doesNotMatch(result, /https|abc/);
});
