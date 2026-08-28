# 아임웹 자동연동 — 앱스스크립트에서 Cloud Functions 로 옮기기

구글 앱스스크립트가 5분마다 돌리던 `syncImwebOrders` 를 우리 Cloud Functions 로 옮긴 것이다.
파싱 로직은 앱스스크립트와 동일하게 옮겼고, **한 주문에 상품 줄이 여러 개일 때 줄마다 따로
등록하도록 고친 것**만 다르다.

## 지금 상태

함수는 배포해도 **아무 일도 하지 않는다.** `config/imwebSync` 문서의 `enabled` 가 `true` 가
되어야 실제로 동작한다. 그래서 앱스스크립트를 끄기 전에 안전하게 미리 배포해둘 수 있다.

## 구성 요소

| 파일 | 역할 |
| --- | --- |
| `functions/imwebParser.js` | 주문 → 고객 문서 변환. 순수 함수만 있어서 테스트가 붙는다 |
| `functions/imwebClient.js` | 아임웹 v2 API 호출 |
| `functions/imwebSync.js` | 동기화 본체. 등록·취소삭제·중복건너뛰기 |
| `functions/index.js` 의 `syncImwebOrders` | 5분마다 실행되는 스케줄 함수 |
| `functions/test/unit/imweb-parser.test.js` | 파싱 테스트 |
| `functions/test/unit/imweb-sync.test.js` | 동기화 흐름 테스트 (가짜 Firestore) |

## 앱스스크립트와 달라지는 것

- `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID` **세 개가 필요 없어진다.**
  Cloud Functions 는 자체 서비스 계정으로 Firestore 에 붙는다. 서비스 계정 비공개 키를
  스크립트 속성에 넣어둘 필요가 없어진다.
- 필요한 값은 `IMWEB_API_KEY` / `IMWEB_SECRET_KEY` 두 개뿐이고, Secret Manager 에 들어간다.
- 로그가 Cloud Logging 으로 간다. 로젠 로그와 같은 곳이다.
- 6분 실행 제한이 없어진다 (타임아웃 9분으로 잡아둠).

## 전환 절차

### 1단계 — 시크릿 만들기 (한 번만)

Google Cloud Console → Secret Manager → **보안 비밀 만들기** 를 두 번 한다.

| 이름 | 값 |
| --- | --- |
| `IMWEB_API_KEY` | 앱스스크립트 스크립트 속성의 같은 이름 값 |
| `IMWEB_SECRET_KEY` | 앱스스크립트 스크립트 속성의 같은 이름 값 |

이름이 정확히 같아야 한다. **이 단계를 건너뛰면 3단계 배포가 실패한다.**

### 2단계 — 시크릿에 읽기 권한 주기 (한 번만)

함수가 시크릿을 읽으려면 **런타임 서비스 계정**에 접근 권한이 있어야 한다.
배포할 때 firebase 가 자동으로 붙여주려 하지만, 배포용 서비스 계정에
`secretmanager.secrets.setIamPolicy` 권한이 없으면 아래처럼 막힌다.

```
Error: .../secrets/IMWEB_API_KEY:setIamPolicy had HTTP Error: 403,
Permission 'secretmanager.secrets.setIamPolicy' denied
```

그래서 권한을 먼저 손으로 준다. 두 시크릿 각각에 대해:

Secret Manager → 시크릿 클릭 → **권한** 탭 → **액세스 권한 부여**

| 항목 | 값 |
| --- | --- |
| 새 주 구성원 | `1009198450175-compute@developer.gserviceaccount.com` |
| 역할 | Secret Manager 보안 비밀 접근자 (`roles/secretmanager.secretAccessor`) |

이미 권한이 있으면 firebase 가 `setIamPolicy` 를 건너뛰므로 배포가 통과한다.
계정 주소가 헷갈리면 `LOGEN_SECRET_KEY` 의 권한 탭에 붙어 있는 것과 같은 값을 쓰면 된다.

### 3단계 — 함수 배포

GitHub → Actions → **Deploy Functions** → Run workflow

- `배포 대상` 을 `functions:syncImwebOrders` 로 바꾼다
- 나머지는 기본값 그대로

배포돼도 스위치가 꺼져 있어서 아직 아무 일도 일어나지 않는다.
Cloud Scheduler 작업이 하나 생기고 5분마다 함수를 깨우지만, 함수는 설정만 확인하고 바로 끝난다.

### 4단계 — 앱스스크립트 먼저 끄기

앱스스크립트 편집기에서 **`pauseImwebSyncTrigger`** 를 실행한다.
실행 기록에 `자동 동기화 트리거 중지 완료` 가 뜨면 꺼진 것이다.

> 순서가 중요하다. 둘 다 켜져 있으면 같은 주문을 두 번 등록할 수 있다.
> `syncKey` 중복 방지가 있지만 동시에 도는 찰나에는 뚫릴 수 있다.

### 5단계 — 새 동기화 켜기

Firebase Console → Firestore → `config` 컬렉션 → `imwebSync` 문서를 만들고 필드 하나를 넣는다.

```
enabled (boolean) = true
```

다음 5분 안에 첫 실행이 돈다.

### 6단계 — 확인

Google Cloud Console → 로그 탐색기에서 아래를 찾는다.

```
jsonPayload.message="Imweb sync finished"
```

`saved` / `deleted` / `skipped` / `scanned` 숫자가 찍힌다.
처음 몇 번은 `saved: 0` 이 정상이다 (이미 다 등록돼 있으니까).

## 되돌리기

문제가 생기면 재배포 없이 즉시 되돌릴 수 있다.

1. `config/imwebSync` 의 `enabled` 를 `false` 로 바꾼다 → 새 동기화 정지
2. 앱스스크립트에서 `installFiveMinuteSyncTrigger` 실행 → 예전 동기화 복구

## 특정 주문만 다시 훑기

이미 등록된 주문은 API 호출을 아끼려고 통째로 건너뛴다. 예전에 일부 줄만 등록된 주문의
빠진 줄을 채우려면 `onlyOrderNos` 를 준다.

```js
await imwebSync.syncImwebOrders({ db, onlyOrderNos: ['202608240989736'] });
```

아직 버튼으로 부를 수 있는 통로는 없다. 필요해지면 관리자 인증이 걸린 엔드포인트를 하나 만든다.
그 전까지는 앱스스크립트의 `resyncImwebOrder('주문번호')` 를 쓰면 된다.

## 앱스스크립트 정리는 나중에

전환이 안정된 뒤에 앱스스크립트 프로젝트의 스크립트 속성에서 Firebase 서비스 계정 키
(`FIREBASE_PRIVATE_KEY` 등)를 지운다. 안 쓰는 비공개 키를 남겨둘 이유가 없다.
`appscript/Code.gs` 는 되돌릴 길을 남겨두기 위해 당분간 레포에 그대로 둔다.
