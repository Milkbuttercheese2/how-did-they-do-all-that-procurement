# 중복 제거 계획 — 2026-07-25

`docs/content-principles.md` 규칙 22(제도 간 중복 금지)에 따른 전수조사 결과와 처리 계획.

## 조사 방법

전 제도 쌍(90개 → 4,005쌍)에 대해 ① 인용 조문(법령+조·항) 교집합, ② 인용 조문 집합 자카드 유사도, ③ 노드 이름 일치·포함 수를 계산했다. 규칙 22(c) 기준 초과 쌍 **50쌍**이 나왔고, 그중 **상위 15쌍 전부가 `related`로도 연결되어 있지 않았다**.

핵심 진단: **제도 수준 중복보다 노드 수준 복제가 문제였다.** 3개 이상 제도에 같은 이름으로 존재하는 노드가 13종이다.

| 복제 수 | 노드 이름 | 존재 제도 |
|---|---|---|
| 6 | 계약 체결 | contract-method-decision, designated-competitive-bidding, general-competitive-bidding, international-bidding, procurement-contract-disclosure, restricted-competitive-bidding |
| 4 | 계약정보 공개 | contract-by-negotiation, contract-signing, emergency-disaster-procurement, negotiated-contract |
| 3 | 대가 지급 | advance-payment-and-settlement, shopping-mall-purchase, total-and-unit-price-contract |
| 3 | 전자입찰서 접수마감 | bid-opening-award-notice, general-competitive-bidding, partial-quantity-bidding |
| 3 | 계약보증금 납부 | construction-performance-guarantee, contract-signing, third-party-unit-price-contract |
| 3 | 계약상대자 결정·계약 체결 | contract-by-negotiation, emergency-disaster-procurement, negotiated-contract |
| 3 | 입찰서 제출 | designated-competitive-bidding, international-bidding, restricted-competitive-bidding |
| 3 | 재공고입찰 | designated-competitive-bidding, lease-goods-contract, restricted-competitive-bidding |
| 3 | 지정취소 | excellent-product-designation, excellent-product-joint-brand-designation, venture-nara |
| 3 | 나라장터 공고 게시·전자입찰 개시 | general-competitive-bidding, lease-goods-contract, partial-quantity-bidding |
| 3 | 입찰보증금 납부 | general-competitive-bidding, invalid-bids, partial-quantity-bidding |
| 3 | 서류 보완 요구 | mas-two-stage-competition, multiple-award-schedule, pre-qualification |
| 3 | 검사·검수 | shopping-mall-purchase, third-party-unit-price-contract, total-and-unit-price-contract |

## 1. 완료 — 제도 병합·삭제 2건 (90 → 88)

### `reinspection-request` → `inspection-and-acceptance` 흡수 (완료)
재검사는 독립 조문 체계가 없다. 물품구매(제조)계약일반조건 제19조**제7항**, 공사계약일반조건 제27조제6항 후단, 용역계약일반조건 제20조제6항 후단 — 전부 **검사 조문 안의 한 개 항**이다. 법 제14조·시행령 제55조에는 재검사 규정 자체가 없다. 노드 8개 중 7개가 다른 제도와 같은 조·항을 중복 서술했고, 유일한 비중복 노드(P03)마저 준공검사 불복이 아니라 시공 중 공사자재 사전검사였다. 규칙 22(d) 위반.

→ `inspection-and-acceptance`에 **P13 「검사 이의·재검사 요청」** 노드로 흡수(간선 E20: P07→P13, L20: P13→P05 재검사 회귀). 물품만 "지체없이" 재검사 의무이고 공사·용역은 재검사 기한 규정이 없다는 사실을 `deadline`에 명시했다.

### `tax-evasion-debarment` → `debarment` 흡수 (완료)
노드 4개에 **고유 조문이 단 1개**(법 제27조의5)뿐이었다. 제27조의5는 제27조 제재 계열의 특칙이고 제2항이 제27조제3항을 준용한다. 제재당하는 업체 레인도 노드도 없어 사용자 관점이 비어 있었다.

→ `debarment`에 **P14 「조세포탈 유죄 확정 — 기속 제재(2년)」** 노드로 흡수(P02 판정에서 분기, S01 게재로 합류). 제27조의 재량 제재(1개월~2년, 감경 가능)와의 차이가 오히려 한 화면에서 드러난다.

**후속**: manifest 88건 priority 1..88 재부여, taxonomy 정리, `related` 참조 정리 완료. 검증 통과 — 제도 88개 / 노드 1092 / 연결 1182.

## 2. 운영자 결정 대기 — 병합 후보 1건

### `emergency-disaster-procurement`(재난·긴급 수의계약) ↔ `negotiated-contract`(수의계약)
자카드 **0.41**(전체 최고 수준). 견적서 제출·재견적 요구·견적가격 적정성 심사·계약상대자 결정·계약정보 공개 **5개 노드**가 겹친다. 고유한 것은 "재난 사유 판정" 하나이고 그것도 영 제26조제1항제1호가목 **한 목**이다.

