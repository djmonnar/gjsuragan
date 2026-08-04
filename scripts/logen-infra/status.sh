#!/usr/bin/env bash
# 로젠 인프라 현재 상태 확인
source "$(dirname "$0")/common.sh"

echo "── VPC 커넥터 ──"
api GET "${VPC_URL}/${CONNECTOR}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
if d.get('error') or not d:
    print('  없음 → 🔌 OFF 상태 (월 약 5천~1만원)')
else:
    print(f\"  상태: {d.get('state')} → 🔋 ON 상태 (월 약 3만원)\")
"

echo "── 함수 커넥터 연결 ──"
api GET "$FN_URL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
sc = d.get('serviceConfig', {})
print('  vpcConnector:', sc.get('vpcConnector') or '(분리됨)')
print('  egress:', sc.get('vpcConnectorEgressSettings') or '-')
print('  함수 상태:', d.get('state'))
"

echo "── 고정 IP ──"
api GET "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/addresses/gjs-logen-nat-ip" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  {d.get('address')} / {d.get('status')} (RESERVED=미사용 보유, IN_USE=NAT 연결)\")
"
