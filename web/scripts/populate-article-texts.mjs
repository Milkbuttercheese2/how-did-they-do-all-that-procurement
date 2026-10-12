// 인용 조문의 현행 원문을 국가법령정보센터 Open API로 받아 institution JSON의
// verification.articleTexts 에 저장한다. 팝업(조문확인)에서 조문 원문을 보여주기 위한 데이터.
// 사용: LAW_OC=... KOREAN_LAW_CLI=... node scripts/populate-article-texts.mjs [--only slug]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile, fetchWithRetry, isMain, runLawCli, scrubError } from "./lib/law-update.mjs";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_DIR, "data", "institutions");

const compact = (s) => (s ?? "").replace(/\s+/g, "").replace(/[·ㆍ]/g, "");
// "제7조제1항", "제12조의2제3항" → base article "제7조", "제12조의2"
function baseArticle(article) {
  const m = String(article).match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (!m) return null;
  return `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`;
}

// 인용에 지정된 항 번호("제3항") 추출. 없으면 null.
function hangNumber(article) {
  const m = String(article).match(/제\s*(\d+)\s*항/);
  return m ? Number(m[1]) : null;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚";
// 조문 본문에서 n번째 항(원숫자 마커)만 추출. 마커가 없으면(단항 조문 등) 본문 전체를 반환.
function extractHang(body, n) {
  const marker = CIRCLED[n - 1];
  if (!marker) return body;
  const start = body.indexOf(marker);
  if (start === -1) return body; // 해당 항 마커 없음 → 조문 전체로 폴백
  const next = CIRCLED[n];
  let end = body.length;
  if (next) {
    const ni = body.indexOf(next, start + 1);
    if (ni !== -1) end = ni;
  }
  return body.slice(start, end).trim();
}

async function fetchAdminRuleFull(serial, oc = process.env.LAW_OC) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(oc)}&target=admrul&ID=${serial}&type=JSON`;
  const json = await fetchWithRetry(url);
  const articles = json?.AdmRulService?.["조문내용"];
  if (!Array.isArray(articles) || !articles.every((line) => typeof line === "string")) {
    throw new Error("행정규칙 전문 응답 구조가 올바르지 않음");
  }
  const text = articles.join("\n");
  if (!/제\s*\d+\s*조/.test(text)) throw new Error("행정규칙 전문에 조문이 없음");
  return text;
}

// 본문 안에서 자기 조문이 아닌 다른 조문의 '행 시작' 헤더(제N조 …)를 만나면 그 앞에서 절단한다.
// 문장 중간의 상호참조("법 제7조제1항 …")는 행 시작이 아니므로 절단하지 않는다.
function truncateAtForeignArticle(body, ownKey) {
  const lineHeader = /^제(\d+)조(?:의(\d+))?(?:\s|\(|$)/; // 행 시작 조문 헤더/목차 라인
  // 편·장·절 제목 줄(예: "제2장 설계공모 공고 및 공모안 제출 등")은 다음 조문의
  // 머리글이므로 앞 조문 본문에 섞이면 안 된다.
  const divisionHeader = /^제\d+[편장절관](?:\s|$)/;
  const out = [];
  for (const line of body.split("\n")) {
    if (divisionHeader.test(line.trim())) break;
    const hm = line.match(lineHeader);
    if (hm) {
      const key = `제${hm[1]}조${hm[2] ? `의${hm[2]}` : ""}`;
      if (key !== ownKey) break; // 다른 조문 헤더 → 여기서 멈춘다
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

// 본문 텍스트에서 "제N조(제목) …" 블록을 각 조문 단위로 분리
function parseArticleBodies(output, { dropLast = false } = {}) {
  const map = new Map();
  // 헤더 라인: 제7조(계약의 방법)  — 조문 제목 괄호 포함.
  // 반드시 행 시작에 앵커한다. 앵커가 없으면 문장 중간의 상호참조
  // (예: 「국가계약법 시행규칙」제44조(또는 …)) 를 조문 헤더로 오인해
  // 그 앞에서 본문이 잘린다.
  const headerRe = /^[ \t]*제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)/gm;
  const marks = [];
  let m;
  while ((m = headerRe.exec(output)) !== null) {
    marks.push({ idx: m.index, key: `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`, title: m[3], headEnd: headerRe.lastIndex });
  }
  // 단항 조문은 원문 본문에 "제N조(제목)" 헤더가 반복되지 않아 CLI 출력이
  // "제N조 제목" 제목 줄 + 본문 형태로만 나온다(예: 법 제20조, 영 제78조).
  // 행 시작의 괄호 없는 제목 줄도 헤더로 인식한다. 본문 속 "제N항" 이어쓰기·
  // 문장 줄과 혼동하지 않도록 제목은 60자 이하, '다.'로 끝나지 않고,
  // '제N'으로 시작하지 않는 줄로 한정한다.
  const bareHeaderRe = /^제(\d+)조(?:의(\d+))?[ \t]+(\S[^\n]*)$/gm;
  while ((m = bareHeaderRe.exec(output)) !== null) {
    const title = m[3].trim();
    if (title.length > 60 || /다\.$/.test(title) || /^제\d+\s*(?:항|호|조)/.test(title)) continue;
    marks.push({ idx: m.index, key: `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`, title, headEnd: bareHeaderRe.lastIndex });
  }
  marks.sort((a, b) => a.idx - b.idx);
  // Truncated CLI output may have the final header but only half its body.
  // Only sections bounded by the following header are then safe to keep.
  for (let i = 0; i < marks.length - (dropLast ? 1 : 0); i += 1) {
    const start = marks[i].headEnd;
    const end = i + 1 < marks.length ? marks[i + 1].idx : output.length;
    let body = output.slice(start, end).trim();
    // JSON 잔여 구두점 정리
    body = body.replace(/\\n/g, "\n").replace(/^["\s,:]+/, "").replace(/["\s,]+$/, "").trim();
    // 방어: 본문에 섞인 다른 조문 내용 절단(자기 조문 헤더는 이미 제거된 상태이므로 첫 이질 헤더에서 멈춤)
    body = truncateAtForeignArticle(body, marks[i].key);
    if (!map.has(marks[i].key) && body) {
      map.set(marks[i].key, { title: marks[i].title, body });
    }
  }
  return map;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function processFile(file, { dataDir = DATA_DIR, runCli = runLawCli, fetchFull = fetchAdminRuleFull } = {}) {
  const p = path.join(dataDir, file);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const verification = d.verification;
  if (!verification || !Array.isArray(verification.sources)) return { file, filled: 0, skipped: "no-sources" };

  const sourceByLaw = new Map();
  for (const s of verification.sources) {
    sourceByLaw.set(compact(s.law), s);
    if (s.officialName) sourceByLaw.set(compact(s.officialName), s);
  }

  // 인용 (law, baseArticle) 수집
  const needed = new Map(); // sourceKey -> {source, articles:Set, citations:[{law,article,base}]}
  for (const node of d.process?.nodes ?? []) {
    for (const lb of node.legal_basis ?? []) {
      const base = baseArticle(lb.article);
      if (!base) continue;
      const src = sourceByLaw.get(compact(lb.law));
      if (!src) continue;
      const skey = src.mst ? `mst:${src.mst}` : src.adminRuleSerial ? `adm:${src.adminRuleSerial}` : null;
      if (!skey) continue;
      if (!needed.has(skey)) needed.set(skey, { source: src, bases: new Set(), keys: new Set() });
      needed.get(skey).bases.add(base);
      needed.get(skey).keys.add(`${lb.law}::${lb.article}`);
    }
  }

  const articleTexts = {}; // "law::article" -> {title, body, effectiveOn}
  for (const [, group] of needed) {
    const src = group.source;
    let output = "";
    let fallback = "";
    let truncated = false;
    if (src.mst) {
      for (const b of chunk([...group.bases], 20)) {
        const batch = await runCli(["get_batch_articles", "--mst", src.mst, "--articles", JSON.stringify(b)]);
        if (/응답이 너무 길어|too long/i.test(batch)) throw new Error("조문 배치 응답이 잘림: 기존 제도 파일 보존");
        output += "\n" + batch;
      }
    } else if (src.adminRuleSerial) {
      output = await runCli(["get_admin_rule", "--id", src.adminRuleSerial]);
      // CLI 출력은 항·호가 줄바꿈으로 구분된 정본이다. 다만 50,000자에서 잘리므로
      // 뒤쪽 조문은 폴백에서만 얻을 수 있다. 폴백으로 '덮어쓰면' 앞쪽 조문의
      // 줄바꿈까지 함께 잃으므로(팝업은 pre-wrap이라 문단 구분이 사라진다),
      // 덮어쓰지 않고 CLI에 없는 조문만 보충한다.
      if (/응답이 너무 길어|too long/i.test(output)) {
        truncated = true;
        fallback = await fetchFull(src.adminRuleSerial);
        if (!fallback.trim() || /응답이 너무 길어|too long|^\[(?:ERROR|NOT_FOUND|[A-Z_]+_ERROR)\]/im.test(fallback)) {
          throw new Error("행정규칙 전문 폴백이 비었거나 불완전함");
        }
      }
    }
    if (/^\[(?:ERROR|NOT_FOUND|[A-Z_]+_ERROR)\]/m.test(output)) throw new Error("조문 CLI가 오류 응답을 반환함");
    const bodies = parseArticleBodies(output, { dropLast: truncated });
    if (fallback) {
      for (const [key, body] of parseArticleBodies(fallback)) {
        if (!bodies.has(key)) bodies.set(key, body);
      }
    }
    for (const key of group.keys) {
      const [, article] = key.split("::");
      const base = baseArticle(article);
      const hit = bodies.get(base);
      if (!hit) {
        throw new Error(`${src.law ?? src.officialName ?? file} ${base}: 조문 원문 누락 (검토 필요, 기존 제도 파일 보존)`);
      }
      if (hit) {
        // 인용이 특정 항(제N항)을 지정하면 그 항만, 아니면 조문 전체를 담는다.
        const n = hangNumber(article);
        const text = n ? extractHang(hit.body, n) : hit.body;
        articleTexts[key] = {
          article: base,
          title: hit.title,
          // 상한 1400자는 국가계약법 시행령 제26조처럼 긴 조문·항을 중간에서 끊어,
          // 정작 인용 대상인 호가 원문에 누락되는 문제가 있었다(44건).
          text: text.slice(0, 20000),
          effectiveOn: src.effectiveOn ?? src.promulgatedOn ?? null,
        };
      }
    }
  }

  const filled = Object.keys(articleTexts).length;
  if (filled > 0) {
    verification.articleTexts = articleTexts;
    // 들여쓰기 1칸: sync-verification·verify-articles와 같은 형식이라야 한다.
    // 2칸으로 쓰면 다음 파이프라인 실행 때 전체 파일이 재포맷돼 diff가 통째로 뜬다.
    atomicWriteFile(p, JSON.stringify(d, null, 1) + "\n");
  }
  return { file, filled };
}

export async function main({ dataDir = DATA_DIR, only, runCli, fetchFull, reportDir = process.env.LAW_UPDATE_REPORT_DIR } = {}) {
  if (!process.env.LAW_OC?.trim()) throw new Error("LAW_OC 환경변수가 필요합니다.");
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json") && (!only || f === `${only}.json`));
  if (only && files.length === 0) throw new Error(`제도를 찾을 수 없음: ${only}`);
  const results = [];
  for (const file of files) {
    try {
      const result = await processFile(file, { dataDir, runCli, fetchFull });
      results.push(result);
      console.log(`${result.file}: ${result.filled ?? 0} 조문 원문${result.skipped ? ` (${result.skipped})` : ""}`);
    } catch (error) {
      const note = scrubError(error);
      results.push({ file, filled: 0, failed: true, preserved: true, note });
      console.error(`${file}: ${note}`);
    }
  }
  const failures = results.filter((result) => result.failed);
  const total = results.reduce((sum, result) => sum + (result.filled || 0), 0);
  if (reportDir) atomicWriteFile(path.join(reportDir, "article-texts.json"), JSON.stringify({ files: files.length, total, failures }, null, 2) + "\n");
  console.log(`\n총 ${total}개 조문 원문 저장 (${files.length}개 제도), 실패 ${failures.length}개 (기존 파일 보존)`);
  if (failures.length) process.exitCode = 1;
  return { total, failures };
}

if (isMain(import.meta.url)) {
  const onlyArg = process.argv.indexOf("--only");
  main({ only: onlyArg > -1 ? process.argv[onlyArg + 1] : null }).catch((error) => {
    console.error(scrubError(error));
    process.exitCode = 1;
  });
}
