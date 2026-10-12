// 조문·제도 데이터가 가리키는 별표·별지(서식)의 목록을 수집한다.
//
// 왜 필요한가: 실무에서 제일 중요한 수치·서류가 조문이 아니라 별표·별지에 있다 —
// 부정당업자 제재기간(시행규칙 별표2), 적격심사 배점(시설공사 세부기준 별표들),
// 등록증·계약서·납품요구서 같은 별지 서식. 목록 없이 조문만 주면 모델이 조문은
// 정확히 인용하면서 별표 내용을 지어낼 수 있고, 사용자는 어떤 서식을 내야 하는지
// 화면에서 확인할 길이 없다.
//
// 수집원은 둘이다:
//  1) public/articles/*.json — 조문 원문 속 "별표 N"/"별지 제N호서식" 언급
//  2) data/institutions/*.json — 절차 노드 legal_basis와 캔버스 법적 근거의 언급
// 타법 인용 가드(scripts/lib/annex-refs.mjs)로 남의 법령 별표를 오귀속하지 않는다.
//
// 수집은 저작 시점에 한 번 한다. 운영(Cloudflare Worker)에서는 법령 API를 부르지
// 않고 여기서 만든 정적 자산만 읽는다.
//
// 필요: LAW_OC (국가법령정보센터 오픈API 신청 시 받는 이메일 ID)
//   web/.dev.vars 에 LAW_OC=... 로 넣고 실행한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile, fetchWithRetry, isMain, scrubError } from "./lib/law-update.mjs";
import {
  extractAnnexRefs,
  normalizeLawName,
  decodeAnnexNo,
  annexLabel,
} from "./lib/annex-refs.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES_DIR = path.join(WEB_DIR, "public", "articles");
const INSTITUTIONS_DIR = path.join(WEB_DIR, "data", "institutions");
const OUT_FILE = path.join(WEB_DIR, "data", "annexes.json");

const BASE = "https://www.law.go.kr/DRF";

/**
 * 법령명 대조용 정규화.
 *
 * 법제처는 어절 구분에 가운뎃점을 쓴다 — "우수조달물품 지정ㆍ관리 규정". 우리
 * 데이터는 "우수조달물품 지정관리 규정"이라 공백만 지워서는 영영 안 맞는다.
 * 가운뎃점은 코드포인트가 여럿(ㆍ U+318D, · U+00B7, ・ U+30FB, ･ U+FF65)이라
 * 전부 지운다. 이 대조가 실패하면 그 법령의 별표는 통째로 사라진다.
 */
function nameKey(name) {
  return String(name ?? "")
    .replace(/[\sㆍ·・･]/g, "")
    .trim();
}

/**
 * 별표·서식 목록 조회. 법령명(search=2)으로 찾아 그 법령 것만 남긴다.
 *
 * 함정 넷 — 넷 다 조용히 0건이 되므로 하나씩 짚는다:
 *  - 응답 루트가 `licBylSearch`다(대문자 B 아님).
 *  - 행정규칙 응답의 배열 키는 `admbyl`이 아니라 `admrulbyl`이다.
 *  - `search=2`라야 법령명(section=lawNm/admNm)을 검색한다. 기본값·search=1은
 *    별표'명'을 검색하므로 법령명을 넣으면 0건이다.
 *  - `knd` 코드가 target마다 다르다. 법령은 서식=2인데 행정규칙은 서식=3이다.
 *    그래서 knd는 아예 쓰지 않고, 응답의 `별표종류` 필드로 분류한다.
 *
 * display 상한이 100이라 페이지를 끝까지 넘긴다(계약법 시행규칙류는 100을 넘는다).
 */
const TARGETS = [
  { target: "licbyl", root: "licBylSearch", key: "licbyl", lawKey: "관련법령명", admRule: false },
  { target: "admbyl", root: "admRulBylSearch", key: "admrulbyl", lawKey: "관련행정규칙명", admRule: true },
];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function countValue(value) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) {
    throw new Error("별표 응답의 totalCnt가 올바르지 않음");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error("별표 응답의 totalCnt 범위 초과");
  return count;
}

