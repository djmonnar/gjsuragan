# 궁중수라간 내부 관리자용 카카오 챗봇 세팅 가이드

이 챗봇은 일반 고객용이 아니라 내부 관리자용입니다. 카카오톡 말풍선에 고객명, 전화번호, 주소, 요청사항이 출력되므로 인증 없는 조회를 허용하면 안 됩니다.

## 1. Apps Script에 KakaoWebhook.gs 붙여넣기

1. 기존 아임웹 → Firebase 연동에 쓰는 Google Apps Script 프로젝트를 엽니다.
2. 왼쪽 파일 목록에서 새 스크립트 파일을 만들고 이름을 `KakaoWebhook.gs`로 지정합니다.
3. 이 저장소의 `appscript/KakaoWebhook.gs` 전체 내용을 복사해 붙여넣습니다.
4. 기존 `appscript/Code.gs`도 같은 Apps Script 프로젝트에 있어야 합니다.
5. 저장 후 `배포 > 새 배포 > 웹 앱`을 선택합니다.
6. 실행 사용자: `나`
7. 액세스 권한: 카카오 i 오픈빌더 스킬 서버가 호출할 수 있는 권한
8. 배포 후 웹 앱 URL을 복사합니다.
9. 웹 앱 URL을 브라우저에서 GET 접속했을 때 아래 문구가 나오면 기본 연결은 정상입니다.

```text
GJSURAGAN Kakao webhook OK
```

## 2. Script Properties 등록값

Apps Script의 `프로젝트 설정 > 스크립트 속성`에 아래 값을 등록합니다. 값은 코드나 GitHub 문서에 직접 적지 말고 Apps Script 속성에만 저장하세요.

| 속성명 | 용도 | 필수 |
|---|---|---|
| `IMWEB_API_KEY` | 아임웹 API key | 예 |
| `IMWEB_SECRET_KEY` | 아임웹 secret key | 예 |
| `FIREBASE_PROJECT_ID` | Firebase project id | 예 |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account client email | 예 |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | 예 |
| `KAKAO_ADMIN_PIN` | 카카오 챗봇 관리자 인증 PIN | 예 |
| `KAKAO_ALLOWED_USERS` | 허용할 카카오 user id 목록. 콤마로 구분 | 선택 |

`KAKAO_ALLOWED_USERS`가 비어 있으면 PIN 인증만 사용합니다. 값이 있으면 해당 user id에 포함된 사용자만 PIN 인증을 시도할 수 있습니다.

예시 형식:

```text
KAKAO_ALLOWED_USERS = 123456789,987654321
```

중요: 공개 저장소에 한 번이라도 Firebase private key, 아임웹 secret key, API key가 올라갔다면 운영 전 반드시 해당 키를 재발급하세요. 코드에서 제거해도 Git 기록이나 외부 캐시에 남아 있을 수 있습니다.

## 3. 카카오 챗봇 관리자센터 스킬 URL 연결

1. 카카오 i 오픈빌더 관리자센터에서 챗봇을 엽니다.
2. `스킬` 메뉴에서 새 스킬을 만듭니다.
3. 스킬명 예시: `궁중수라간 배송조회`
4. URL에 Apps Script 웹 앱 URL을 입력합니다.
5. Method는 `POST`로 설정합니다.
6. 응답은 카카오 스킬 응답 JSON을 사용합니다.
7. 스킬 테스트에서 `오늘배송`을 넣었을 때 `version: "2.0"` 형태의 응답이 오면 정상입니다.

## 4. 블록 예시

처음에는 모든 블록을 같은 스킬 URL에 연결해도 됩니다. 웹훅이 발화 텍스트와 파라미터를 함께 해석합니다.

| 블록명 | 발화 예시 | 권장 파라미터 |
|---|---|---|
| 관리자 인증 | `인증 8274`, `핀 8274` | `pin` |
| 오늘배송 | `오늘배송`, `오늘 배송`, `금일 배송` | 없음 |
| 내일배송 | `내일배송`, `내일 배송` | 없음 |
| 모레배송 | `모레배송`, `모레 배송` | 없음 |
| 배송요약 | `요약`, `현황`, `배송요약` | `mode=summary` |
| 고객검색 | `고객검색 홍길동`, `고객검색 0101234` | `keyword` |
| 날짜배송 | `2026-06-12 배송`, `6월 12일 배송` | `date` |

## 5. 발화 예시

```text
인증 8274
오늘배송
내일배송
모레배송
요약
고객검색 홍길동
고객검색 0101234
2026-06-12 배송
6월 12일 배송
```

## 6. 내부 관리자용 보안 주의사항

- 인증 전에는 고객정보가 절대 출력되지 않아야 합니다.
- `KAKAO_ADMIN_PIN`은 외부에 공유하지 말고 주기적으로 바꾸는 것을 권장합니다.
- 운영에서는 가능하면 `KAKAO_ALLOWED_USERS`를 등록해 허용된 카카오 user id만 조회하게 하세요.
- Apps Script 웹 앱 URL이 유출되면 PIN 인증 시도는 가능하므로 URL도 내부용으로 관리하세요.
- 카카오톡 대화방에 개인정보가 남습니다. 내부 관리자 단말에서만 사용하세요.
- Firebase service account는 Firestore 조회/필요 작업 범위로만 권한을 제한하는 것이 좋습니다.

## 7. 테스트 방법

1. Apps Script 웹 앱 URL을 브라우저에서 엽니다.
   - 기대 결과: `GJSURAGAN Kakao webhook OK`
2. 카카오 스킬 테스트에서 인증 전 `오늘배송`을 호출합니다.
   - 기대 결과: 인증 안내만 표시되고 고객명, 전화번호, 주소는 나오지 않음
3. 카카오 스킬 테스트에서 `인증 PIN`을 호출합니다.
   - 기대 결과: 관리자 인증 완료 메시지
4. 인증 후 아래 명령을 각각 테스트합니다.
   - `오늘배송`
   - `내일배송`
   - `모레배송`
   - `요약`
   - `고객검색 홍길동`
   - `고객검색 0101234`
   - `2026-06-12 배송`
   - `6월 12일 배송`
5. 응답 JSON에 항상 아래 형태가 포함되는지 확인합니다.

```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      {
        "simpleText": {
          "text": "..."
        }
      }
    ]
  }
}
```

## 8. 장애 발생 시 확인할 것

- Apps Script 웹 앱 URL을 GET 접속했을 때 `GJSURAGAN Kakao webhook OK`가 나오는지 확인
- 카카오 스킬 테스트에서 HTTP 오류가 나는지 확인
- Apps Script `실행` 또는 `실행 로그`에서 오류 메시지 확인
- Firestore REST API 접근 권한과 Firebase service account 권한 확인
- Script Properties 누락 여부 확인
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
  - `KAKAO_ADMIN_PIN`
- `KAKAO_ALLOWED_USERS`를 등록했다면 카카오 payload의 user id가 목록에 포함되어 있는지 확인
- 새 배포를 만들었는지, 이전 웹 앱 URL을 카카오 스킬에 연결해둔 것은 아닌지 확인

## 응답 제한

기본 응답은 안정성을 위해 `simpleText`를 사용합니다. 말풍선이 너무 길어지지 않도록 표시 글자 수와 목록 건수를 제한합니다. 전체 목록은 관리자 페이지에서 확인하세요.

`KakaoWebhook.gs`에는 향후 전환을 위한 `kakaoListCardResponse_()` 함수도 포함되어 있지만, 기본 응답은 `simpleText`입니다.
