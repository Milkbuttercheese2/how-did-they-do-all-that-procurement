# 미해결 출처·조문 추적 대장

> ## 🔴 다음 세션 최우선 지시 (운영자, 2026-07-16)
> **전체 제도의 법적 근거 내용을 전수 재검토하라.** 종심제(comprehensive-evaluation-award)를 비롯해 노드의 법적 근거가 **잘못 선택되었거나 비어 있는** 사례가 발견됨.
> 1. `web/scripts/audit-legal-bases.mjs` + `npm run verify:citation-content` 재실행으로 기계 후보 추출
> 2. **근거 미기재(not-cited) 노드 전수 목록화** — 기계 감사에 빈 legal_basis 검출 추가 권장
> 3. Opus 정정 + Fable 검토 병렬로 오귀속·공란 정정(종심제 최우선), 법제처 원문 대조 필수(규칙 16·17)
> 4. 완료 후 나머지 시간은 컨텐츠 생성 계속(백로그 `docs/topic-backlog.md`, _pending 4종 검토 승격 포함)


규칙 20(content-principles)에 따라, 법제처에서 출처를 찾지 못했거나 조문 대조가 불가한 항목을 기록한다.
**매 세션 시작 시 이 대장의 미해결 항목 재탐색을 우선 시도**하고, 해소되면 상태를 갱신한다.

| # | 제도(slug) | 미해결 항목 | 사유 | 마지막 탐색 | 다음 조치 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | stockpile-goods | 조달청 비축사업 운영규정 | 법제처 행정규칙 검색에서 현행 게시본 식별자 미확정(연혁본 2100000195854, 최신 훈령 제2226호 추정) | 2026-07-16 | 법제처에서 현행 발령본 serial 확정 후 sources 연결, 안 되면 pps.go.kr 출처 URL 워크시트 기록 | 미해결 |
| 2 | international-bidding | 공공계약에서의 국제입찰 대상금액(기획재정부 고시) | 법제처 행정규칙 검색 미등록(국가계약용, 2026-07-16 확인 — 행안부 지자체용만 존재) | 2026-07-16 | 기재부 관보·홈페이지에서 최신 고시번호·금액 확인, 법제처 등재 여부 주기 재확인 | 미해결 |
| 3 | social-enterprise-preference | 사회적기업 제품 우선구매 지침(고용노동부) | 법제처 행정규칙 검색 미등록(2026-07-16 확인) | 2026-07-16 | 고용노동부 홈페이지 현행 지침 확인, 법제처 등재 여부 주기 재확인 | 미해결 |
| 4 | procurement-fees | 조달수수료 고시 사업별 요율표 수치 | 법제처 행정규칙 본문은 조회되나(get_admin_rule serial 2100000268918) 요율표가 이미지(img 태그)로 게시되어 사업별·계약금액 구간별 요율 수치를 기계 추출 불가 | 2026-07-24 | 별표 이미지 OCR 또는 조달청 pps.go.kr 게시 요율표로 수치 확보 후 fieldVerification 해소, 개별 요율 콘텐츠 반영 | 미해결 |
| 5 | procurement-fees | 조달수수료 면제 등에 관한 지침(조달청 훈령) 본문 | search_admin_rule로 존재·식별자(serial 2100000273486, 훈령, 2026-01-22)는 확인했으나 이 세션에서 조문 전문 미조회 | 2026-07-24 | get_admin_rule로 면제·감경 세부 대상 전문 조회 후 articleTexts 보강 | 미해결 |

- 2026-07-16: 위 3건은 운영자 명시 지시("출처소스를 찾을 수 없으면 못 찾는다 기록하고 일단 배포")로 article-verified 상태로 배포함(v0.17.0). 검증 게이트·validate 규칙 자체는 엄격 기준을 유지하며, 이 예외는 본 대장으로 추적한다. 다음 통합 시 validate가 이 3건을 다시 지적하면 이 대장을 확인하라.

## 진행 중 작업 재개 정보 (2026-07-17, 세션 한도로 중단)

