"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  AnnexRef,
  ProcessLaneGroup,
  ProcessModel,
  ProcessNode,
  SourceVerification,
} from "@/lib/types";
import { trackEvent } from "@/lib/client-events";
import DesktopProcessBoard from "./DesktopProcessBoard";
import PortraitProcessBoard from "./PortraitProcessBoard";

type ProcessMode = "summary" | "full";

export default function ProcessExplorer({
  process,
  verification,
  annexRefs = [],
  slug,
  laneGroups,
}: {
  process: ProcessModel;
  verification?: SourceVerification;
  /** 노드 근거 팝업에서 그 조문이 딸린 별표·서식을 내려받게 한다. */
  annexRefs?: AnnexRef[];
  slug: string;
  laneGroups?: ProcessLaneGroup[];
}) {
  const searchParams = useSearchParams();
  const defaultNodeId =
    searchParams.get("node") ??
    process.nodes.find((node) => node.status === "current")?.id ??
    process.nodes[0]?.id;
  const [mode, setMode] = useState<ProcessMode>(() =>
    searchParams.get("process") === "summary" ? "summary" : "full",
  );
  const [selectedNodeId, setSelectedNodeId] = useState(defaultNodeId);
  const selectedNode =
    process.nodes.find((node) => node.id === selectedNodeId) ?? process.nodes[0];

  function selectMode(nextMode: ProcessMode) {
    setMode(nextMode);
    updateDetailUrl("process", nextMode === "summary" ? "summary" : "");
    trackEvent("process_mode", { slug, mode: nextMode });
  }

  function handleNodeChange(nodeId: string | null) {
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    updateDetailUrl("node", nodeId);
    trackEvent("process_node_open", { slug, node_id: nodeId });
  }

  return (
    <div className="process-explorer process-explorer-v2">
      <div className="process-mode-bar">
        <p>
          {mode === "summary"
            ? "단계별 핵심 업무를 빠르게 훑어봅니다."
            : "행위자 레인과 게이트를 전체 표시합니다."}
        </p>
        <div className="process-view-controls">
          <div
            className="process-mode-control"
            role="group"
            aria-label="업무구조도 표시 범위"
          >
            <button
              type="button"
              aria-pressed={mode === "summary"}
              onClick={() => selectMode("summary")}
            >
              핵심 흐름
            </button>
            <button
              type="button"
              aria-pressed={mode === "full"}
              onClick={() => selectMode("full")}
            >
              전체 구조도
            </button>
          </div>
        </div>
      </div>

      <div className="process-desktop-board">
        <DesktopProcessBoard
          process={process}
          verification={verification}
          annexRefs={annexRefs}
          compact={mode === "summary"}
          selectedNodeId={selectedNode.id}
          onNodeChange={handleNodeChange}
        />
      </div>

      <div className="process-mobile-board">
        <PortraitProcessBoard
          key={slug}
          process={process}
          verification={verification}
          annexRefs={annexRefs}
          laneGroups={laneGroups}
          initialNodeId={defaultNodeId}
          onNodeChange={handleNodeChange}
          embedded
          showDrawer={false}
        />
      </div>
      {/* '노드 상세' 패널은 두지 않는다(2026-07-26). 근거는 노드 카드의
          [법적 근거] 버튼에서 팝업으로 바로 연다. */}
    </div>
  );
}

function updateDetailUrl(key: string, value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
