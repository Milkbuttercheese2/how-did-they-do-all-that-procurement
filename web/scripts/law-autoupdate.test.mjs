import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(SCRIPT_DIR, "../..");
const SECRET = "test-oc+private@example.test";
const workflow = fs.readFileSync(path.join(REPO_DIR, ".github/workflows/law-autoupdate.yml"), "utf8");
const stepBlocks = workflow.split(/\n      - /).slice(1);
const stepBlock = (id) => stepBlocks.find((block) => new RegExp(`\\n        id: ${id}\\n`).test(block));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "law-autoupdate-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["web/scripts/lib", "sources/law-cache", "docs", "bin", "reports"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of ["fetch-law-cache.mjs", "report-law-autoupdate.mjs", "lib/law-update.mjs"]) {
    fs.copyFileSync(path.join(SCRIPT_DIR, file), path.join(root, "web/scripts", file));
  }
  return root;
}

function json(root, relative, value) {
  fs.writeFileSync(path.join(root, relative), JSON.stringify(value));
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function executable(root, name, body) {
  const file = path.join(root, "bin", name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

function runScript(root, script, env = {}, args = []) {
  return spawnSync(process.execPath, [path.join(root, "web/scripts", script), ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: {
      ...process.env, LAW_OC: SECRET, LAW_UPDATE_REPORT_DIR: path.join(root, "reports"),
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
      ...env,
    },
  });
}

function noSecrets(text) {
  assert.ok(!text.includes(SECRET), "raw OC leaked");
  assert.ok(!text.includes(encodeURIComponent(SECRET)), "encoded OC leaked");
  assert.doesNotMatch(text, /https?:\/\//i, "request URL leaked");
}

test("cache partial failure writes report, exits nonzero, preserves failed cache and makes no CLI retries", (t) => {
  const root = fixture(t);
  json(root, "sources/law-cache/law-list.json", { statutes: ["좋은법", "실패법"], adminRules: ["좋은규칙"] });
  fs.writeFileSync(path.join(root, "sources/law-cache/실패법.md"), "last known good cache");
  const cli = executable(root, "cli.mjs", `
    import fs from "node:fs";
    const [command, , value] = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(path.join(root, "calls.log"))}, command + " " + value + "\\n");
    if (command === "search_law") console.log("1. " + value + " [현행]\\nMST: " + (value === "실패법" ? "2" : "1"));
    else if (command === "search_admin_rule") console.log("1. 좋은규칙 [현행]\\n행정규칙일련번호: 3");
    else if (value === "2") {
      console.error("ECONNRESET OC=" + process.env.LAW_OC + " https://law.go.kr/DRF/lawService.do?OC=" + encodeURIComponent(process.env.LAW_OC));
      process.exit(7);
    } else console.log("제1조(목적) " + "유효한 원문 ".repeat(80));
  `);
  const result = runScript(root, "fetch-law-cache.mjs", { KOREAN_LAW_CLI: cli });
  assert.equal(result.status, 1, result.stderr);
  const report = readJson(root, "sources/law-cache/fetch-report.json");
  assert.equal(report.status, "failed");
  assert.equal(report.requested, 3);
  assert.equal(report.completed, 2);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].note, /code=7/);
  assert.match(report.failures[0].note, /ECONNRESET/);
  noSecrets(JSON.stringify(report) + result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "sources/law-cache/실패법.md"), "utf8"), "last known good cache");
  assert.match(fs.readFileSync(path.join(root, "sources/law-cache/좋은법.md"), "utf8"), /유효한 원문/);
  assert.equal(fs.readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n").length, 6);
});

test("failed search cannot supply a plausible MST and empty stderr still retains exit failure", (t) => {
  const root = fixture(t);
  json(root, "sources/law-cache/law-list.json", { statutes: ["시험법"] });
  const cli = executable(root, "cli.mjs", `console.log("1. 시험법 [현행]\\nMST: 11"); process.exit(9);`);
  const result = runScript(root, "fetch-law-cache.mjs", { KOREAN_LAW_CLI: cli });
  assert.equal(result.status, 1);
  assert.match(readJson(root, "sources/law-cache/fetch-report.json").failures[0].note, /code=9/);
  assert.equal(fs.existsSync(path.join(root, "sources/law-cache/시험법.md")), false);
});

test("cache timeouts and missing executables retain actionable error metadata", (t) => {
  for (const missing of [false, true]) {
    const root = fixture(t);
    json(root, "sources/law-cache/law-list.json", { statutes: ["시험법"] });
    const cli = missing ? path.join(root, "absent-cli") : executable(root, "wait.mjs", "setTimeout(() => {}, 60000);");
    const result = runScript(root, "fetch-law-cache.mjs", { KOREAN_LAW_CLI: cli, LAW_CLI_TIMEOUT_MS: "100" });
    assert.equal(result.status, 1);
    const report = readJson(root, "sources/law-cache/fetch-report.json");
    assert.match(report.failures[0].note, missing ? /ENOENT/ : /signal=SIGTERM.*killed=true.*timeout=100ms/);
    noSecrets(JSON.stringify(report));
  }
});

test("zero-exit padded API errors fail collection and missing configuration still produces a report", (t) => {
  for (const missing of [false, true]) {
    const root = fixture(t);
    json(root, "sources/law-cache/law-list.json", { statutes: ["시험법"] });
    const cli = executable(root, "cli.mjs", `
      if (process.argv[2] === "search_law") console.log("1. 시험법 [현행]\\nMST: 11");
      else console.log("[EXTERNAL_API_ERROR] " + "invalid response ".repeat(40));
    `);
    const result = runScript(root, "fetch-law-cache.mjs", { KOREAN_LAW_CLI: cli, ...(missing ? { LAW_OC: "" } : {}) });
    assert.equal(result.status, 1);
    const report = readJson(root, "sources/law-cache/fetch-report.json");
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0].note, missing ? /LAW_OC/ : /EXTERNAL_API_ERROR/);
  }
});