// 지정된 루트와 행 키만 인정한다. 오류 객체나 엉뚱한 배열을 0건으로 취급하지 않는다.
export function parseAnnexPage(payload, target, page = 1) {
  const spec = TARGETS.find((entry) => entry.target === target);
  if (!spec || !isRecord(payload) || !isRecord(payload[spec.root])) {
    throw new Error("별표 응답 루트가 올바르지 않음");
  }
  const root = payload[spec.root];
  // 나머지 문서화된 필드는 스칼라 메타데이터다. 낯선 배열/객체는 0건이 아니다.
  if (Object.entries(root).some(([key, value]) => key !== spec.key && value !== null && typeof value === "object")) {
    throw new Error("별표 응답에 알 수 없는 목록/오류 객체가 있음");
  }
  const total = countValue(root.totalCnt);
  if (root.page !== undefined && countValue(root.page) !== page) {
    throw new Error("별표 응답 페이지 불일치");
  }
  const value = root[spec.key];
  let rows;
  if (value === undefined && total === 0) rows = [];
  else if (Array.isArray(value)) rows = value;
  else if (isRecord(value)) rows = [value];
  else throw new Error("별표 응답 목록이 올바르지 않음");
  const expected = Math.min(100, Math.max(0, total - (page - 1) * 100));
  if (rows.length !== expected) throw new Error("별표 응답 목록이 불완전함");
  for (const row of rows) {
    if (!isRecord(row) || typeof row[spec.lawKey] !== "string" || !row[spec.lawKey].trim()
      || !/^[0-9]+$/.test(String(row.별표번호 ?? ""))
      || typeof row.별표명 !== "string" || !row.별표명.trim()
      || !["별표", "서식", "별지", "별도", "부록"].includes(row.별표종류)) {
      throw new Error("별표 응답 항목이 올바르지 않음");
    }
    for (const key of ["별표서식파일링크", "별표서식PDF파일링크", "별표법령상세링크", "별표행정규칙상세링크"]) {
      if (row[key] !== undefined && row[key] !== null && typeof row[key] !== "string") {
        throw new Error("별표 응답 링크가 올바르지 않음");
      }
    }
  }
  return { rows, total };
}

export async function listAnnexes(lawName, { oc = process.env.LAW_OC, ...requestOptions } = {}) {
  if (!oc) throw new Error("LAW_OC 가 없습니다");
  const want = nameKey(lawName);
  const query = lawName.replace(/[ㆍ·・･]/g, "");
  for (const spec of TARGETS) {
    const mine = [];
    let expectedTotal;
    const seenPages = new Set();
    let complete = false;
    for (let page = 1; page <= 20; page += 1) {
      const url = new URL(`${BASE}/lawSearch.do`);
      url.search = new URLSearchParams({ OC: oc, target: spec.target, type: "JSON", display: "100", page: String(page), search: "2", query });
      const payload = await fetchWithRetry(url.toString(), requestOptions);
      const { rows, total } = parseAnnexPage(payload, spec.target, page);
      if (expectedTotal !== undefined && total !== expectedTotal) {
        throw new Error("별표 수집 중 전체 건수가 변경됨");
      }
      expectedTotal = total;
      const signature = JSON.stringify(rows);
      if (rows.length && seenPages.has(signature)) throw new Error("별표 응답 페이지 중복: 결과가 불완전함");
      seenPages.add(signature);
      for (const row of rows) {
        if (nameKey(row[spec.lawKey]) === want) mine.push(row);
      }
      if (page * 100 >= total) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new Error("별표 수집 페이지 상한 초과: 결과가 불완전함");
    if (mine.length > 0) return { rows: mine, admRule: spec.admRule };
  }
  return { rows: [], admRule: false };
}

/**
 * 응답에 실려 오는 링크에는 OC(인증키)가 쿼리로 박혀 있다. 그대로 저장하면
 * 키가 저장소에 커밋된다. 반드시 지우고 쓴다.
 */
export function scrubKey(link) {
  if (!link) return undefined;
  const url = new URL(link, "https://www.law.go.kr");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("별표 링크 형식 오류");
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === "oc") url.searchParams.delete(key);
  }
  return url.toString();
}

