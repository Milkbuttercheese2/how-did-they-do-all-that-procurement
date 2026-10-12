// Dependency-free: this must also run when npm ci or a mandatory collection step fails.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scrubError } from "./lib/law-update.mjs";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPORT_DIR = process.env.LAW_UPDATE_REPORT_DIR ?? path.join(REPO_DIR, "web", ".law-autoupdate-report");
const BASELINE_PATH = path.join(REPORT_DIR, "baseline.json");
const STEP_IDS = [
  "checkout", "baseline", "setup", "dependencies", "cli", "cache", "article_verify",
  "article_texts", "annex_index", "annex_texts", "annex_refs", "audit", "citation_audit", "freshness", "commit",
];
const COLLECTION_IDS = ["cache", "article_verify", "article_texts", "annex_index", "annex_texts", "annex_refs"];
const INPUTS = {
  cache: "sources/law-cache/fetch-report.json",
  article_verify: "docs/article-verification-coverage.json",
  article_texts: path.join(REPORT_DIR, "article-texts.json"),
  annex_index: path.join(REPORT_DIR, "annex-index.json"),
  annex_texts: path.join(REPORT_DIR, "annex-texts.json"),
  audit: "docs/full-audit-report.json",
  citation_audit: "docs/citation-content-report.json",
  freshness: "web/freshness-summary.md",
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileStamp(relative) {
  try {
    const stat = fs.statSync(path.resolve(REPO_DIR, relative));
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function scrub(value) {
  if (typeof value === "string") return scrubError(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrubError(key), scrub(item)]));
  }
  return value;
}

function safeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : null;
}