test("successful cache collection remains zero-exit with an empty failures list", (t) => {
  const root = fixture(t);
  json(root, "sources/law-cache/law-list.json", { statutes: ["시험법"] });
  const cli = executable(root, "cli.mjs", `
    console.log(process.argv[2] === "search_law" ? "1. 시험법 [현행]\\nMST: 11" : "제1조 " + "본문 ".repeat(100));
  `);
  const result = runScript(root, "fetch-law-cache.mjs", { KOREAN_LAW_CLI: cli });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(root, "sources/law-cache/fetch-report.json").failures, []);
});

function captureBaseline(root) {
  executable(root, "git", 'process.stdout.write(JSON.stringify({ checkedAt: "2026-09-27" }));');
  const result = runScript(root, "report-law-autoupdate.mjs", {}, ["--capture-baseline"]);
  assert.equal(result.status, 0, result.stderr);
}

test("always-report shows skipped stages, scrubbed failures, and committed audit date instead of stale success", (t) => {
  const root = fixture(t);
  json(root, "docs/full-audit-report.json", { checkedAt: "2099-01-01", summary: { contentMismatch: 0 } });
  json(root, "docs/citation-content-report.json", { checkedAt: "2099-01-01", mismatches: 0 });
  captureBaseline(root);
  json(root, "sources/law-cache/fetch-report.json", { completed: 1, requested: 2, failures: [{ name: "시험법", note: `ECONNRESET OC=${SECRET} https://law.go.kr/?OC=${SECRET}` }] });
  json(root, "reports/annex-index.json", { stage: "annex-index", failed: 1, preserved: true, failures: [`HTTP 503 https://law.go.kr/?OC=${SECRET}`] });
  json(root, "reports/article-texts.json", { files: 2, failures: [{ file: "test.json", failed: true, preserved: true, note: "CLI failed" }] });
  const steps = { checkout: { outcome: "success" }, cache: { outcome: "failure" }, article_texts: { outcome: "failure" }, annex_index: { outcome: "failure" }, citation_audit: { outcome: "failure" } };
  const summary = path.join(root, "summary.md");
  const result = runScript(root, "report-law-autoupdate.mjs", { LAW_UPDATE_STEPS: JSON.stringify(steps), GITHUB_STEP_SUMMARY: summary });
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(root, "reports/report.json");
  assert.equal(report.lastCommittedAuditDate, "2026-09-27");
  assert.equal(report.collectionStatus, "incomplete");
  assert.equal(report.mechanicalAuditStatus, "incomplete");
  assert.equal(report.steps.commit, "skipped");
  assert.equal(report.reports.audit.status, "skipped");
  assert.equal(report.reports.citation_audit.status, "not-produced-this-run");
  assert.equal(report.reports.cache.status, "produced-this-run");
  const markdown = fs.readFileSync(summary, "utf8");
  assert.match(markdown, /ECONNRESET/);
  assert.match(markdown, /annex_index: HTTP 503/);
  assert.equal(report.publicationStatus, "not-attempted");
  assert.match(markdown, /Publication: not-attempted \(commit step: skipped\)/);
  assert.match(markdown, /Local cache refresh: 1\/2 files refreshed; 1 failures/);
  assert.match(markdown, /partial local cache refresh was not committed or published/);
  assert.match(markdown, /1\/1 failed institution files preserved/);
  assert.match(markdown, /annex_index: last-known-good output preserved/);
  assert.match(markdown, /commit: skipped/);
  assert.match(markdown, /Last committed audit date at checkout: 2026-09-27/);
  noSecrets(JSON.stringify(report) + markdown + result.stdout);
});

test("report separates successful collection from legal content review and includes current audit metrics", (t) => {
  const root = fixture(t);
  captureBaseline(root);
  json(root, "docs/full-audit-report.json", { checkedAt: "2026-10-05", citations: 5, summary: { contentMismatch: 2 } });
  json(root, "docs/citation-content-report.json", { checkedAt: "2026-10-05", checked: 5, mismatches: 2 });
  json(root, "reports/article-texts.json", { files: 1, failures: [] });
  const steps = Object.fromEntries(["cache", "article_verify", "article_texts", "annex_index", "annex_texts", "annex_refs", "audit", "citation_audit", "freshness", "commit"].map((id) => [id, { outcome: "success" }]));
  const result = runScript(root, "report-law-autoupdate.mjs", { LAW_UPDATE_STEPS: JSON.stringify(steps) });
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(root, "reports/report.json");
  assert.equal(report.collectionStatus, "success");
  assert.equal(report.publicationStatus, "completed-or-no-changes");
  assert.equal(report.contentReviewStatus, "not-performed-by-this-workflow");
  assert.equal(report.reports.audit.detail.summary.contentMismatch, 2);
  assert.equal(report.reports.article_texts.detail.files, 1);
  assert.equal(report.lastCommittedAuditDate, "2026-09-27");
});

