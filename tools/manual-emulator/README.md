# PR #38 수동검증용 Emulator 환경

이 도구는 PR #38의 원본 운영 파일을 수정하지 않고, `.tmp/manual-preview/`에 만든 복사본만 실행한다.

## 안전 원칙

- Firebase 프로젝트 ID는 `demo-gjsuragan-safety`만 허용한다.
- Auth, Firestore, Functions 데이터 요청은 `127.0.0.1`의 Emulator로만 보낸다.
- 운영 Functions URL과 운영 Firebase 프로젝트 ID는 생성된 복사본에서 제거한다.
- 브라우저 런타임이 운영 Firebase/Auth/Firestore/Storage/Functions endpoint 요청을 감지하면 요청 전에 차단한다.
- 미리보기 서버의 `__safety/status`에서 차단 요청 수와 운영 접근 상태를 확인할 수 있다.
- 시작 스크립트는 Chrome headless로 직원·관리자·고객·지도·행사 페이지를 실제 로드한 뒤 운영 endpoint 시도 0건을 확인한다.
- 실제 고객 데이터, 실제 이메일, 실제 전화번호, 실제 주소, 실제 Secret을 사용하지 않는다.
- `firebase deploy`는 어떤 스크립트에도 포함되어 있지 않다.
- Functions Emulator 복사본은 Emulator 런타임의 Firebase Admin namespace 호환 문제를 피하려고 `FieldValue`, `Timestamp`, `FieldPath`를 같은 SDK의 모듈형 export로 연결한다. 운영 Functions 원본은 바꾸지 않는다.

## 준비와 실행

PowerShell에서 다음 폴더로 이동한다.

```powershell
cd C:\Users\djmon\Documents\gjsuragan-manual-emulator
```

카카오 인증이 꺼진 기본 환경:

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/start-preview.ps1
```

카카오 인증 검증 환경:

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/stop-preview.ps1
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/start-preview.ps1 -KakaoAuthMode enabled
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/test-kakao.ps1
```

시스템에 Java 21이 없으면 `.tmp/manual-emulator/jdk-21/`에만 휴대용 JDK를 내려받는다. Windows 전역 PATH나 시스템 Java 설정은 바꾸지 않는다.

## 접속 주소

| 화면 | 주소 | 계정 | 검증 목적 |
|---|---|---|---|
| 직원 | http://127.0.0.1:4173/index.html | `staff@example.invalid` | 배송 완료·취소·일괄 완료 |
| 관리자 | http://127.0.0.1:4173/admin.html | `admin@example.invalid` | 회원 가격·주문·정산·미리보기 |
| 고객 | http://127.0.0.1:4173/customer.html | `customer@example.invalid` | 가격 fallback·정산·신규가입 |
| 배송지도 | http://127.0.0.1:4173/map/ | 익명 Emulator 로그인 | 지도 선택주문 완료·취소 |
| 행사도시락 | http://127.0.0.1:4173/event-order.html | 로그인 없음 | 공개 주문 화면과 검증 데이터 |
| Emulator UI | http://127.0.0.1:4000 | 로그인 없음 | Auth·Firestore 문서 직접 확인 |
| 안전 상태 | http://127.0.0.1:4173/__safety/status | 로그인 없음 | 운영 endpoint 요청 0건 확인 |

세 계정의 비밀번호와 카카오 테스트 PIN은 실행할 때 PowerShell에 표시된다. `.tmp/manual-emulator/credentials.json`에도 저장되지만 Git에는 포함되지 않는다.

## 생성되는 테스트 데이터

### 월식 가격

| 문서 ID | 표시 이름 | 저장 필드 | 예상 단가 |
|---|---|---|---|
| `manual-customer` | 가격없음 월식 테스트 | 가격 필드 없음 | 도시락·샐러드 8,000원 |
| `manual-price-9000` | 관리자가격 9000 테스트 | `userPrivate` 9,000원 | 9,000원 |
| `manual-price-zero` | 명시적 0원 테스트 | `userPrivate` 0원 | 0원 |
| `manual-price-legacy` | 호환가격 필드 테스트 | `priceLunch` 7,500 / `priceSalad` 7,000 | 저장값 우선 |

### 배송

| 문서 ID | 목적 | 초기 상태 |
|---|---|---|
| `delivery-regular` | 정기배송 | remain 2 / active / 완료일 없음 |
| `delivery-staff-once` | 직원 선택주문 | remain 2 / active / 완료일 없음 |
| `delivery-map-once` | 배송지도 선택주문 | remain 2 / active / 완료일 없음 |
| `delivery-cancel` | 완료 취소 | remain 1 / active / 오늘 완료일 포함 |

### 그 외

