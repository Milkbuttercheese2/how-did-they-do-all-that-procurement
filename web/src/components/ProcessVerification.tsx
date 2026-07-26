"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AnnexRef, ProcessModel, ProcessNode, SourceVerification } from "@/lib/types";
import {
  getNodeVerification,
  summarizeProcessVerification,
  unresolvedReasonLabels,
  type NodeVerificationResult,
  type NodeVerificationState,
} from "@/lib/process-verification";

const STATE_STYLE: Record<
  NodeVerificationState,
  { icon: string; color: string; background: string; border: string }
> = {
  "article-verified": {
    icon: "✓",
    color: "#087452",
    background: "#e7f7ef",
    border: "#a9ddc8",
  },
  "source-linked": {
    icon: "↗",
    color: "#315a78",
    background: "#edf5fa",
    border: "#bfd5e3",
  },
  "scope-limited": {
    icon: "!",
    color: "#9a650f",
    background: "#fef6e7",
    border: "#ead19b",
  },
  "needs-review": {
    icon: "!",
    color: "#a33a2b",
    background: "#fff1ef",
    border: "#edc0b8",
  },
  "not-cited": {
    icon: "-",
    color: "#68766f",
    background: "#f5f7f6",
    border: "#d3ddd7",
  },
};

export function VerificationMark({
  result,
  inverse = false,
  compact = false,
  onActivate,
}: {
  result: NodeVerificationResult;
  inverse?: boolean;
  compact?: boolean;
  onActivate?: () => void;
}) {
  const visual = STATE_STYLE[result.state];
  return (
    <span
      data-verification-state={result.state}
      title={onActivate ? `${result.detail} (누르면 법적 근거로 이동)` : result.detail}
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={
        onActivate
          ? (event) => {
              event.stopPropagation();
              onActivate();
            }
          : undefined
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        maxWidth: "100%",
        minHeight: compact ? 16 : 20,
        padding: compact ? "1px 5px" : "2px 7px",
        borderRadius: 4,
        border: `1px solid ${inverse ? "rgba(255,255,255,.42)" : visual.border}`,
        background: inverse ? "rgba(255,255,255,.14)" : visual.background,
        color: inverse ? "#ffffff" : visual.color,
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        cursor: onActivate ? "pointer" : undefined,
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>
        {visual.icon}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{result.label}</span>
    </span>
  );
}

// 인용에서 조(제N조/제N조의M)와 항(제M항)을 추출해 표시·링크에 쓴다.
function parseArticleParts(article: string): { jo: string | null; hang: string | null } {
  const jo = article.match(/제\s*\d+\s*조(?:의\s*\d+)?/)?.[0]?.replace(/\s+/g, "") ?? null;
  const hang = article.match(/제\s*\d+\s*항/)?.[0]?.replace(/\s+/g, "") ?? null;
  return { jo, hang };
}

// 채번(라벨) 규칙: 법령명이 서로 다른 근거가 섞이므로 각 버튼·행에 법령 약칭을 붙인다.
// 잘 알려진 약칭 맵 + "…시행령/…시행규칙" 접미 유지, 계약예규는 "(계약예규)" 접두 제거.
const LAW_SHORT_NAMES: [RegExp, string][] = [
  [/^국가를 당사자로 하는 계약에 관한 법률/, "국가계약법"],
  [/^지방자치단체를 당사자로 하는 계약에 관한 법률/, "지방계약법"],
  [/^조달사업에 관한 법률/, "조달사업법"],
  [/^중소기업제품 구매촉진 및 판로지원에 관한 법률/, "판로지원법"],
  [/^전자조달의 이용 및 촉진에 관한 법률/, "전자조달법"],
  [/^하도급거래 공정화에 관한 법률/, "하도급법"],
  [/^녹색제품 구매촉진에 관한 법률/, "녹색제품법"],
  [/^중증장애인생산품 우선구매 특별법/, "중증장애인생산품법"],
  [/^여성기업지원에 관한 법률/, "여성기업법"],
  [/^장애인기업활동 촉진법/, "장애인기업법"],
  [/^국고금 관리법/, "국고금관리법"],
];

export function shortLawName(law: string): string {
  const cleaned = law.replace(/^\(계약예규\)\s*/, "");
  for (const [pattern, short] of LAW_SHORT_NAMES) {
    if (pattern.test(cleaned)) {
      const suffix = cleaned.match(/시행령|시행규칙/)?.[0];
      return suffix ? `${short} ${suffix}` : short;
    }
  }
  return cleaned;
}

// 근거별 [조문 확인] 버튼 — 팝업 없이 법제처 해당 조문으로 바로 이동한다(운영자 지시, 2026-07-16).
// 법령(statute)은 조 단위 딥링크(officialUrl/제N조), 행정규칙은 규칙 본문으로 이동.
// 라벨은 조까지, 항이 있으면 항까지 표기한다.
export function ArticleLinkButtons({ result }: { result: NodeVerificationResult }) {
  const linked = result.bases.filter(({ sources }) => sources[0]?.officialUrl);
  if (linked.length === 0) return null;
  return (
    <span className="article-link-buttons">
      {linked.map(({ basis, sources }, index) => {
        const { jo, hang } = parseArticleParts(basis.article ?? "");
        const source = sources[0];
        const deepable = jo && /law\.go\.kr\/(법령|행정규칙)\//.test(source.officialUrl);
        const href = deepable ? `${source.officialUrl.replace(/\/+$/, "")}/${jo}` : source.officialUrl;
        const label = jo ? `${jo}${hang ?? ""}` : "조문 확인";
        return (
          <a
            key={`${basis.law}:${basis.article}:${index}`}
            className="article-link-button"
            href={href}
            target="_blank"
            rel="noreferrer"
            title={`${basis.law} ${basis.article} — 국가법령정보센터 현행 원문으로 이동`}
            onClick={(event) => event.stopPropagation()}
          >
            ✓ {label} ↗
          </a>
        );
      })}
    </span>
  );
}

// 법적 근거 행 목록 — 요지 대신 **인용 단위의 원문**을 보여준다(운영자 지시, 2026-07-16).
// 조 인용이면 조 원문, 항 인용이면 populate가 항 단위로 추출한 그 항의 원문만.
// 라벨 채번: 법령 약칭 + 조(항) + (조문 제목). 원문 미수록이면 요약으로 대체하지 않고 안내만.
export function ArticleBasisRows({ result }: { result: NodeVerificationResult }) {
  if (result.bases.length === 0) return <p className="article-basis-empty">명시 조문 확인 필요</p>;
  return (
    <div className="article-basis-rows">
      {result.bases.map(({ basis, sources, sourceText, articleTitle }, index) => {
        const { jo, hang } = parseArticleParts(basis.article ?? "");
        const source = sources[0];
        const deepable = source?.officialUrl && jo && /law\.go\.kr\/(법령|행정규칙)\//.test(source.officialUrl);
        const href = deepable
          ? `${source.officialUrl.replace(/\/+$/, "")}/${jo}`
          : source?.officialUrl;
        const label = `${shortLawName(basis.law)} ${jo ? `${jo}${hang ?? ""}` : basis.article}`;
        return (
          <article key={`${basis.law}:${basis.article}:${index}`} className="article-basis-row">
            <div className="article-basis-head">
              <strong>
                {label}
                {articleTitle ? <span className="article-basis-title">({articleTitle})</span> : null}
              </strong>
              {href && (
                <a
                  className="article-link-button"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  title={`${basis.law} ${basis.article} — 국가법령정보센터 현행 원문으로 이동`}
                  onClick={(event) => event.stopPropagation()}
                >
                  원문 ↗
                </a>
              )}
            </div>
            {sourceText ? (
              <pre className="article-basis-source">{sourceText}</pre>
            ) : (
              <p className="article-basis-nosource">원문 미수록 — [원문 ↗]에서 확인</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

// 노드의 [법적 근거] 버튼과 그 팝업 (운영자 지시, 2026-07-26).
// 업무구조도 안에 근거를 펼쳐 두면 캔버스의 '법적 근거' 블록과 같은 내용이 두 번
// 나온다. 노드에서는 버튼만 두고, 원문은 넓은 팝업에서 본다.
// 팝업이 담는 것은 **요약이 아니라 조문 원문**이다(원문 우선 원칙).
export function NodeLegalButton({
  node,
  verification,
  annexRefs = [],
}: {
  node: ProcessNode;
  verification?: SourceVerification;
  annexRefs?: AnnexRef[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const result = getNodeVerification(node, verification);
  const count = result.bases.length;
  if (count === 0) return null;

  // 팝업을 닫으면 열었던 버튼으로 포커스를 되돌린다. 그렇지 않으면 포커스가 body로
  // 빠져 키보드 사용자는 처음부터 다시 탐색해야 하고, 화면도 원래 보던 노드가 아닌
  // 곳으로 튄다.
  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
      triggerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="node-legal-button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        법적 근거 {count}건
      </button>
      {open && (
        <NodeLegalModal node={node} result={result} annexRefs={annexRefs} onClose={close} />
      )}
    </>
  );
}

/** 노드 카드 안에 놓는 [법적 근거] 트리거.
 *  카드 자체가 <button>이라 그 안에 <button>을 넣을 수 없다 — span에 role을 준다.
 *  카드 선택 이벤트로 번지지 않도록 클릭·키 입력을 모두 멈춘다. */
export function NodeLegalChip({
  node,
  verification,
  annexRefs = [],
  inverse = false,
}: {
  node: ProcessNode;
  verification?: SourceVerification;
  annexRefs?: AnnexRef[];
  inverse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const result = getNodeVerification(node, verification);
  const count = result.bases.length;
  if (count === 0) return null;

  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
      triggerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        className="node-legal-chip"
        data-inverse={inverse ? "true" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${node.name} — 법적 근거 ${count}건 보기`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
      >
        법적 근거 {count}
      </span>
      {open && (
        <NodeLegalModal node={node} result={result} annexRefs={annexRefs} onClose={close} />
      )}
    </>
  );
}

/** 이 노드가 인용한 법령에 딸린 별표·서식 내려받기.
 *  법제처가 주는 파일은 HWP(한글)다 — PDF가 아니므로 브라우저에서 미리보기가 되지
 *  않는다. 그래서 링크 라벨에 형식을 밝히고 내려받기(↓)로 표시한다.
 *  파일이 없는 별표는 링크를 만들지 않고 제목만 남긴다(죽은 링크를 만들지 않는다). */
function NodeAnnexDownloads({
  result,
  annexRefs,
}: {
  result: NodeVerificationResult;
  annexRefs: AnnexRef[];
}) {
  const strip = (name: string) => name.replace(/^\([^)]*\)\s*/, "").trim();
  const cited = new Set(result.bases.map(({ basis }) => strip(basis.law)));
  const mine = annexRefs.filter((ref) => cited.has(strip(ref.law)));
  if (mine.length === 0) return null;

  return (
    <section className="node-legal-annexes">
      <h4>이 조문에 딸린 별표·서식</h4>
      <div className="node-legal-annex-list">
        {mine.map((ref) => (
          <div key={`${ref.law}::${ref.annex}`} className="node-legal-annex">
            <strong>{ref.label}</strong>
            <span>{ref.title}</span>
            <span className="node-legal-annex-files">
              {ref.pdfUrl && (
                <a
                  href={ref.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`${ref.law} ${ref.label} ${ref.title} — PDF 내려받기`}
                >
                  PDF ↓
                </a>
              )}
              {ref.hwpUrl && (
                <a
                  href={ref.hwpUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`${ref.law} ${ref.label} ${ref.title} — HWP(한글) 내려받기`}
                >
                  HWP ↓
                </a>
              )}
              {!ref.pdfUrl && !ref.hwpUrl && <em>파일 없음</em>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function NodeLegalModal({
  node,
  result,
  annexRefs = [],
  onClose,
}: {
  node: ProcessNode;
  result: NodeVerificationResult;
  annexRefs?: AnnexRef[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // 노드 카드가 <button>이라 그 안에서 오버레이를 그리면 레이아웃이 카드에 갇히고
  // 클릭도 카드로 샌다. body로 포털해서 화면 전체를 덮게 한다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Tab이 팝업 밖으로 새지 않도록 가둔다 — 뒤 페이지로 빠지면 사용자는
      // 자기가 어디에 있는지 알 수 없다.
      if (e.key !== "Tab" || !modalRef.current) return;
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !modalRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="node-legal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="node-legal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${node.name} 법적 근거`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="node-legal-modal-head">
          <div>
            <span>{node.id} · 법적 근거</span>
            <strong>{node.name}</strong>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="node-legal-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        <div className="node-legal-modal-status">
          <VerificationMark result={result} />
          <p>{result.detail}</p>
        </div>

        <div className="node-legal-modal-body">
          <ArticleBasisRows result={result} />
          <NodeAnnexDownloads result={result} annexRefs={annexRefs} />
          {result.bases.flatMap(({ unresolved }) => unresolved).map((item) => (
            <div key={`${item.reasonCode}:${item.law}`} className="node-legal-modal-unresolved">
              <strong>{unresolvedReasonLabels[item.reasonCode]}</strong> · {item.law}
              <span>다음 확인: {item.nextStep}</span>
            </div>
          ))}
          <p className="node-legal-modal-note">
            검증 범위는 조문 번호의 현행 원문 존재 여부입니다. 해석과 사건별 적용 판단은 포함하지 않습니다.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="process-verification-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ProcessVerificationSummaryBar({
  process,
  verification,
  compact = false,
}: {
  process: ProcessModel;
  verification?: SourceVerification;
  compact?: boolean;
}) {
  const summary = summarizeProcessVerification(process, verification);
  const unresolvedSources = verification?.unresolved?.length ?? 0;
  const checkedLabel = verification?.articleVerification
    ? `명시 조문 ${summary.verifiedReferences}/${summary.articleReferences}건 확인`
    : "공식 출처 검증 정보 없음";

  return (
    <div
      className={`process-verification-summary${compact ? " is-compact" : ""}`}
      data-process-verification-summary="true"
    >
      <div className="process-verification-summary-copy">
        <span>법적 근거 검증</span>
        <strong>{checkedLabel}</strong>
        {verification && (
          <small>
            기준일 {verification.verifiedAt}
            {unresolvedSources > 0 ? ` · 범위별 출처 ${unresolvedSources}건` : ""}
          </small>
        )}
      </div>
      <div className="process-verification-metrics" aria-label="업무구조도 검증 요약">
        <Metric label="근거 노드" value={`${summary.legalNodes}/${summary.totalNodes}`} />
        <Metric
          label="원문 확인"
          value={summary.articleVerifiedNodes + summary.sourceLinkedNodes}
        />
        <Metric
          label="추가 확인"
          value={summary.scopeLimitedNodes + summary.needsReviewNodes}
        />
        <Metric label="현장 검증" value={summary.fieldCheckNodes} />
      </div>
    </div>
  );
}

export function VerificationLegend() {
  const items: Array<{ state: NodeVerificationState; label: string }> = [
    { state: "article-verified", label: "조문 확인" },
    { state: "source-linked", label: "원문 연결" },
    { state: "scope-limited", label: "범위별 출처" },
    { state: "needs-review", label: "출처 확인" },
  ];

  return (
    <div className="process-legend-group">
      <strong>검증</strong>
      <div className="process-legend-items">
        {items.map(({ state, label }) => {
          const visual = STATE_STYLE[state];
          return (
            <span key={state}>
              <i
                aria-hidden="true"
                style={{
                  color: visual.color,
                  background: visual.background,
                  borderColor: visual.border,
                }}
              >
                {visual.icon}
              </i>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
