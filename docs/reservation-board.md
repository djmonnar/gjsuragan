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

- 같은 예약을 두 직원이 고치면 `revision` 으로 나중 저장을 막는다(409).
- 새 등록은 화면이 만든 요청 UUID 를 문서 이름으로 써서, 응답이 늦어 다시 눌러도 두 번 생기지 않는다.
- 삭제는 `deleted: true` 로 숨기기만 한다. 링크를 가진 누구나 지울 수 있어서 되살릴 길을 남긴다.
- 낮/밤은 시간이 16시(`LUNCH_UNTIL`) 전이면 낮. 직원이 직접 고를 수도 있다.
- 인원을 모르면 비워 둔다(`null`). 합계에는 0으로 더하고 「인원 미정 N팀」으로 따로 알린다. `NaN` 을 만들지 않는다.

## 네이버 예약

`attendanceBookings.js` 의 같은 오너비스타 연결키(`OWNERVISTA_BOOKINGS_TOKEN`)로 읽는다.

- 날짜별 목록: `/api/integrations/attendance/reservations?date=` (날짜마다 1분 기억). 손님 전화번호(`phone`)가
  여기에만 온다. 예약장 카드의 ☎ 로 바로 건다. 태블릿이 쓰는 `/today` 에는 번호가 없다.
- 달력 합계: `/api/integrations/attendance/calendar?month=` (2분 기억)
- 오늘 취소: `/api/integrations/attendance/cancellations` (1분 기억). 오너비스타가 상태 변화를 처음 본 시각이
  한국시간 오늘인, 신청·확정·이용완료 → 취소 예약만 준다. 그래서 경고 창은 **취소된 그날에만** 뜬다.
  오너비스타에 이 경로가 아직 없으면(404) 경고만 쉬고 나머지 화면은 그대로다.

한 번에 읽는 범위는 최대 7일(일주일 보기)이다. 네이버 조회가 실패해도 직원이 적은 예약은 보이고, 「네이버 예약을
불러오지 못했습니다」로 따로 알린다. 0건으로 보이게 하지 않는다.

「오늘 그만 보기」는 `localStorage` 의 `rb-cancel-muted` 에 오늘 날짜와 본 예약번호를 둔다. 그 휴대폰에서 그날만
숨기고, 새로 취소된 예약은 다시 띄운다.

## 구글 시트 가져오기

관리자가 시트 주소를 넣으면 서버가 `gviz/tq?tqx=out:json` 으로 읽는다. CSV 와 달리 날짜가 연도까지 온다.
첫 줄 칸 이름(`SHEET_COLUMNS`)으로 열을 찾고, 줄마다 시트·날짜·시간·이름·연락처로 만든 문서 이름을 써서
여러 번 가져와도 새 줄만 들어온다. 가져온 뒤 고친 예약은 덮어쓰지 않는다.

gviz 는 숫자 칸의 글자 값(예: 인원 `15+@`)을 버린다. 그런 줄은 인원이 비어서 들어오고 미리보기에 경고가 뜬다.

## 배포

1. 오너비스타(jit-pro)에 `cancellations` 경로를 배포한다. 없으면 취소 경고만 빠진다.
2. Deploy Functions → `functions:reservationBoardApi` (처음 한 번은 이 함수가 새로 생긴다).
3. 프론트는 머지하면 GitHub Pages 로 나간다.
4. 매장 관리 → 돌담명가 예약 → **공유 링크 만들기** → **링크 복사** → 직원 단톡방.
5. 같은 칸의 **구글 시트에서 지금까지의 예약 가져오기** 로 시트 예약을 옮긴다.

## 로컬 미리보기

```
cd functions
firebase emulators:exec --only firestore --project demo-gjsuragan-board-preview "node scripts/preview-reservations.js"
```

에뮬레이터와 가상 네이버 예약만 쓴다. 출력된 `http://127.0.0.1:8766/reservations.html#token=…` 을 연다.