// 목록을 모두 수집하기 전에는 기존 파일을 건드리지 않는다.
async function collectAnnexes({
  articlesDir = ARTICLES_DIR,
  institutionsDir = INSTITUTIONS_DIR,
  outFile = OUT_FILE,
  logger = console,
  ...requestOptions
}, report) {
  const needed = new Map();
  function addRefs(text, ownLaw) {
    for (const { law, annex } of extractAnnexRefs(text, ownLaw)) {
      if (!needed.has(law)) needed.set(law, new Set());
      needed.get(law).add(annex);
    }
  }
  for (const file of fs.readdirSync(articlesDir).filter((name) => name.endsWith(".json"))) {
    const { articles } = JSON.parse(fs.readFileSync(path.join(articlesDir, file), "utf8"));
    if (!Array.isArray(articles)) throw new Error("조문 입력 형식 오류");
    for (const article of articles) addRefs(article.text, article.law);
  }
  for (const file of fs.readdirSync(institutionsDir).filter((name) => name.endsWith(".json"))) {
    const inst = JSON.parse(fs.readFileSync(path.join(institutionsDir, file), "utf8"));
    for (const node of inst.process?.nodes ?? []) {
      for (const basis of node.legal_basis ?? []) {
        if (basis.law) addRefs(`${basis.article ?? ""} ${basis.text ?? ""}`, basis.law);
      }
    }
    for (const basis of inst.canvas?.legalBasis ?? []) addRefs(basis.articles ?? "", basis.law);
  }
  if (needed.size === 0) throw new Error("별표 참조 입력이 비었음: 기존 목록을 보존함");
  report.requested = [...needed.values()].reduce((n, set) => n + set.size, 0);
  logger.log(`참조된 별표·별지: ${[...needed.values()].reduce((n, set) => n + set.size, 0)}건 / 법령 ${needed.size}개`);
  const out = {};
  let missing = 0;
  for (const [rawLaw, wanted] of needed) {
    const lawName = normalizeLawName(rawLaw);
    const { rows, admRule } = await listAnnexes(lawName, requestOptions);
    const found = new Map();
    for (const row of rows) {
      const no = decodeAnnexNo(row.별표번호, row.별표종류);
      if (no && !found.has(no)) found.set(no, row);
    }
    for (const want of wanted) {
      const row = found.get(want);
      if (!row) {
        logger.warn(`  ✗ ${lawName} ${want} — 그 법령에 없음`);
        missing += 1;
        report.failed += 1;
        report.failures.push(`${lawName} ${want}: 요청한 별표 없음`);
        continue;
      }
      const kind = want.startsWith("별지") ? "서식" : "별표";
      const meta = {
        law: lawName,
        annex: want,
        kind,
        label: annexLabel(want, kind, admRule),
        title: row.별표명.trim(),
        url: scrubKey(row.별표법령상세링크 ?? row.별표행정규칙상세링크),
        pdfUrl: scrubKey(row.별표서식PDF파일링크),
        hwpUrl: scrubKey(row.별표서식파일링크),
      };
      if (!meta.hwpUrl && !meta.pdfUrl) throw new Error("별표 파일 링크 없음: 기존 목록을 보존함");
      out[`${lawName}::${want}`] = meta;
      report.succeeded += 1;
    }
  }
  if (missing > 0 || Object.keys(out).length === 0) {
    throw new Error(`별표 수집 불완전 (${missing}건 누락): 기존 목록을 보존함`);
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "ko")));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await atomicWriteFile(outFile, `${JSON.stringify(sorted, null, 1)}\n`);
  logger.log(`별표·별지 수집: 성공 ${Object.keys(out).length}건 → data/annexes.json`);
  return sorted;
}

export async function populateAnnexes({ reportDir = process.env.LAW_UPDATE_REPORT_DIR, ...options } = {}) {
  const report = { stage: "annex-index", requested: 0, succeeded: 0, failed: 0, preserved: true, failures: [] };
  try {
    const out = await collectAnnexes(options, report);
    report.preserved = false;
    return out;
  } catch (error) {
    report.failed = Math.max(report.failed, 1);
    report.failures.push(scrubError(error));
    throw error;
  } finally {
    if (reportDir) {
      try {
        await atomicWriteFile(path.join(reportDir, "annex-index.json"), `${JSON.stringify(report, null, 2)}\n`);
      } catch (error) {
        (options.logger ?? console).warn(`진단 보고서 저장 실패: ${scrubError(error)}`);
      }
    }
  }
}

if (isMain(import.meta.url)) {
  populateAnnexes().catch((error) => {
    console.error(scrubError(error));
    process.exitCode = 1;
  });
}