- (A) 흡수 — `negotiated-contract`의 "수의계약 사유 판정" 분기로 접는다. 조문 체계상 정확하다.
- (B) 유지 + 재조정 — 재난 대응의 실무 중요도를 고려해 제도는 남기되, 견적 이후 공통 절차를 잘라내고 `negotiated-contract`로 넘긴다.

## 3. 미착수 — 범위 재조정 대상 14건

제도는 유지하고, **자기 절차가 아닌 공통 꼬리를 잘라 종착 `notice` 노드 하나로 넘기고 `related`로 연결**한다(규칙 22(a)). 병합이 아니다 — 아래 제도들은 각각 독립 조문 체계를 갖는다.

| # | 제도 | 잘라낼 구간 | 넘길 곳 |
|---|---|---|---|
| 1 | `general-competitive-bidding` | 입찰보증금 납부, 전자입찰서 접수마감, 개찰, 낙찰자 결정, 계약 체결 | 입찰보증금과 계약보증금 / 개찰과 낙찰자 결정 통보 / 계약서 작성과 계약 체결 |
| 2 | `restricted-competitive-bidding` | 입찰서 제출, 개찰, 적격심사·낙찰자 결정, 재공고입찰, 계약 체결 | 개찰과 낙찰자 결정 통보 / 적격심사낙찰제 / 재입찰·재공고와 유찰 처리 |
| 3 | `designated-competitive-bidding` | 입찰서 제출, 개찰, 적격심사·낙찰자 결정, 재공고입찰, 계약 체결 | 위와 동일 |
| 4 | `partial-quantity-bidding` | 입찰보증금 납부, 나라장터 공고 게시·전자입찰 개시, 전자입찰서 접수마감 | 입찰공고 / 입찰보증금과 계약보증금 / 전자입찰과 본인확인 |
| 5 | `contract-method-decision` | 나라장터 공고 게시, 낙찰자 결정, 계약 체결 | 입찰공고 / 개찰과 낙찰자 결정 통보 / 계약서 작성과 계약 체결 |
| 6 | `international-bidding` | 입찰서 제출, 계약 체결 | 개찰과 낙찰자 결정 통보 / 계약서 작성과 계약 체결 |
| 7 | `negotiated-contract` | 계약정보 공개 | 계약정보 공개 |
| 8 | `contract-by-negotiation` | 계약상대자 결정·계약 체결, 계약정보 공개 | 계약서 작성과 계약 체결 / 계약정보 공개 |
| 9 | `debarment` | 처분 사전통지, 의견제출, 행정쟁송·집행정지 대응 | (사전통지·의견제출은 유지) 행정쟁송은 **부정당업자 제재처분에 대한 불복** |
| 10 | `penalty-surcharge` | 처분 사전통지, 의견제출, 행정쟁송·집행정지 대응 | 부정당업자 입찰참가자격 제한 / 부정당업자 제재처분에 대한 불복 |
| 11 | `bid-protest` | 재심청구 이후(국가계약분쟁조정위원회 심사·조정·종결) | 국가계약분쟁조정위원회 조정 |
| 12 | `performance-certification-product` | 우선구매 요구·조치 통보 공통부 | 기술개발제품 우선구매 |
| 13 | `tech-development-priority-purchase` | 12와 경계 재조정(어느 쪽이 우선구매 절차를 전담할지 결정) | — |
| 14 | `advance-payment-and-settlement` | 검사조서 작성 | 검사와 검수 |

**공통 작업**: 잘라낸 자리마다 종착 `notice` 노드 1개("○○ 절차로 진행")를 두고, 양쪽 `related`에 서로를 추가한다(문자열은 상대 제도의 `name`과 정확히 일치해야 링크가 걸린다). 규칙 22(e).

**추가**: 규칙 22(e)에 따라 `related` 미연결인 고중복 쌍 15개도 함께 연결한다 — contract-method-decision↔general-competitive-bidding, emergency-disaster↔negotiated-contract, designated↔restricted, general↔partial-quantity, bid-protest↔contract-dispute-mediation, contract-method↔restricted, contract-method↔designated, debarment↔penalty-surcharge, general↔restricted, inspection↔(흡수 완료), designated↔general, performance-certification↔tech-development, bid-opening↔invalid-bids, bid-opening↔qualification-screening, general↔invalid-bids.

## 4. 재조정 후 예상 효과

- 제도 88개 유지(2건 병합 완료, 1건 결정 대기)
- 복제 노드 약 40개 제거 → 노드 1,092 → 1,050 내외
- 사용자가 같은 절차를 여러 제도에서 조금씩 다르게 읽는 문제 해소
- 인접 제도 간 이동 경로(`related`) 확보
