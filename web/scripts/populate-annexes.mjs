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

const OC = process.env.LAW_OC;
if (!OC) {
  console.error(
    "LAW_OC 가 없습니다. web/.dev.vars 에 LAW_OC=... 를 넣고 다시 실행하세요.",
  );
  process.exit(1);
}

const BASE = "https://www.law.go.kr/DRF";

/**
 * 별표·서식 목록 조회.
 *
 * 함정 둘:
 *  - 응답 루트가 `licBylSearch`다(대문자 B 아님). 법령·행정규칙 검색과 표기가 달라
 *    LicBylSearch로 읽으면 조용히 0건이 된다.
 *  - knd=1 이 별표, knd=2 가 서식(별지)이다. knd 없이 부르면 섞여 와서 번호
 *    해석이 꼬인다. 종류별로 따로 부른다.
 */
async function listAnnexes(lawName, knd) {
  // 법령 별표는 licbyl, 행정규칙(고시·훈령·예규) 별표는 admbyl 로 나뉜다.
  // 우리 근거의 상당수가 계약예규·조달청 기준이라 admbyl 쪽이 오히려 많다.
  const targets = [
    { target: "licbyl", root: "licBylSearch", key: "licbyl", admRule: false },
    { target: "admbyl", root: "admRulBylSearch", key: "admbyl", admRule: true },
  ];
  for (const t of targets) {
    const url = `${BASE}/lawSearch.do?OC=${OC}&target=${t.target}&type=JSON&display=100&search=2&knd=${knd}&query=${encodeURIComponent(lawName)}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    let rows = [];
    try {
      const data = JSON.parse(await res.text());
      const list = data?.[t.root]?.[t.key] ?? Object.values(data?.[t.root] ?? {}).find(Array.isArray);
      rows = Array.isArray(list) ? list : list ? [list] : [];
    } catch {
      continue; // 오픈API는 오류를 HTML로 주기도 한다
    }
    // 검색어가 부분일치라 다른 법령이 섞여 온다. 이름이 정확히 같은 것만.
    const mine = rows.filter((r) => {
      const owner = String(r.관련법령명 ?? r.관련행정규칙명 ?? "").trim();
      return owner === lawName || owner.replace(/\s/g, "") === lawName.replace(/\s/g, "");
    });
    if (mine.length > 0) return { rows: mine, admRule: t.admRule };
  }
  return { rows: [], admRule: false };
}

/**
 * 응답에 실려 오는 링크에는 OC(인증키)가 쿼리로 박혀 있다. 그대로 저장하면
 * 키가 저장소에 커밋된다. 반드시 지우고 쓴다.
 */
function scrubKey(link) {
  if (!link) return undefined;
  const path = String(link).replace(/([?&])OC=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  return `https://www.law.go.kr${path}`;
}

// ── 필요한 별표·별지 목록을 조문과 제도 데이터에서 뽑는다 ────────────────────

const needed = new Map(); // 법령명 → Set<별표N|별지N>
function addRefs(text, ownLaw) {
  for (const { law, annex } of extractAnnexRefs(text, ownLaw)) {
    if (!needed.has(law)) needed.set(law, new Set());
    needed.get(law).add(annex);
  }
}

for (const file of fs.readdirSync(ARTICLES_DIR)) {
  const { articles } = JSON.parse(
    fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8"),
  );
  for (const a of articles) addRefs(a.text, a.law);
}

for (const file of fs.readdirSync(INSTITUTIONS_DIR)) {
  const inst = JSON.parse(
    fs.readFileSync(path.join(INSTITUTIONS_DIR, file), "utf8"),
  );
  for (const node of inst.process?.nodes ?? []) {
    for (const basis of node.legal_basis ?? []) {
      if (!basis.law) continue;
      addRefs(`${basis.article ?? ""} ${basis.text ?? ""}`, basis.law);
    }
  }
  for (const basis of inst.canvas?.legalBasis ?? []) {
    addRefs(basis.articles ?? "", basis.law);
  }
}

console.log(
  `참조된 별표·별지: ${[...needed.values()].reduce((n, s) => n + s.size, 0)}건 / 법령 ${needed.size}개`,
);

const out = {};
let ok = 0;
let miss = 0;

for (const [rawLaw, wanted] of needed) {
  const lawName = normalizeLawName(rawLaw);
  const kinds = new Set([...wanted].map((w) => (w.startsWith("별지") ? "2" : "1")));
  const found = new Map(); // 별표N|별지N → { row, admRule }
  for (const knd of kinds) {
    const { rows, admRule } = await listAnnexes(lawName, knd);
    for (const row of rows) {
      const no = decodeAnnexNo(row.별표번호, knd === "2" ? "서식" : "별표");
      // 같은 번호가 중복되면(시행규칙 서식5·6 '입찰서' 등) 첫 항목을 쓴다.
      if (no && !found.has(no)) found.set(no, { row, admRule });
    }
  }
  if (found.size === 0 && wanted.size > 0) {
    console.warn(`  ✗ 별표·서식 목록이 비었음: ${lawName}`);
    miss += wanted.size;
    continue;
  }
  for (const want of wanted) {
    const hit = found.get(want);
    if (!hit) {
      // 조문이 가리키는 별표가 그 법령에 없는 경우가 실제로 있다(타법 별표 인용,
      // 삭제·재편된 옛 번호). 지어내지 말고 남긴다 — 이 경고가 콘텐츠 오류 신호다.
      console.warn(`  ✗ ${lawName} ${want} — 그 법령에 없음`);
      miss += 1;
      continue;
    }
    const kind = want.startsWith("별지") ? "서식" : "별표";
    out[`${lawName}::${want}`] = {
      law: lawName,
      annex: want,
      kind,
      label: annexLabel(want, kind, hit.admRule),
      title: String(hit.row.별표명 ?? "").trim(),
      // 본문은 HWP/PDF 파일이라 링크로 넘긴다. 표 형식이라 텍스트로 옮기면
      // 행·열 관계가 깨져서, 어설픈 텍스트보다 원본 링크가 정확하다.
      //
      // `별표법령상세링크`는 DRF Open API 주소라 인증키 없이는 열리지 않는다
      // (키는 커밋할 수 없으므로 사용자에겐 항상 죽은 링크다). 파일 링크
      // (/LSW/flDownload.do)만 인증 없이 열린다.
      // PDF·HWP 둘 다 보관한다 — 화면에서 사용자가 고르게 한다.
      // PDF는 브라우저에서 바로 열리고, HWP는 편집이 필요한 서식 작성에 쓴다.
      url: scrubKey(hit.row.별표법령상세링크 ?? hit.row.별표행정규칙상세링크),
      pdfUrl: scrubKey(hit.row.별표서식PDF파일링크),
      hwpUrl: scrubKey(hit.row.별표서식파일링크),
    };
    ok += 1;
  }
}

// 키 정렬은 diff 안정성을 위해서다 — 주간 갱신 때 순서만 바뀐 커밋을 막는다.
const sorted = Object.fromEntries(
  Object.entries(out).sort(([a], [b]) => a.localeCompare(b, "ko")),
);
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`별표·별지 수집: 성공 ${ok}건 / 실패 ${miss}건 → data/annexes.json`);
