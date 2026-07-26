// 제도별 별표·별지 참조를 빌드 산출물로 만든다.
//
// 상세 화면의 '법적 근거' 블록이 이 산출물을 읽어, 각 근거 법령 아래에 그 제도가
// 실제로 가리키는 별표·서식(제목 + 법제처 원문 링크)을 보여준다. Worker에는
// 파일시스템이 없으므로 런타임 계산 대신 빌드 타임에 계산한다(→ data/annex-refs.json).
//
// 참조 추출은 조문 원문(public/articles)과 제도 데이터(legal_basis·캔버스)에서
// 하되, 타법 인용 가드(lib/annex-refs.mjs)로 남의 법령 별표를 오귀속하지 않는다.
// 수집된 별표 목록(data/annexes.json)에 있는 것만 남긴다 — 목록에 없는 참조는
// 링크를 만들 수 없고, 지어낸 링크는 틀린 근거보다 나쁘다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAnnexRefs, normalizeLawName } from "./lib/annex-refs.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES_DIR = path.join(WEB_DIR, "public", "articles");
const INSTITUTIONS_DIR = path.join(WEB_DIR, "data", "institutions");
const ANNEX_FILE = path.join(WEB_DIR, "data", "annexes.json");
const OUT_FILE = path.join(WEB_DIR, "data", "annex-refs.json");

const annexes = JSON.parse(fs.readFileSync(ANNEX_FILE, "utf8"));

/**
 * "제70조제1항" → ["법령::제70조"] 같은 조문 색인 키. 한 근거가 여러 조문을
 * 가리키기도 하므로("제70조·제71조") 나오는 조문을 전부 뽑는다.
 */
function articleKeys(law, article) {
  const base = normalizeLawName(law);
  const keys = [];
  for (const m of String(article ?? "").matchAll(/제(\d+)조(?:의(\d+))?/g)) {
    keys.push(`${base}::제${m[1]}조${m[2] ? `의${m[2]}` : ""}`);
  }
  return keys;
}

/** "별표3의2" → [3, 2] — 숫자 정렬용 */
function annexOrder(annex) {
  const m = annex.match(/(\d+)(?:의(\d+))?/);
  return [annex.startsWith("별지") ? 1 : 0, Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)];
}

const out = {};
let total = 0;

for (const file of fs.readdirSync(INSTITUTIONS_DIR)) {
  if (!file.endsWith(".json")) continue;
  const slug = file.replace(/\.json$/, "");
  const inst = JSON.parse(
    fs.readFileSync(path.join(INSTITUTIONS_DIR, file), "utf8"),
  );

  const wanted = new Set();
  const collect = (text, law) => {
    for (const ref of extractAnnexRefs(text, law)) {
      wanted.add(`${normalizeLawName(ref.law)}::${ref.annex}`);
    }
  };

  // 조문 원문을 "법령::제N조"로 색인해 둔다. 노드가 인용한 조문의 본문이
  // 가리키는 별표를 그 노드에 달아 주려면 이 색인이 필요하다 —
  // 하자담보(시행규칙 제70조)처럼 정작 중요한 별표가 조문 본문 속
  // 타법 인용으로만 등장하는 경우가 흔하다.
  const articleIndex = new Map();
  const articlesPath = path.join(ARTICLES_DIR, `${slug}.json`);
  if (fs.existsSync(articlesPath)) {
    const { articles } = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
    for (const a of articles) {
      collect(a.text, a.law);
      // 같은 조문이 여러 항목으로 들어 있다(항별로 나뉘거나 개정 전후가 함께).
      // 첫 항목만 쓰면 하필 별표를 언급하는 항을 놓친다 — 입찰참가자격등록
      // 신청서(시행규칙 제15조 별지 제1호서식)가 그렇게 빠졌다. 전부 모은다.
      for (const key of articleKeys(a.law, a.article)) {
        if (!articleIndex.has(key)) articleIndex.set(key, []);
        articleIndex.get(key).push(a);
      }
    }
  }
  for (const node of inst.process?.nodes ?? []) {
    for (const basis of node.legal_basis ?? []) {
      if (!basis.law) continue;
      collect(`${basis.article ?? ""} ${basis.text ?? ""}`, basis.law);
    }
  }
  for (const basis of inst.canvas?.legalBasis ?? []) {
    collect(basis.articles ?? "", basis.law);
  }

  const refs = [...wanted]
    .map((key) => annexes[key])
    .filter(Boolean)
    // 파일 링크(/LSW/flDownload.do)만 내보낸다. `url`(별표법령상세링크)은 DRF Open API
    // 엔드포인트라 인증키 없이는 "OpenAPI 사용자 인증에 실패하였습니다"만 돌려준다 —
    // 키는 저장소에 커밋할 수 없으므로 그 링크는 사용자에게 항상 죽은 링크다.
    // PDF·HWP를 모두 내보내 화면에서 사용자가 고르게 한다.
    .map(({ law, annex, kind, label, title, pdfUrl, hwpUrl }) => ({
      law,
      annex,
      kind,
      label: label ?? annex,
      title,
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(hwpUrl ? { hwpUrl } : {}),
      nodes: [],
    }));
  if (refs.length === 0) continue;

  // 어느 노드에 달 별표인지 여기서 정한다.
  //
  // 예전에는 화면에서 "노드가 인용한 법령이 같으면 보여준다"로 걸렀는데, 그
  // 필터는 양쪽으로 틀렸다. 하자담보 P01(시행규칙 제70조)에는 제70조가 실제로
  // 가리키는 「건설산업기본법 시행령」 별표4가 안 뜨고(법령명이 달라서), 정작
  // 제70조와 무관한 같은 시행규칙의 별지 제12호서식이 떴다. 그래서 노드가
  // (a) 근거 문구에서 직접 가리키는 별표와 (b) 인용한 조문의 본문이 가리키는
  // 별표만 그 노드에 단다.
  const byKey = new Map(refs.map((r) => [`${r.law}::${r.annex}`, r]));
  for (const node of inst.process?.nodes ?? []) {
    const keys = new Set();
    for (const basis of node.legal_basis ?? []) {
      if (!basis.law) continue;
      for (const ref of extractAnnexRefs(`${basis.article ?? ""} ${basis.text ?? ""}`, basis.law)) {
        keys.add(`${normalizeLawName(ref.law)}::${ref.annex}`);
      }
      for (const key of articleKeys(basis.law, basis.article)) {
        for (const article of articleIndex.get(key) ?? []) {
          for (const ref of extractAnnexRefs(article.text, article.law)) {
            keys.add(`${normalizeLawName(ref.law)}::${ref.annex}`);
          }
        }
      }
    }
    for (const key of keys) byKey.get(key)?.nodes.push(node.id);
  }

  // 법령별로 묶고 번호순으로 — 화면에서 근거 법령 행 아래에 그대로 붙는다.
  refs.sort((a, b) => {
    if (a.law !== b.law) return a.law.localeCompare(b.law, "ko");
    const [ak, an, as] = annexOrder(a.annex);
    const [bk, bn, bs] = annexOrder(b.annex);
    return ak - bk || an - bn || as - bs;
  });
  out[slug] = refs;
  total += refs.length;
}

fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 1)}\n`);
console.log(
  `제도별 별표·별지 참조: ${Object.keys(out).length}개 제도 / ${total}건 → data/annex-refs.json`,
);
