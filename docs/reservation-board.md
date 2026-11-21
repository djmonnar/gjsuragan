# 돌담명가 직원 공용 예약장

직원이 휴대폰으로 예약을 보고 등록·수정·삭제하는 화면이다. 예전 구글 시트 「직원 공용 예약장」을 대신한다.
네이버 예약은 오너비스타에서 읽어 같은 목록에 「N 네이버예약」으로 보인다.

- 화면: `reservations.html#token=<링크 열쇠>` (GitHub Pages)
- 서버: `functions/reservationBoard.js` (`reservationBoardApi`), 규칙은 `functions/reservationBoardModel.js`
- 관리: 매장 관리(`staff-admin.html#reservations`) → **직원 공용 예약장** 칸
- 화면 안 사용법: `assets/js/reservation-board.js` 의 `HELP`, 매장 관리 매뉴얼의 **돌담명가 예약**

## 링크

로그인 대신 링크 열쇠(64자 hex)를 쓴다. 관리자가 **공유 링크 만들기 / 새 링크 만들기**를 누르면 새 열쇠를 만들고
`reservationBoardConfig/share` 에 원문과 SHA-256 을 둔다. 서버는 요청의 열쇠를 SHA-256 으로 비교한다.
새 링크를 만들면 이전 링크는 서버가 링크를 기억하는 시간(`SHARE_CACHE_MS`, 30초) 안에 막힌다.

열쇠는 주소의 `#` 뒤에만 있어 서버 접속 기록과 다른 사이트로 새지 않는다. 화면은 열쇠를 그 휴대폰 `localStorage`
(`rb-token`)에도 둬서 홈 화면 아이콘으로 열어도 된다. 사용이 끝난 링크(403)면 저장한 열쇠를 지운다.

## 저장

모두 서버만 읽고 쓴다. Firestore 규칙에 이 컬렉션들의 `match` 가 없어 브라우저는 관리자라도 직접 못 연다.

| 컬렉션 | 내용 |
| --- | --- |
| `reservationBoardItems` | 직원이 적은 예약. 시트 칸 그대로(날짜·낮/밤·시간·예약자명·연락처·인원·메뉴·룸·예약경로·예약상태·비고·받은 직원) |
| `reservationBoardNaverNotes/{네이버 예약번호}` | 네이버 예약에 덧붙인 룸·비고 |
| `reservationBoardNotices` | 공지 |
| `reservationBoardConfig/share` | 링크 열쇠 |
| `reservationBoardConfig/naverWatch` | 취소 감시가 마지막으로 본 날짜별 합계와 확인 시각 |
| `reservationBoardNaverSeen/{네이버 예약번호}` | 네이버 예약의 마지막 상태와 취소를 처음 본 시각 |

- 같은 예약을 두 직원이 고치면 `revision` 으로 나중 저장을 막는다(409).
- 새 등록은 화면이 만든 요청 UUID 를 문서 이름으로 써서, 응답이 늦어 다시 눌러도 두 번 생기지 않는다.
- 삭제는 `deleted: true` 로 숨기기만 한다. 링크를 가진 누구나 지울 수 있어서 되살릴 길을 남긴다.
- 낮/밤은 시간이 16시(`LUNCH_UNTIL`) 전이면 낮. 직원이 직접 고를 수도 있다.
- 인원을 모르면 비워 둔다(`null`). 합계에는 0으로 더하고 「인원 미정 N팀」으로 따로 알린다. `NaN` 을 만들지 않는다.

## 네이버 예약

오너비스타 연결은 **기존 그대로** 쓴다(`attendanceBookings.js` 의 `createBookingReader`, 같은 연결키
`OWNERVISTA_BOOKINGS_TOKEN`, 같은 경로). 오너비스타 쪽은 고치지 않았다.

- 날짜별 목록: `/api/integrations/attendance/reservations?date=` (날짜마다 1분 기억)
- 달력 합계: `/api/integrations/attendance/calendar?month=` (2분 기억)
- 기존 연결은 손님 전화번호를 주지 않는다. 예약장에는 직원이 적은 예약의 번호만 보인다.

한 번에 읽는 범위는 최대 7일(일주일 보기)이다. 네이버 조회가 실패해도 직원이 적은 예약은 보이고, 「네이버 예약을
불러오지 못했습니다」로 따로 알린다. 0건으로 보이게 하지 않는다.

### 취소 경고 (`watchNaverCancellations`)

기존 연결은 「언제 취소됐는지」를 주지 않는다. 그래서 10분마다 도는 스케줄 함수가 직접 확인한다.

1. 오늘부터 45일치 달력 합계(확정 건수·취소·노쇼·인원)를 읽어 지난번과 다른 날짜만 그날 목록을 다시 읽는다.
2. 달력 합계는 확정 대기(신청)를 세지 않으므로, 한 시간 넘게 안 본 날짜를 차례마다 6개씩 더 읽는다(45일 한 바퀴 약 80분).
3. 예약마다 지난번 상태를 `reservationBoardNaverSeen/{예약번호}` 에 두고, 신청·확정·이용완료 → 취소를 처음 본 시각을
   `cancelledAt` 에 적는다. 처음 보는 예약은 적기만 한다(이미 취소였던 예약은 경고하지 않는다). 직접 등록(오너비스타)
   예약의 취소, 변경 취소도 경고하지 않는다. 다시 살아난 예약은 `cancelledAt` 을 지운다.
4. 예약장은 `cancelledAt` 이 한국시간 오늘인 예약만 경고한다. 그래서 경고는 **취소된 그날에만** 뜬다.

감시가 30분 넘게 멈추면 예약장 아래에 「네이버 취소 확인이 늦어지고 있습니다」가 뜬다. 처음 배포한 뒤 첫 몇 차례는
지금 상태를 적기만 하므로, 그 전에 이미 취소된 예약은 경고하지 않는다.

「오늘 그만 보기」는 `localStorage` 의 `rb-cancel-muted` 에 오늘 날짜와 본 예약번호를 둔다. 그 휴대폰에서 그날만
숨기고, 새로 취소된 예약은 다시 띄운다.

## 구글 시트 가져오기

관리자가 시트 주소를 넣으면 서버가 `gviz/tq?tqx=out:json` 으로 읽는다. CSV 와 달리 날짜가 연도까지 온다.
첫 줄 칸 이름(`SHEET_COLUMNS`)으로 열을 찾고, 줄마다 시트·날짜·시간·이름·연락처로 만든 문서 이름을 써서
여러 번 가져와도 새 줄만 들어온다. 가져온 뒤 고친 예약은 덮어쓰지 않는다.

gviz 는 숫자 칸의 글자 값(예: 인원 `15+@`)을 버린다. 그런 줄은 인원이 비어서 들어오고 미리보기에 경고가 뜬다.

## 배포

1. Deploy Functions → `functions:reservationBoardApi` 와 `functions:watchNaverCancellations` (둘 다 처음 생긴다).
2. 프론트는 머지하면 GitHub Pages 로 나간다.
3. 매장 관리 → 돌담명가 예약 → **공유 링크 만들기** → **링크 복사** → 직원 단톡방.
4. 같은 칸의 **구글 시트에서 지금까지의 예약 가져오기** 로 시트 예약을 옮긴다.

## 로컬 미리보기

```
cd functions
firebase emulators:exec --only firestore --project demo-gjsuragan-board-preview "node scripts/preview-reservations.js"
```

에뮬레이터와 가상 네이버 예약만 쓴다. 출력된 `http://127.0.0.1:8766/reservations.html#token=…` 을 연다.
