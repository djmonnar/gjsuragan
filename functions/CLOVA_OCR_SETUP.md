# CLOVA OCR 식단표 등록

궁중수라간 관리자 `식단관리` 탭에서 식단표 이미지를 업로드하고 `서버 클로바 OCR`을 누르면 Firebase Functions가 네이버 CLOVA OCR을 호출합니다.

## 필요한 환경변수

Functions 실행 환경에 아래 값을 등록하세요.

- `CLOVA_OCR_INVOKE_URL`: CLOVA OCR 도메인/Invoke URL
- `CLOVA_OCR_SECRET`: CLOVA OCR Secret Key

브라우저에는 Secret을 넣지 않습니다. 관리자 화면은 Firebase Auth ID Token만 Functions로 전송합니다.

## 동작 흐름

1. 관리자 화면에서 식단표 이미지 선택
2. `서버 클로바 OCR` 클릭
3. Functions `/api/meal-ocr/parse`가 이미지 Base64를 받아 CLOVA OCR 호출
4. OCR 원문과 파싱 결과를 `mealOcrJobs`에 기록
5. 관리자 화면에 날짜별 도시락/샐러드 미리보기 표시
6. 관리자가 수정 후 `전체 저장`을 눌러 `mealMenus/{date}`에 저장

## 주의사항

- 이미지 용량은 8MB 이하입니다.
- OCR 결과는 바로 저장되지 않습니다. 반드시 미리보기와 수정 단계를 거칩니다.
- 날짜/요일이 맞지 않거나 인식이 불안정하면 경고가 표시됩니다.
- CLOVA OCR 설정이 없으면 관리자 화면에 환경변수 누락 오류가 표시됩니다.