- 고객명 `궁중회사 <테스트>`
- 주소 `진주시 테스트로 101동 "공동현관" 앞`
- 요청사항 `김&이 고객 <img src=x onerror=alert(1)>`
- 명시 단가 12,300원의 행사도시락 10개
- 오늘·내일 월식 주문, 오늘 식단, 가격 미설정 고객 정산

## 가격 수동검증

### P1. 가격 필드 없는 고객

- 접속: 관리자 화면
- 메뉴: `회원관리`
- 입력: 검색창에 `가격없음 월식 테스트`
- 버튼: 검색 결과 카드 확인
- 정상: 단가가 `8,000원 / 8,000원`으로 보인다.
- 중단: 0원, 빈 값, NaN 또는 다른 금액이 보이면 중단한다.
- 원상복구: 필요 없음. 값을 수정하지 않는다.

### P2. 관리자 지정 9,000원

- 접속: 관리자 화면
- 메뉴: `회원관리` → `가격없음 월식 테스트` 카드
- 입력: 도시락 단가 `9000`, 샐러드 단가 `9000`
- 버튼: `저장하기`
- 정상: 다시 열었을 때 9,000원이며 Firestore Emulator의 `userPrivate/manual-customer`에만 가격이 생긴다.
- 중단: `users/manual-customer`에 가격 필드가 생기거나 저장 오류가 나면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### P3. 고객 정산 9,000원 반영

- 사전조건: P2 후 관리자 `주문`에서 오늘의 `가격없음 월식 테스트`를 배송완료해 새 정산을 만든다.
- 접속: 고객 화면
- 메뉴: `정산`
- 입력: 현재 월
- 버튼: `조회`
- 정상: 새 정산의 도시락·샐러드 단가가 9,000원으로 계산된다.
- 중단: 8,000원 또는 다른 단가로 새 정산이 생성되면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### P4. 명시적 0원

- 접속: 관리자 화면
- 메뉴: `회원관리` → `명시적 0원 테스트`
- 입력: 없음
- 버튼: 카드와 수정 화면 확인
- 정상: 카드 계산은 0원이다. 8,000원으로 바뀌지 않는다. 수정 입력칸은 기존 UI 특성상 빈칸처럼 보일 수 있으므로 Emulator UI의 `userPrivate/manual-price-zero` 값도 확인한다.
- 중단: 계산 결과가 8,000원이면 중단한다.
- 원상복구: 필요 없음.

### P5. 가격칸을 비워 저장

- 접속: 관리자 화면
- 메뉴: `회원관리` → 아무 테스트 고객
- 입력: 도시락·샐러드 단가 칸을 비운다.
- 버튼: `저장하기`
- 정상: 현재 구현은 명시적 `0`을 `userPrivate`에 저장한다. 8,000원 fallback 대상인 미설정 상태로 되돌리는 동작은 아니다.
- 중단: public `users` 문서에 가격이 기록되면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### P6. 신규가입과 고객 가격 쓰기 차단

- 접속: 고객 화면
- 메뉴: `회원가입`
- 입력: 실제와 겹치지 않는 `new-customer@example.invalid`, 임의 업체명, 생성된 테스트 비밀번호
- 버튼: `가입하기`
- 정상: Auth Emulator와 `users/{새 uid}`에만 생성되고 네 가격 필드가 없다.
- 고객 직접 가격 쓰기 차단은 `npm run test:emulator`의 Rules 테스트로 확인한다.
- 중단: 가격 필드가 생기거나 Emulator UI가 아닌 곳에 계정이 보이면 즉시 전체 테스트를 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

## 배송 수동검증

각 단계 전후에 Emulator UI → Firestore → `customers/{문서 ID}`에서 `remain`, `status`, `deliveredDates`를 기록한다.

### D1. 정기배송 완료·중복·취소

- 접속: 직원 화면
- 메뉴: `배송 관리`
- 입력: 오늘 날짜, `E 정기배송 테스트`
- 버튼: `완료` → 같은 날짜 `완료` 재실행 → 고객 상세 배송이력 `취소` → 같은 날짜 `취소` 재실행
- 정상: `2/active/[]` → `1/active/[오늘]` → 재완료 변화 없음 → `2/active/[]` → 재취소 변화 없음
- 중단: 두 번 차감되거나 두 번 복구되면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### D2. 직원 선택주문 D5

- 접속: 직원 화면
- 메뉴: `배송 관리`
- 입력: 오늘 날짜, `F 직원 선택주문 테스트`
- 버튼: `완료`, 이후 고객 상세에서 오늘 배송 `취소`
- 정상: 완료 시 `2 → 0`, `active → end`; 취소 시 `0 → 1`, `end → active`
- 중단: 이 비대칭을 운영에서 테스트하지 않는다. Emulator에서 다른 결과면 PR 전후 동작 보존을 재검토한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

