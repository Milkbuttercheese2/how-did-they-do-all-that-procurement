// 별표 본문을 내려받아 파싱한다.
//
// 앞서 별표는 제목과 링크만 담았다. HWP 표를 텍스트로 옮기면 행·열 관계가 깨져
// 어설픈 텍스트가 오히려 틀린 근거가 된다고 봤기 때문이다. kordoc이 병합셀까지
// 살려 HTML 표로 뽑아주는 것을 확인해서, 본문을 담는 쪽으로 바꾼다.
//
// 이게 왜 필요한가: "공사수행능력 신인도평가"처럼 답이 별표 안에만 있는 질문은
// 제도를 정확히 골라도 근거를 못 만들어 답변이 0건이었다. 제재기간·적격심사
// 배점처럼 실무에서 제일 자주 묻는 수치가 대부분 별표에 있다.
//
// 수집은 저작 시점에 한 번 한다. 운영(Worker)은 정적 자산만 읽는다.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { atomicWriteFile, fetchWithRetry, isMain, scrubError } from "./lib/law-update.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_FILE = path.join(WEB_DIR, "data", "annexes.json");
const OUT_FILE = path.join(WEB_DIR, "public", "annexes.json");
const MAX_CHARS = 12000;

async function parseDocument(file) {
  const { parse } = await import("kordoc");
  return parse(file);
}

export function documentExtension(buffer) {
  if (buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1") return "hwp";
  if (buffer.subarray(0, 4).toString("hex") === "504b0304") return "hwpx";
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  throw new Error("알 수 없거나 빈 별표 파일 형식");
}

export function annexFileUrls(meta) {
  return [...new Set([meta.hwpUrl, meta.pdfUrl, meta.fileUrl].filter((value) => typeof value === "string" && value.trim()))];
}

async function collectAnnexTexts({
  indexFile = INDEX_FILE,
  outFile = OUT_FILE,
  parseImpl = parseDocument,
  logger = console,
  ...requestOptions
}, report) {
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  if (!index || typeof index !== "object" || Array.isArray(index) || Object.keys(index).length === 0) {
    throw new Error("별표 목록이 비었거나 올바르지 않음: 기존 본문을 보존함");
  }
  report.requested = Object.keys(index).length;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "annex-"));
  const out = {};
  let ok = 0;
  let failed = 0;
  let truncated = 0;
  try {
    for (const [key, meta] of Object.entries(index)) {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)
        || !["서식", "별표"].includes(meta.kind)
        || typeof meta.law !== "string" || !meta.law.trim()
        || typeof meta.annex !== "string" || !meta.annex.trim()) {
        throw new Error("별표 목록 항목 형식 오류: 기존 본문을 보존함");
      }
      // 별지 서식은 빈칸 양식이므로 원본 링크만 보관한다.
      if (meta.kind === "서식") {
        out[key] = { ...meta };
        report.succeeded += 1;
        continue;
      }
      let text;
      let lastError = new Error("파일 링크 없음");
      // 현재 목록의 HWP/PDF 링크를 우선하고 옛 fileUrl도 지원한다.
      for (const url of annexFileUrls(meta)) {
        try {
          const data = await fetchWithRetry(url, { ...requestOptions, read: (response) => response.arrayBuffer() });
          const buffer = Buffer.from(data);
          const file = path.join(tmp, `${ok + failed}.${documentExtension(buffer)}`);
          fs.writeFileSync(file, buffer);
          const parsed = await parseImpl(file);
          text = [parsed?.markdown, parsed?.text].find((value) => typeof value === "string" && value.trim())?.trim();
          if (!text) throw new Error("본문이 비어 있음");
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!text) {
        logger.warn(`  ✗ ${key} — ${scrubError(lastError)}`);
        failed += 1;
        report.failed += 1;
        report.failures.push(`${key}: ${scrubError(lastError)}`);
        continue;
      }
      if (text.length > MAX_CHARS) {
        text = `${text.slice(0, MAX_CHARS)}\n\n…(이하 생략 — 전문은 원문 링크에서 확인)`;
        truncated += 1;
      }
      out[key] = { ...meta, text };
      ok += 1;
      report.succeeded += 1;
      logger.log(`  ✓ ${key} — ${text.length}자`);
    }
    if (failed > 0) throw new Error(`별표 본문 수집 불완전 (${failed}건 실패): 기존 본문을 보존함`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await atomicWriteFile(outFile, JSON.stringify(out));
    const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
    logger.log(`별표 본문: 성공 ${ok}건 / 길이초과 잘림 ${truncated}건 — ${kb}KB → public/annexes.json`);
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function populateAnnexTexts({ reportDir = process.env.LAW_UPDATE_REPORT_DIR, ...options } = {}) {
  const report = { stage: "annex-texts", requested: 0, succeeded: 0, failed: 0, preserved: true, failures: [] };
  try {
    const out = await collectAnnexTexts(options, report);
    report.preserved = false;
    return out;
  } catch (error) {
    report.failed = Math.max(report.failed, 1);
    report.failures.push(scrubError(error));
    throw error;
  } finally {
    if (reportDir) {
      try {
        await atomicWriteFile(path.join(reportDir, "annex-texts.json"), `${JSON.stringify(report, null, 2)}\n`);
      } catch (error) {
        (options.logger ?? console).warn(`진단 보고서 저장 실패: ${scrubError(error)}`);
      }
    }
  }
}

if (isMain(import.meta.url)) {
  populateAnnexTexts().catch((error) => {
    console.error(scrubError(error));
    process.exitCode = 1;
  });
}
