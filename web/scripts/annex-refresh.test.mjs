import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listAnnexes, parseAnnexPage, populateAnnexes, scrubKey } from "./populate-annexes.mjs";
import { annexFileUrls, documentExtension, populateAnnexTexts } from "./populate-annex-texts.mjs";

const law = "시험법";
const logger = { log() {}, warn() {} };
const requestOptions = { oc: "fixture-key", sleep: async () => {}, random: () => 0 };
const prior = '{ "keep" : { "text": "last known good" } }\n\n';
const pdf = Buffer.from("%PDF-1.7\nfixture document");
function row(overrides = {}) {
  return { 관련법령명: law, 별표번호: "000100", 별표명: "시험표", 별표종류: "별표", 별표서식파일링크: "/LSW/flDownload.do?flSeq=1&OC=fixture-key", ...overrides };
}
function payload(rows, { target = "licbyl", total = Array.isArray(rows) ? rows.length : 1, page = 1 } = {}) {
  const [root, key] = target === "licbyl" ? ["licBylSearch", "licbyl"] : ["admRulBylSearch", "admrulbyl"];
  return { [root]: { totalCnt: String(total), page: String(page), ...(rows === undefined ? {} : { [key]: rows }) } };
}
function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function fixtures(t, { text = "별표 1에 따른다", index = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "annex-refresh-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const articlesDir = path.join(dir, "articles");
  const institutionsDir = path.join(dir, "institutions");
  fs.mkdirSync(articlesDir); fs.mkdirSync(institutionsDir);
  fs.writeFileSync(path.join(articlesDir, "fixture.json"), JSON.stringify({ articles: [{ law, text }] }));
  const indexFile = path.join(dir, "index.json");
  const outFile = path.join(dir, "out.json");
  fs.writeFileSync(indexFile, JSON.stringify(index));
  fs.writeFileSync(outFile, prior);
  return { dir, articlesDir, institutionsDir, indexFile, outFile, logger, reportDir: path.join(dir, "reports") };
}
function meta(overrides = {}) {
  return { law, annex: "별표1", kind: "별표", title: "시험표", hwpUrl: "https://files.test/one", ...overrides };
}
function unchanged(f) { assert.equal(fs.readFileSync(f.outFile, "utf8"), prior); }
function report(f, name) { return JSON.parse(fs.readFileSync(path.join(f.reportDir, `${name}.json`), "utf8")); }

for (const target of ["licbyl", "admbyl"]) {
  test(`${target} accepts the documented array and singleton row shapes`, () => {
    const r = target === "licbyl" ? row() : row({ 관련행정규칙명: law });
    assert.deepEqual(parseAnnexPage(payload([r], { target }), target).rows, [r]);
    assert.deepEqual(parseAnnexPage(payload(r, { target }), target).rows, [r]);
    assert.deepEqual(parseAnnexPage(payload(undefined, { target, total: 0 }), target), { rows: [], total: 0 });
    assert.deepEqual(parseAnnexPage(payload([], { target, total: 0 }), target), { rows: [], total: 0 });
  });
}

test("rejects malformed roots, unknown row keys, invalid counts, and partial page shapes", () => {
  for (const bad of [
    null, [], {}, { error: "unauthorized" }, { licBylSearch: [] },
    { licBylSearch: { totalCnt: 1, unrelated: [row()] } },
    { licBylSearch: { totalCnt: 0, unrelated: [row()] } },
    { licBylSearch: { totalCnt: 0, unrelated: row() } },
    { licBylSearch: { totalCnt: 1, licbyl: null } },
    { licBylSearch: { totalCnt: 1, licbyl: "error" } },
    { licBylSearch: { totalCnt: 0, licbyl: [row()] } },
    ...[null, "", "bad", -1, 1.1, true, Infinity].map((totalCnt) => ({ licBylSearch: { totalCnt, licbyl: [] } })),
    payload([], { total: 1 }), payload([{}]), payload([row()], { total: 2 }),
    payload([row()], { page: 2 }),
  ]) assert.throws(() => parseAnnexPage(bad, "licbyl"));
});

test("authentic zero falls back to the administrative endpoint", async () => {
  const calls = [];
  const found = await listAnnexes(law, { ...requestOptions, fetchImpl: async (url) => {
    const target = new URL(url).searchParams.get("target"); calls.push(target);
    return response(target === "licbyl" ? payload(undefined, { total: 0 }) : payload(row({ 관련행정규칙명: law }), { target }));
  } });
  assert.equal(found.admRule, true); assert.equal(found.rows.length, 1);
  assert.deepEqual(calls, ["licbyl", "admbyl"]);
});

test("authentic zero in both endpoints is a valid empty search", async () => {
  const found = await listAnnexes(law, { ...requestOptions, fetchImpl: async (url) => response(payload(undefined, { target: new URL(url).searchParams.get("target"), total: 0 })) });
  assert.deepEqual(found, { rows: [], admRule: false });
});

test("HTML is a failure, not an empty search or a fallback trigger", async () => {
  let calls = 0;
  await assert.rejects(listAnnexes(law, { ...requestOptions, fetchImpl: async () => { calls += 1; return new Response("<html>error</html>"); } }));
  assert.equal(calls, 1);
});

test("paginated searches require every page and stable totals", async () => {
  const first = Array.from({ length: 100 }, (_, i) => row({ 별표일련번호: String(i) }));
  const calls = [];
  const found = await listAnnexes(law, { ...requestOptions, fetchImpl: async (url) => {
    const page = Number(new URL(url).searchParams.get("page")); calls.push(page);
    return response(payload(page === 1 ? first : row({ 별표번호: "000200" }), { total: 101, page }));
  } });
  assert.equal(found.rows.length, 101); assert.deepEqual(calls, [1, 2]);
  for (const second of [payload([], { total: 101, page: 2 }), payload([row()], { total: 102, page: 2 })]) {
    let count = 0;
    await assert.rejects(listAnnexes(law, { ...requestOptions, fetchImpl: async () => response(++count === 1 ? payload(first, { total: 101 }) : second) }));
  }
});

test("catalog retries transient failure then atomically writes complete, key-free output", async (t) => {
  const f = fixtures(t); let calls = 0;
  await populateAnnexes({ ...f, ...requestOptions, fetchImpl: async () => { unchanged(f); return ++calls === 1 ? response({}, 503) : response(payload(row())); } });
  assert.equal(calls, 2);
  const result = JSON.parse(fs.readFileSync(f.outFile, "utf8"));
  assert.equal(result[`${law}::별표1`].hwpUrl, "https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
  assert.equal(fs.readFileSync(f.outFile, "utf8").includes("fixture-key"), false);
  assert.equal(report(f, "annex-index").preserved, false);
  assert.equal(report(f, "annex-index").succeeded, 1);
  assert.deepEqual(fs.readdirSync(f.dir).filter((name) => name.endsWith(".tmp")), []);
});

for (const mode of ["HTTP failure", "malformed", "zero", "missing requested row", "empty inputs"]) {
  test(`catalog preserves prior bytes on ${mode}`, async (t) => {
    const f = fixtures(t, { text: mode === "missing requested row" ? "별표 1 및 별표 2" : mode === "empty inputs" ? "참조 없음" : undefined });
    await assert.rejects(populateAnnexes({ ...f, ...requestOptions, fetchImpl: async (url) => {
      if (mode === "HTTP failure") return response({}, 400);
      if (mode === "malformed") return response({ error: "not a result" });
      return response(mode === "zero" ? payload([], { target: new URL(url).searchParams.get("target"), total: 0 }) : payload(row()));
    } }));
    unchanged(f); assert.equal(report(f, "annex-index").preserved, true);
  });
}

test("catalog preserves complete prior file when the second page fails", async (t) => {
  const f = fixtures(t);
  const first = Array.from({ length: 100 }, (_, i) => row({ 별표일련번호: String(i) }));
  await assert.rejects(populateAnnexes({ ...f, ...requestOptions, fetchImpl: async (url) => new URL(url).searchParams.get("page") === "1" ? response(payload(first, { total: 101 })) : response({}, 503) }));
  unchanged(f);
});

test("scrubbed links support relative and absolute URLs and case-insensitive OC", () => {
  assert.equal(scrubKey("/LSW/flDownload.do?OC=secret&flSeq=1&oc=second"), "https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
  assert.equal(scrubKey("https://www.law.go.kr/LSW/flDownload.do?flSeq=1&Oc=secret"), "https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
  assert.throws(() => scrubKey("javascript:alert(1)"));
});

test("download candidates prefer current HWP/PDF links and retain legacy compatibility", () => {
  assert.deepEqual(annexFileUrls(meta({ pdfUrl: "https://files.test/two", fileUrl: "https://files.test/three" })), ["https://files.test/one", "https://files.test/two", "https://files.test/three"]);
  assert.deepEqual(annexFileUrls(meta({ hwpUrl: undefined, fileUrl: "https://files.test/old" })), ["https://files.test/old"]);
});

test("signature detection rejects HTML and truncated/unknown downloads", () => {
  assert.equal(documentExtension(pdf), "pdf");
  assert.equal(documentExtension(Buffer.from("d0cf11e0a1b11ae1", "hex")), "hwp");
  assert.equal(documentExtension(Buffer.from("504b0304", "hex")), "hwpx");
  for (const data of [Buffer.alloc(0), Buffer.from("<html>error</html>"), Buffer.from("d0cf11e0", "hex"), Buffer.from("PK")]) assert.throws(() => documentExtension(data));
});

for (const field of ["hwpUrl", "pdfUrl", "fileUrl"]) {
  test(`texts consume ${field} and preserve forms without fetching`, async (t) => {
    const f = fixtures(t, { index: { table: meta({ hwpUrl: undefined, [field]: "https://files.test/source" }), form: meta({ kind: "서식", hwpUrl: undefined }) } });
    let fetched = 0;
    const result = await populateAnnexTexts({ ...f, ...requestOptions, fetchImpl: async (url) => { unchanged(f); fetched += 1; assert.equal(url, "https://files.test/source"); return new Response(pdf); }, parseImpl: async (file) => { assert.equal(path.extname(file), ".pdf"); return { markdown: "본문" }; } });
    assert.equal(fetched, 1); assert.equal(result.table.text, "본문"); assert.equal(result.form.text, undefined);
    assert.equal(report(f, "annex-texts").preserved, false);
  });
}

test("texts fall back to PDF after a failed HWP download", async (t) => {
  const f = fixtures(t, { index: { table: meta({ pdfUrl: "https://files.test/pdf" }) } });
  const calls = [];
  const result = await populateAnnexTexts({ ...f, ...requestOptions, fetchImpl: async (url) => { calls.push(url); return url.endsWith("pdf") ? new Response(pdf) : response({}, 404); }, parseImpl: async () => ({ text: "PDF 본문" }) });
  assert.equal(result.table.text, "PDF 본문"); assert.deepEqual(calls, ["https://files.test/one", "https://files.test/pdf"]);
});

for (const mode of ["HTTP failure", "HTML", "empty download", "empty parse", "bad parse shape", "parser exception", "missing URL", "empty index"]) {
  test(`texts preserve prior bytes on ${mode}`, async (t) => {
    const f = fixtures(t, { index: mode === "empty index" ? {} : { table: meta(mode === "missing URL" ? { hwpUrl: undefined } : {}) } });
    await assert.rejects(populateAnnexTexts({ ...f, ...requestOptions,
      fetchImpl: async () => mode === "HTTP failure" ? response({}, 503) : new Response(mode === "HTML" ? "<html>error</html>" : mode === "empty download" ? "" : pdf),
      parseImpl: async () => { if (mode === "parser exception") throw new Error("parse failed at https://files.test/document?OC=secret"); return mode === "bad parse shape" ? { text: {} } : { markdown: "  " }; },
    }));
    unchanged(f);
    const r = report(f, "annex-texts"); assert.equal(r.preserved, true); assert.ok(r.failed > 0);
    assert.equal(JSON.stringify(r).includes("OC=secret"), false);
  });
}

test("one failed text leaves even successfully parsed entries uncommitted", async (t) => {
  const f = fixtures(t, { index: { first: meta(), second: meta({ annex: "별표2", hwpUrl: "https://files.test/two" }) } });
  let parsed = 0;
  await assert.rejects(populateAnnexTexts({ ...f, ...requestOptions, fetchImpl: async (url) => url.endsWith("two") ? response({}, 400) : new Response(pdf), parseImpl: async () => { parsed += 1; return { text: "fresh text" }; } }));
  assert.equal(parsed, 1); unchanged(f);
  assert.equal(report(f, "annex-texts").succeeded, 1);
});

test("successful text refresh uses nonempty text fallback and truncates long content", async (t) => {
  const f = fixtures(t, { index: { table: meta() } });
  const result = await populateAnnexTexts({ ...f, ...requestOptions, fetchImpl: async () => new Response(pdf), parseImpl: async () => ({ markdown: "", text: "가".repeat(12001) }) });
  assert.ok(result.table.text.startsWith("가".repeat(12000)));
  assert.ok(result.table.text.includes("이하 생략"));
});

test("repeated pages fail instead of pretending the collection is complete", async () => {
  const first = Array.from({ length: 100 }, (_, i) => row({ 별표일련번호: String(i) }));
  await assert.rejects(listAnnexes(law, { ...requestOptions, fetchImpl: async (url) => response(payload(first, { total: 200, page: Number(new URL(url).searchParams.get("page")) })) }), /페이지 중복/);
});

test("page safety limit fails rather than publishing the first 2000 entries", async () => {
  let calls = 0;
  await assert.rejects(listAnnexes(law, { ...requestOptions, fetchImpl: async (url) => {
    calls += 1;
    const page = Number(new URL(url).searchParams.get("page"));
    return response(payload(Array.from({ length: 100 }, (_, i) => row({ 별표일련번호: `${page}-${i}` })), { total: 2001, page }));
  } }), /페이지 상한/);
  assert.equal(calls, 20);
});

test("download body connection failures are retried before publishing", async (t) => {
  const f = fixtures(t, { index: { table: meta() } });
  let calls = 0;
  const result = await populateAnnexTexts({ ...f, ...requestOptions, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return { ok: true, arrayBuffer: async () => { const error = new Error("connection reset"); error.code = "ECONNRESET"; throw error; } };
    return new Response(pdf);
  }, parseImpl: async () => ({ text: "retried body" }) });
  assert.equal(calls, 2); assert.equal(result.table.text, "retried body");
});