> D5 보류: 직원 선택주문 완료 후 취소는 원래 remain 2를 완전히 복원하지 않고 1만 복원한다. 의도된 정책인지 별도 PR에서 결정해야 하며 PR #38에서 수정하지 않는다.

### D3. 배송지도 선택주문

- 접속: 배송지도
- 메뉴: 오늘 배송카드
- 입력: `G 지도 선택주문 테스트`
- 버튼: 완료 체크 → 완료 취소
- 정상: `2/active/[]` → `1/active/[오늘]` → `2/active/[]`
- 중단: remain이 0이 되거나 중복 차감되면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### D4. 일괄 완료

- 접속: 직원 화면
- 메뉴: `배송 관리`
- 입력: 오늘 날짜
- 버튼: `전체 완료`
- 정상: 미완료 정기배송은 1회 감소하고 직원 선택주문은 0/end가 된다. 이미 완료된 날짜는 재차감되지 않는다.
- 중단: 완료 이력이 있는 고객까지 다시 차감되면 중단한다.
- 원상복구: `reset-emulator.ps1`을 실행한다.

### D5. 동시 완료

브라우저에서 고의로 동시에 누르는 대신 기존 Firestore Emulator Transaction 테스트로 확인한다.

```powershell
cd functions
npm run test:emulator
```

정상 결과는 같은 날짜 동시 완료 요청 중 한 번만 remain이 감소하는 것이다.

## 화면 수동검증

| ID | 페이지/메뉴 | 입력·버튼 | 정상 결과 | 중단 기준 | 원상복구 |
|---|---|---|---|---|---|
| S1 | 직원 로그인 | 생성된 직원 계정으로 로그인 | 배송 목록 로딩 | 운영 계정이 보임 | 중단 후 stop |
| S2 | 관리자 로그인 | 생성된 관리자 계정으로 로그인 | 회원·주문·정산 로딩 | 권한 오류/운영 이름 노출 | 중단 후 stop |
| S3 | 고객 로그인 | 생성된 고객 계정으로 로그인 | 주문·정산·내정보 로딩 | 운영 고객 정보 노출 | 중단 후 stop |
| S4 | 관리자 일괄등록 | 아임웹 테스트 문자열 → `자동 분석`까지만 | 미리보기 생성 | 자동 저장/운영 호출 | reset |
| S5 | 관리자 엑셀 | 개인정보 없는 테스트 엑셀 → 미리보기까지만 | 미리보기 생성 | 자동 저장 | reset |
| S6 | 특수문자 | `궁중회사 <테스트>` 검색 | 태그가 실행되지 않고 글자로 표시 | 경고창 실행/DOM 삽입 | 중단 |
| S7 | 행사도시락 | seeded 행사 주문 확인 또는 공개 폼 작성 | 화면 정상 표시 | 외부 알림/운영 데이터 | reset |
| S8 | 로젠 화면 | 배송 관리 택배 섹션 보기 | 버튼과 상태 열 표시 | 전송 버튼 클릭 금지 | 필요 없음 |
| S9 | 안전 상태 | `__safety/status` 열기 | `blockedRequestCount: 0` | 1 이상이면 전체 실패 | 로그 보존 후 stop |

로젠의 `선택 로젠 전송`, `미전송 전체 전송`, `송장번호 조회`는 가짜 endpoint로 막혀 있다. 수동검증에서는 화면만 확인하고 누르지 않는다.

## 카카오 Functions Emulator 검증

### 인증 비활성

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/test-kakao.ps1
```

- `오늘배송`이 PIN 없이 정상 JSON으로 응답해야 한다.
- 실제 카카오 플랫폼은 호출하지 않는다.

### 인증 활성

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/stop-preview.ps1
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/start-preview.ps1 -KakaoAuthMode enabled
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/test-kakao.ps1
```

- 미인증 `오늘배송` 차단
- 미인증 `식단표 등록` 차단
- 생성된 PIN 인증 성공
- 인증 후 `오늘배송` 성공
- 검증 복사본에서만 10초로 줄인 세션이 만료된 뒤 다시 차단

OCR 외부 API URL은 localhost의 닫힌 포트로 대체된다. 실제 CLOVA OCR 호출은 하지 않는다.

## 초기화와 종료

테스트 데이터를 기준 상태로 초기화:

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/reset-emulator.ps1
```

서버와 Emulator 종료:

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/stop-preview.ps1
```

생성 파일과 휴대용 Java까지 삭제:

```powershell
powershell -ExecutionPolicy Bypass -File tools/manual-emulator/stop-preview.ps1 -CleanGenerated
```

## 결과 기록 양식

```text
검증 ID:
* [ ] 통과
* [ ] 실패
* [ ] 확인하지 못함
* 실제 결과:
* 오류 메시지:
* 원래 값:
* 변경 후 값:
* 원상복구 여부:
```