전 제도 법적 근거 전수 재검토(61개 중 **약 25개 완료 + 종심제 직접 정정**). 잔여 ~36개는 세션 한도(1:50am UTC 리셋)로 중단됨. 재개 방법: 아래 runId를 resumeFromRunId로 재실행하면 완료분은 캐시 재생된다(스크립트: scratchpad/legal-recheck-wf.js — 소멸 시 이 대장의 그룹 목록으로 재작성).
- wf_48bd5f46-423 그룹1(debarment·direct-production·total-and-unit·procurement-request·contract-method·international-bidding — 종심제는 직접 정정 완료로 제외 가능)
- wf_b8f1d7ff-a98 (inspection-and-acceptance·qualification-screening·innovation-product·social-enterprise·designated-competitive·innovation-trial / contract-termination·subcontract·stockpile·contract-dispute·bid-announcement·long-term)
- wf_425e29fc-812 그룹2(bidder-registration·price-survey·government-furnished·quality-inspection·price-fluctuation·bid-protest)
- wf_0e753137-34a 그룹1(invalid-bids·design-change·performance-certification·shopping-mall·excellent-product·procurement-contract-disclosure)
- 완료 그룹들의 Fable 검증(verify) 단계도 한도로 대부분 미실행 — 재개 시 검증 단계부터 캐시 재생됨.

## 2026-07-17 — 신규 3종 조문 원문 미수록(배포 보류)

기타 계약내용의 변경·계약심의위원회·개산계약 3종은 **콘텐츠·출처는 검증 통과**(Fable 적대검증 pass, sources 전건 연결, unresolved 0)했으나, 시행령·법률 조문 **원문(articleTexts)**을 이 세션에서 확보하지 못해 needs-review로 _pending 보류했다.
- 원인: 이 세션 법제처 API 조문 본문조회가 전 조문 NOT_FOUND, 지능형 검색은 긴 조문을 절단, law-cache는 예규만 전문(법률·시행령·시행규칙은 목차만). **콘텐츠 결함이 아니라 도구 장애.**
- 이미 확보분: 예규 원문 15건 전건 수록 완료(law-cache 추출), 개산계약 시행령 제70조제1항 확보, 계약심의위 시행령 제94조 요지를 확인 원문 기준 의무형("설치·운영해야 한다")으로 교정.
- 미확보: 기타변경(법 제19조·영 제66조·규칙 제74조의3), 계약심의위(영 제94조 각 항·호·법 제7조제1항), 개산계약(영 제70조제2·3항·제73조 전항·법 제23조).
- 다음 조치: **API 복구 세션에서** `populate-article-texts.mjs`(KOREAN_LAW_CLI) 또는 지능형 검색 완전본으로 위 조문 원문을 채우고, uncheckable=0 확인 후 article-verified 승격→manifest 재편입→배포. 파일은 web/data/_pending/에 예규 원문·교정 반영된 상태로 보존.

## 2026-07-25 — reinspection-request 제도 경계 재검토(흡수 권고, 미실행)

Opus 적대검증 결과 `reinspection-request`(검사 이의와 재검사 요청)를 `inspection-and-acceptance`(검사와 검수)에 **흡수(B안)**하라는 권고가 나왔다. 근거:
- 재검사에는 독립 조문 체계가 없다. 물품구매(제조)계약일반조건 제19조제7항, 공사계약일반조건 제27조제6항 후단, 용역계약일반조건 제20조제6항 후단 — 전부 **검사 조문 안의 1개 항**이다. 법 제14조·시행령 제55조에는 재검사 규정 자체가 없다. 대비: 「입찰·낙찰 이의신청」은 법 제28조라는 독립 조문(기한 법정)을 갖는다.
- process 노드 8개 중 7개가 다른 제도와 같은 조·항을 중복 서술한다(P05는 inspection P06과 노드명·조항·status까지 동일, P08은 지체상금 소관).
- 유일한 비중복 노드 P03은 준공검사 불복이 아니라 **시공 중 공사자재 사전검사**(공사 제12조)로, 파일 표제와 다른 절차를 가리킨다.

**흡수 시 반드시 함께 고칠 것(그대로 옮기면 안 되는 오류):**
- P04 `deadline`이 시행령 제55조제1항의 14일(= 이행완료 통지일부터 기산하는 **최초 검사** 기한)을 재검사 기한인 것처럼 귀속했다. 재검사 기한을 정한 규정은 없고, 물품만 "지체없이"(제19조제7항)다.
- P08이 지체일수 산입에서 **① 납품기한 이후 시정조치라는 전제와 ② 검사기간 상한**(물품 제24조제4항제1호 단서)을 누락해 제재 규모를 과대 서술했다.
- P01의 통지 주체가 검사공무원으로 되어 있으나 원문은 계약담당공무원(물품 제19조제8항·공사 제27조제6항)이다.
- `verification.notes`가 국가계약분쟁조정 근거를 법 제28조로 적었으나 제28조는 이의신청이고 그 열거 사유에 검사 결과가 없다.

미실행 사유: 제도 삭제는 manifest 85건 우선순위 재배열을 수반해 이번 병합 범위를 넘는다. 다음 사이클에서 단독 커밋으로 처리한다.