test("report still emits an artifact and skipped outcomes without baseline or valid outcome JSON", (t) => {
  const root = fixture(t);
  const result = runScript(root, "report-law-autoupdate.mjs", { LAW_UPDATE_STEPS: "{" });
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(root, "reports/report.json");
  assert.equal(report.lastCommittedAuditDate, null);
  assert.equal(report.steps.commit, "skipped");
  assert.equal(report.diagnostics.length, 2);
  assert.ok(fs.existsSync(path.join(root, "reports/report.md")));
});

test("workflow requires successful mandatory steps before committing and always reports failures", () => {
  assert.match(stepBlock("commit"), /if: \$\{\{ success\(\) \}\}/);
  for (const id of ["cache", "article_verify", "article_texts", "annex_index", "annex_texts", "annex_refs", "audit", "citation_audit", "freshness"]) {
    const block = stepBlock(id);
    assert.ok(block, `missing mandatory step ${id}`);
    assert.ok(stepBlocks.indexOf(block) < stepBlocks.indexOf(stepBlock("commit")));
    assert.doesNotMatch(block, /continue-on-error|\|\|\s*(?:true|:)|if:.*always/);
  }
  assert.match(stepBlock("freshness"), /run: npm run check:freshness(?:\n|$)/);
  assert.match(stepBlock("report"), /if: \$\{\{ always\(\) \}\}/);
  assert.match(stepBlock("report"), /toJSON\(steps\)/);
  const upload = stepBlocks.find((block) => block.includes("actions/upload-artifact"));
  assert.match(upload, /if: \$\{\{ always\(\) \}\}/);
  assert.match(upload, /env\.LAW_UPDATE_REPORT_DIR.*\/report\.\*/);
});

function runCommit(t, env = {}) {
  const root = fixture(t);
  const log = path.join(root, "git-calls.log");
  executable(root, "git", `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    fs.appendFileSync(process.env.GIT_STUB_LOG, args.join(" ") + "\\n");
    if (args[0] === "diff") process.exit(process.env.NO_CHANGES === "1" ? 0 : 1);
    if (args[0] === "pull" && process.env.PULL_FAIL === "1") process.exit(1);
    if (args[0] === "push") {
      const count = fs.readFileSync(process.env.GIT_STUB_LOG, "utf8").split("\\n").filter((line) => line.startsWith("push ")).length;
      process.exit(count <= Number(process.env.FAIL_PUSHES || 0) ? 1 : 0);
    }
  `);
  executable(root, "sleep", "process.exit(0);");
  const script = stepBlock("commit").match(/\n        run: \|\n([\s\S]*)$/)[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, GIT_STUB_LOG: log, UPDATE_BRANCH: "test-branch", ...env },
  });
  return { result, calls: fs.readFileSync(log, "utf8").trim().split("\n") };
}

test("actual workflow commit shell exits nonzero after five exhausted push retries", (t) => {
  const { result, calls } = runCommit(t, { FAIL_PUSHES: "5" });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(calls.filter((line) => line.startsWith("push ")).length, 5);
  assert.match(result.stderr, /Push failed after 5 attempts/);
});

test("actual workflow commit shell handles transient push failure, pull failure, and unchanged data", (t) => {
  const recovered = runCommit(t, { FAIL_PUSHES: "2" });
  assert.equal(recovered.result.status, 0, recovered.result.stderr);
  assert.equal(recovered.calls.filter((line) => line.startsWith("push ")).length, 3);
  const pullFailed = runCommit(t, { PULL_FAIL: "1" });
  assert.equal(pullFailed.result.status, 1);
  assert.equal(pullFailed.calls.filter((line) => line.startsWith("pull ")).length, 5);
  assert.equal(pullFailed.calls.filter((line) => line.startsWith("push ")).length, 0);
  const unchanged = runCommit(t, { NO_CHANGES: "1" });
  assert.equal(unchanged.result.status, 0);
  assert.equal(unchanged.calls.filter((line) => /^(commit|pull|push) /.test(line)).length, 0);
});


test("workflow report paths use contexts valid at job and step scope", () => {
  const beforeSteps = workflow.split("    steps:", 1)[0];
  assert.doesNotMatch(beforeSteps, /\$\{\{\s*runner\./);
  assert.match(beforeSteps, /LAW_UPDATE_REPORT_DIR: \$\{\{ github\.workspace \}\}\/\.law-autoupdate-report/);
  assert.match(workflow, /path: \$\{\{ env\.LAW_UPDATE_REPORT_DIR \}\}\/report\.\*/);
});
