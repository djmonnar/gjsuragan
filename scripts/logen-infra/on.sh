#!/usr/bin/env bash
# 로젠 인프라 켜기: VPC 커넥터 재생성 → 함수에 다시 연결
source "$(dirname "$0")/common.sh"

echo "1/2 VPC 커넥터 생성 (수 분 소요)..."
BODY=$(cat <<JSON
{
  "network": "${CONNECTOR_NETWORK}",
  "ipCidrRange": "${CONNECTOR_CIDR}",
  "machineType": "${CONNECTOR_MACHINE}",
  "minInstances": ${CONNECTOR_MIN},
  "maxInstances": ${CONNECTOR_MAX}
}
JSON
)
OP=$(api POST "${VPC_URL}?connectorId=${CONNECTOR}" "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])")
wait_op "https://vpcaccess.googleapis.com/v1/${OP}" "커넥터 생성"

echo "2/2 함수에 커넥터 연결 (재배포 수 분 소요)..."
CONNECTOR_FULL="projects/${PROJECT}/locations/${REGION}/connectors/${CONNECTOR}"
OP=$(api PATCH "${FN_URL}?updateMask=serviceConfig.vpcConnector,serviceConfig.vpcConnectorEgressSettings" \
  "{\"serviceConfig\":{\"vpcConnector\":\"${CONNECTOR_FULL}\",\"vpcConnectorEgressSettings\":\"ALL_TRAFFIC\"}}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['name'])")
wait_op "https://cloudfunctions.googleapis.com/v2/${OP}" "함수 커넥터 연결"

echo
echo "🔋 로젠 인프라 ON 완료 — 로젠 접수 사용 가능"
echo "   확인: 관리자 페이지 콘솔에서 /api/logen/health 호출 (README 참고)"
