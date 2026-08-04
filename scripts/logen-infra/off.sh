#!/usr/bin/env bash
# 로젠 인프라 끄기: 함수에서 커넥터 분리 → VPC 커넥터 삭제
# 고정 IP·NAT·라우터는 유지 (로젠 화이트리스트 보존)
source "$(dirname "$0")/common.sh"

echo "1/2 함수에서 VPC 커넥터 분리 (재배포 수 분 소요)..."
OP=$(api PATCH "${FN_URL}?updateMask=serviceConfig.vpcConnector,serviceConfig.vpcConnectorEgressSettings" \
  '{"serviceConfig":{"vpcConnector":""}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])")
wait_op "https://cloudfunctions.googleapis.com/v2/${OP}" "함수 커넥터 분리"

echo "2/2 VPC 커넥터 삭제..."
OP=$(api DELETE "${VPC_URL}/${CONNECTOR}" | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])")
wait_op "https://vpcaccess.googleapis.com/v1/${OP}" "커넥터 삭제"

echo
echo "🔌 로젠 인프라 OFF 완료 — 월 약 2.5만원 절약 상태"
echo "   (고정 IP 34.50.34.252는 유지되어 로젠 화이트리스트는 유효)"
echo "   ⚠ OFF 동안 로젠 접수 불가, firebase deploy 금지 (README 참고)"
