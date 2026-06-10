# gjsuragan
궁중수라간 배송 시스템

## 관리자 모바일 푸시 알림

고객이 `customer.html`에서 주문 변경요청을 남기면 Firestore `changeRequests` 컬렉션에 새 문서가 생성됩니다. 관리자 화면 `admin.html`은 이 컬렉션을 실시간 구독해서 화면 알림, 소리, 진동, 배지를 즉시 표시합니다.

모바일 푸시는 Firebase Cloud Messaging 웹푸시와 Firebase Functions로 발송합니다. 관리자 화면이 꺼져 있어도 `adminPushTokens`에 저장된 관리자 기기 토큰으로 알림을 보냅니다.

### 알림 시간 제한

모바일 푸시 알림은 `Asia/Seoul` 기준 오후 6시부터 밤 10시까지만 울립니다.

- 18:00~22:00 사이 요청: 즉시 모바일 푸시 발송
- 그 외 시간 요청: `notificationStatus: "pending"`으로 저장
- 다음 18:00 이후: scheduled function이 pending 요청을 모아서 발송
- 관리자 페이지 안의 실시간 목록/배지/화면 알림은 시간 제한 없이 즉시 표시
- 향후 긴급 요청은 `urgent: true`로 시간 제한을 우회할 수 있게 구조만 열어둠

시간대를 바꾸려면 Functions 환경변수로 아래 값을 설정하거나 `functions/index.js` 기본값을 수정합니다.

```bash
NOTIFICATION_WINDOW_START_HOUR=18
NOTIFICATION_WINDOW_END_HOUR=22
```

### Firestore 컬렉션

`changeRequests`

```js
{
  customerId: string,
  customerName: string,
  phone: string,
  type: "schedule_change" | "address_change" | "pause" | "memo" | "etc",
  title: string,
  before: string,
  after: string,
  memo: string,
  status: "new" | "checking" | "approved" | "rejected" | "done",
  createdAt: serverTimestamp,
  readAt: null,
  handledAt: null,
  notificationStatus: "pending" | "sent" | "failed" | "skipped",
  notifyAfterAt: Timestamp,
  notifiedAt: null,
  notificationAttempts: number,
  notificationWindow: {
    timezone: "Asia/Seoul",
    startHour: 18,
    endHour: 22
  },
  urgent: false
}
```

`adminPushTokens`

```js
{
  token: string,
  userEmail: string,
  userAgent: string,
  platform: string,
  enabled: true,
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp
}
```

`invalidPushTokens`

FCM 발송 실패 토큰과 오류 코드를 기록합니다. 등록 토큰이 무효이면 `adminPushTokens/{tokenId}.enabled=false`로 바뀝니다.

### Firestore Rules

- 고객은 본인 로그인 상태에서 `changeRequests` 생성만 가능
- 고객은 본인 `changeRequests`만 읽기 가능
- `changeRequests.status`, `readAt`, `handledAt` 변경은 관리자만 가능
- `adminPushTokens` 생성/수정/삭제는 관리자만 가능
- `customers` 원본 데이터는 기존처럼 관리자만 읽고 쓸 수 있음

### FCM 설정

1. Firebase Console에서 프로젝트를 엽니다.
2. 프로젝트 설정 > Cloud Messaging > Web Push certificates에서 키 페어를 생성합니다.
3. 공개키를 `admin.html`의 `FCM_VAPID_PUBLIC_KEY` 값에 입력합니다.
4. 서버키, private key, 서비스 계정 키는 공개 레포에 커밋하지 않습니다.

### Firebase Functions 배포

```bash
cd functions
npm install
npm run lint
cd ..
firebase deploy --only firestore:rules
firebase deploy --only functions
```

Functions는 다음 두 가지를 배포합니다.

- `onChangeRequestCreated`: `changeRequests` 생성 시 즉시/대기 푸시 판단
- `flushPendingChangeRequestNotifications`: 15분마다 pending 요청을 확인해 허용 시간대에 묶음 발송

### Android 테스트

1. Android Chrome에서 `admin.html`을 엽니다.
2. 관리자 로그인 후 `변경요청` 탭을 엽니다.
3. `모바일 알림 허용` 버튼을 누릅니다.
4. 브라우저 알림 권한을 허용합니다.
5. Firestore `adminPushTokens`에 토큰 문서가 생겼는지 확인합니다.
6. 고객 계정으로 `customer.html`에서 변경요청을 등록합니다.
7. 관리자 페이지가 열려 있으면 화면 내 알림/소리/진동이 즉시 표시됩니다.
8. 18:00~22:00 사이에는 Android 모바일 푸시가 즉시 도착해야 합니다.

### iPhone 테스트

1. iPhone Safari에서 `admin.html`을 엽니다.
2. 공유 버튼 > 홈 화면에 추가로 관리자 PWA를 설치합니다.
3. 홈 화면의 `수라간관리자` 앱으로 접속합니다.
4. 관리자 로그인 후 `변경요청` 탭에서 `모바일 알림 허용`을 누릅니다.
5. 알림 권한을 허용합니다.
6. 18:00~22:00 사이 고객 변경요청을 등록해 푸시가 도착하는지 확인합니다.

iPhone 웹푸시는 홈 화면에 추가된 PWA에서 동작하는 것이 가장 안정적입니다.

### 알림이 안 올 때 확인할 것

- `admin.html`의 `FCM_VAPID_PUBLIC_KEY`가 실제 Web Push 공개키인지 확인
- 브라우저 알림 권한이 허용인지 확인
- `adminPushTokens` 문서가 생성되고 `enabled=true`인지 확인
- Functions가 배포되어 있고 실행 로그에 오류가 없는지 확인
- 요청 시간이 18:00~22:00 밖이면 `notificationStatus="pending"`인지 확인
- scheduled function이 18:00 이후 pending 요청을 처리하는지 확인
- iPhone은 홈 화면 앱에서 권한을 허용했는지 확인
- Android 절전 모드나 브라우저 알림 차단 여부 확인
