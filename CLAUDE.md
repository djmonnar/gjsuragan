# 작업 규칙

궁중수라간·돌담명가 운영 시스템. 실제 영업에 쓰는 코드다.

## 기능을 더하거나 바꾸면 매뉴얼도 같이 고친다

화면 안에 사용 안내가 들어 있다. **안내는 실제 동작을 적은 것이라, 코드와 어긋나면
안내가 아니라 오답이 된다.** 잘못된 안내는 없는 안내보다 나쁘다.

| 어디를 고쳤나 | 같이 고칠 매뉴얼 |
| --- | --- |
| `functions/attendance*.js`, `assets/js/attendance-*.js`, `assets/js/staff-*.js` | `assets/js/staff-manual.js` (매장 관리 → 사용 안내 탭) |
| 배송·주문·정산 (`admin.html`, `assets/js/`) | `manual.html` |
| 아임웹 연동 | `imwebmanual.html`, `functions/IMWEB_SYNC_SETUP.md` |

고칠 것: 바뀐 동작, 새로 생긴 버튼과 그 위치, 기본값, 계산식, 하면 안 되는 것.

매뉴얼에 숫자(기본값·계산 결과)를 적을 때는 **테스트가 실제 코드에서 그 값을 뽑아
문서와 대조하게** 한다. `functions/test/unit/staff-manual.test.js` 가 그 예다.
그래야 계산을 바꾸고 매뉴얼을 안 고쳤을 때 테스트가 깨진다.

## 검증

푸시 전에 `functions/` 에서:

```
npm run test:unit    # 유닛
npm run lint
npm run test:smoke   # 정적 페이지 구문 + index 구조
npm run test:emulator  # 규칙·서비스 (firebase-tools 필요)
```

에뮬레이터 테스트는 CI 에서 돈다. `firestore.rules` 나 `functions/attendance*.js`,
`functions/index.js` 를 고쳤으면 로컬에서도 돌려보는 편이 낫다. 실제로 유닛
테스트가 놓친 버그를 여기서 잡은 적이 있다.

## 캐시 번호

`assets/` 안의 파일을 고쳤으면 그 파일을 싣는 HTML 과 `sw.js` 의 `?v=` 를 올린다.
서비스워커가 precache 에 주소를 그대로 들고 있어서, 안 올리면 배포해도 옛 화면이
그대로 보인다. **바뀐 파일만** 올린다. 안 바뀐 것까지 올리면 멀쩡한 캐시를 버린다.

`sw.js` 의 `CACHE` 이름도 같이 올려 옛 precache 를 버리게 한다.

## 배포

머지하면 프론트는 GitHub Pages 로 자동 반영된다. 나머지는 Actions 에서 직접 누른다.

| 바뀐 것 | 눌러야 할 것 |
| --- | --- |
| `functions/index.js` 의 `api` 경로 | Deploy Functions → `functions:api` |
| `functions/attendance*.js` | Deploy Functions → `functions:attendanceApi` |
| `functions/imweb*.js` | Deploy Functions → `functions:syncImwebOrders` |
| `firestore.rules` | Deploy Firestore Rules (입력값 없음) |

전체 함수 배포(`functions`)는 `functions/.env` 가 러너에 없어서 운영 환경변수가
지워질 수 있다. 대상을 하나씩 지정한다.

## 돈이 걸린 화면

급여·정산 금액은 관리자가 복사해서 그대로 이체한다. 값이 빠진 행이 와도
`NaN` 이나 `undefined` 를 내보내지 않게 한다. 계산이 갈리는 자리는 테스트로 고정한다.