fs.mkdirSync(REPORT_DIR, { recursive: true });
if (process.argv.includes("--capture-baseline")) {
  const baseline = { capturedAt: new Date().toISOString(), auditDate: null, files: {} };
  try {
    // Read Git, not the working copy: later steps may overwrite the audit or commit it.
    const audit = JSON.parse(execFileSync("git", ["show", "HEAD:docs/full-audit-report.json"], {
      cwd: REPO_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    baseline.auditDate = safeDate(audit.checkedAt);
  } catch (error) {
    baseline.error = scrubError(error);
  }
  baseline.files = Object.fromEntries(Object.values(INPUTS).map((file) => [file, fileStamp(file)]));
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
} else {
  let baseline = {};
  let stepData = {};
  const diagnostics = [];
  try { baseline = readJson(BASELINE_PATH); }
  catch (error) { diagnostics.push(`Baseline unavailable: ${scrubError(error)}`); }
  try { stepData = JSON.parse(process.env.LAW_UPDATE_STEPS ?? "{}"); }
  catch (error) { diagnostics.push(`Step outcomes unavailable: ${scrubError(error)}`); }
  const steps = Object.fromEntries(STEP_IDS.map((id) => {
    const outcome = stepData[id]?.outcome;
    return [id, ["success", "failure", "cancelled", "skipped"].includes(outcome) ? outcome : "skipped"];
  }));
  const reports = {};
  for (const [id, relative] of Object.entries(INPUTS)) {
    if (!["success", "failure"].includes(steps[id])) {
      reports[id] = { status: "skipped" };
      continue;
    }
    // Never present yesterday's committed report as evidence of today's failed attempt.
    const stamp = fileStamp(relative);
    if (!stamp || !baseline.files || stamp === baseline.files[relative]) {
      reports[id] = { status: "not-produced-this-run" };
      continue;
    }
    try {
      const absolute = path.resolve(REPO_DIR, relative);
      let detail = relative.endsWith(".json") ? readJson(absolute) : { text: fs.readFileSync(absolute, "utf8") };
      if (id === "audit") detail = { checkedAt: detail.checkedAt, citations: detail.citations, summary: detail.summary };
      if (id === "citation_audit") detail = { checkedAt: detail.checkedAt, checked: detail.checked, mismatches: detail.mismatches };
      if (id === "article_verify") {
        // The aggregate counts suffice here; don't copy all institution data into a CI artifact.
        detail = Object.fromEntries(Object.entries(detail).filter(([, value]) => !Array.isArray(value)));
      }
      reports[id] = { status: "produced-this-run", detail: scrub(detail) };
    } catch (error) {
      reports[id] = { status: "unreadable", error: scrubError(error) };
    }
  }
  const collected = COLLECTION_IDS.every((id) => steps[id] === "success");
  const audited = ["audit", "citation_audit"].every((id) => steps[id] === "success");
  const report = {
    runAt: new Date().toISOString(),
    lastCommittedAuditDate: safeDate(baseline.auditDate),
    collectionStatus: collected ? "success" : "incomplete",
    mechanicalAuditStatus: audited ? "completed" : "incomplete",
    contentReviewStatus: "not-performed-by-this-workflow",
    publicationStatus: steps.commit === "success" ? "completed-or-no-changes"
      : steps.commit === "skipped" ? "not-attempted" : "failed-or-unconfirmed",
    steps, reports, diagnostics,
  };
  const lines = [
    "# Law auto-update result", "",
    `Last committed audit date at checkout: ${report.lastCommittedAuditDate ?? "unknown"}`,
    `Collection: ${report.collectionStatus}`,
    `Mechanical audits: ${report.mechanicalAuditStatus}`,
    `Publication: ${report.publicationStatus} (commit step: ${steps.commit})`,
    "Content review: not performed by this workflow. Collection success and machine checks do not establish that the legal content has been reviewed.",
    "AI review and deployment remain separate steps.", "",
    "## Step outcomes", ...Object.entries(steps).map(([id, outcome]) => `- ${id}: ${outcome}`), "",
    "## Reports from this attempt",
    ...Object.entries(reports).map(([id, value]) => `- ${id}: ${value.status}`),
  ];
  const cache = reports.cache?.detail;
  if (Number.isInteger(cache?.completed) && Number.isInteger(cache?.requested)) {
    lines.push(`- Local cache refresh: ${cache.completed}/${cache.requested} files refreshed; ${cache.failures?.length ?? 0} failures. This does not mean all working-tree files were preserved.`);
    if (steps.commit === "skipped") lines.push("- Commit skipped: any partial local cache refresh was not committed or published by this run.");
  }
  const articleFailures = reports.article_texts?.detail?.failures ?? [];
  if (articleFailures.length) {
    const preserved = articleFailures.filter((failure) => failure?.preserved === true).length;
    lines.push(`- Article data preservation: ${preserved}/${articleFailures.length} failed institution files preserved; other institution files may have refreshed locally.`);
  }
  for (const id of ["annex_index", "annex_texts"]) {
    const detail = reports[id]?.detail;
    if (detail?.preserved === true) lines.push(`- ${id}: last-known-good output preserved after failed collection.`);
  }
  for (const [id, value] of Object.entries(reports)) {
    for (const failure of value.detail?.failures ?? []) {
      const detail = typeof failure === "string" ? failure : `${failure.name ?? failure.file ?? ""} ${failure.note ?? failure.reason ?? failure.error ?? "collection failed"}`;
      lines.push(`- ${id}: ${scrubError(detail).replace(/\s+/g, " ")}`);
    }
    if (value.error) lines.push(`- ${id}: ${value.error.replace(/\s+/g, " ")}`);
  }
  if (reports.audit?.detail) lines.push(`- Current mechanical findings: ${JSON.stringify(reports.audit.detail.summary)}`);
  if (reports.citation_audit?.detail) lines.push(`- Current citation mismatches: ${reports.citation_audit.detail.mismatches}`);
  if (baseline.error) lines.push(`- Baseline: ${scrubError(baseline.error).replace(/\s+/g, " ")}`);
  lines.push(...diagnostics.map((line) => `- ${line.replace(/\s+/g, " ")}`), "");
  const markdown = lines.join("\n");
  fs.writeFileSync(path.join(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(REPORT_DIR, "report.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
}
