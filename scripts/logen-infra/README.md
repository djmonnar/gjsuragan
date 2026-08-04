# 로젠 연동 인프라 켜기/끄기 (비용 절약 스위치)

로젠택배 API는 고정 IP(`34.50.34.252`) 화이트리스트를 요구한다. 이 고정 IP로
나가는 통로가 **Serverless VPC 커넥터**인데, 켜져 있는 동안 사용량과 무관하게
서버 2대가 상시 가동되어 **월 약 2.5만원**이 나간다. 택배를 장기간 쓰지 않을
때는 커넥터만 끄면 이 비용이 절약된다.

## 상태별 비용 (대략)

| 상태 | 유지 항목 | 월 비용 |
|---|---|---|
| ON (평소) | 커넥터 + NAT + 고정 IP | 약 3만원 |
| OFF (휴면) | NAT + 고정 IP만 유지 | 약 5천~1만원 |

고정 IP와 NAT·라우터는 OFF 상태에서도 남겨둔다. **IP를 반납하면 로젠
화이트리스트 등록이 무효가 되어 재등록 절차(로젠 담당자 처리)를 다시 밟아야
하기 때문**이다.

## OFF 상태에서 무엇이 되고 안 되나

- ❌ 로젠 택배 접수·송장 조회 (401 오류) — 유일하게 막히는 기능
- ✅ 카카오 챗봇, 배송경로 최적화(네이버), 식단 OCR — 기본 회선으로 정상 동작
- ✅ 반찬·월식 시스템 전체 — 영향 없음

## 사용법

1. Google Cloud 소유 계정으로 OAuth 인증 후 액세스 토큰 발급
   (Claude 세션에서 진행하면 인증 링크를 안내해준다)
2. 토큰을 환경변수로 넣고 스크립트 실행:

```bash
export GJS_ACCESS_TOKEN="ya29...."
bash scripts/logen-infra/status.sh   # 현재 상태 확인
bash scripts/logen-infra/off.sh      # 끄기 (약 5분)
bash scripts/logen-infra/on.sh       # 켜기 (약 5~8분)
```

## 현재 인프라 사양 (2026-07-28 백업 — on.sh가 이 값으로 복원)

- VPC 커넥터: `gjsuragan-seoul-connector` / network `default` /
  CIDR `10.8.0.0/28` / e2-micro / min 2, max 3
- Cloud Router: `gjsuragan-seoul-router` (network `default`)
- Cloud NAT: `gjsuragan-seoul-nat` / MANUAL_ONLY / 전체 서브넷 /
  natIps: `gjs-logen-nat-ip`
- 고정 IP: `gjs-logen-nat-ip` = `34.50.34.252`
- 함수: `api` (asia-northeast3) — ON일 때 vpcConnector 연결 + ALL_TRAFFIC

## 주의사항

1. **OFF 상태에서 `firebase deploy --only functions`를 하면 안 된다.**
   `functions/index.js`의 `api` 함수 옵션에 커넥터가 하드코딩되어 있어,
   커넥터가 없는 상태에서 배포하면 실패하거나 설정이 꼬인다.
   배포가 필요하면 먼저 `on.sh`로 켠 뒤 배포할 것.
2. on.sh 실행 후 로젠 연결 확인은 관리자 페이지 브라우저 콘솔에서
   `/api/logen/health` 호출로 검증한다 (`functions/LOGEN_SETUP.md` 참고,
   토큰은 함수 환경변수 `LOGEN_HEALTH_TOKEN`).
3. 커넥터 재생성 시 이름·CIDR이 같으므로 NAT 설정은 손댈 필요 없다.
