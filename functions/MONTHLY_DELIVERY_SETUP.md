# 월식 배송 보드

admin.html의 **월식 배송** 탭과 monthly-delivery.html의 기사님 화면을 연결한다.
Google Sheets 생성·복사 없이 기존 월식 주문·배송·정산 데이터로 운영한다.

## 배포

1. Deploy Functions Actions에 `functions:monthlyDeliveryApi`만 입력해 배포한다.
2. Deploy Firestore Rules Actions를 실행한다.
3. 프론트 PR을 머지하면 GitHub Pages에 admin·기사님 화면이 반영된다.

전체 함수 배포는 러너에 없는 기존 환경변수를 지울 수 있으므로 하지 않는다.
새 함수는 기존 Firebase 관리자 ID 토큰 검증과 한국 공휴일 판정을 이용하며
별도 Google 계정·지도 API 키·결제 서비스 키가 필요 없다.

## 데이터와 권한

- `monthlyDeliveryBoards/{YYYY-MM-DD}`: 날짜별 코스·업체 순서·버전·공유 링크.
- `monthlyDeliveryTemplates/{mon..fri}`: 요일 기본 배정. 저장된 날짜는 기본 템플릿을 덮어쓰지 않는다.
- `monthlyDeliveryShares/{sha256(token)}`: 날짜·코스·만료·해제 상태.
- 코스에는 배송 대상이 아닌 업체 ID도 남겨 휴무 복귀 시 순서를 복원한다.
- 기존 `orders`, `orderDefaultSnapshots`, `orderLocks`, `users`, `userPrivate`,
  `config`, `deliveryRecords`, `deliveryRecordArchive`에서 실제 배송 대상을 계산한다.
- 최초 업체 배정은 기존 **배달동선** 시트의 월~금 탭에 있는 코스·방문 순서로 자동 구성한다.
  `monthlyDeliverySheet.js`의 검증된 탭 ID·행 위치로 현재 상단 코스만 읽는다.
  금요일 아래쪽 과거 코스는 가져오지 않는다. 원본 시트에는 쓰지 않는다.
  전체 고객명으로 연결해 휴무 고객의 순서도 보존하며, 유일하게 연결되는 별칭만 사용한다.
  미등록·동명이인·새 업체의 이름을 연결하지 못하면 미배정으로 표시한다.
  월~금 전체 고객의 기본 배정을 미리 저장하며, 해당 요일에서 빠진 고객은 다른 요일에서
  확인되는 기본 코스를 사용한다. 휴무·중지 고객도 기본 코스에 보존하고 날짜별 화면에서만 제외한다.
  날짜별 직접 편집 → 요일 기본 코스 → 원본 시트 순으로 우선하며 이미 배정한 업체는 다시 옮기지 않는다.
  시트 읽기는 서버에서 캐시하고, 일시 실패 시 이전에 읽은 시트·저장한 코스를 유지한다.
  저장된 날짜의 새 업체 자동 배정은 revision 검사로 기록해 기사님 화면에도 반영한다.
- admin이 코스 카테고리를 추가·이름/차량 수정·표시 순서 변경·삭제한다.
  삭제 시 업체는 미배정으로 옮기고 공유 링크를 해제한다. 미배정만 남아도 저장할 수 있다.
- 클라이언트 Firestore 쓰기는 모두 차단한다. admin은 보드·템플릿만 읽는다.
  공유 토큰은 Firestore에서 읽을 수 없고, admin API가 해당 코스 토큰을 반환한다.
- 기사님은 날짜·코스에 묶인 무작위 링크로 API를 호출한다. URL fragment로 전달해
  웹 서버 요청·Referrer에 토큰이 붙지 않는다. 담당 코스 배송 정보만 반환한다.
  공유 링크는 해당 날짜 이후 2일의 끝에 만료되며 admin이 즉시 해제할 수 있다.
- admin만 배정·순서·기본 코스·공유·휴무를 수정한다. 기사님은 당일 완료·취소만 한다.
  코스 저장은 revision 검사, 완료는 주문 signature 검사와 Firestore 트랜잭션을 사용한다.
- 완료는 기존 날짜별 배송기록과 월 정산을 같은 트랜잭션으로 갱신한다.
  중복 완료를 재청구하지 않고, 보류·입금·조정·이월·송장번호를 보존한다.
  `manualMonthly` 엑셀 정산은 자동 재계산을 거부한다.

## 검증

`functions/`에서 `npm run test:unit`, `npm run lint`, `npm run test:smoke`,
`npm run test:emulator`를 실행한다. 에뮬레이터는 `demo-gjsuragan-safety`를 사용하며
운영 고객·주문을 수정하지 않는다.

운영 사용 순서와 유효기간·갱신 간격은 `manual.html#monthly-delivery`에 있다.
