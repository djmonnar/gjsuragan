#!/usr/bin/env bash
# 공용 설정 — off.sh / on.sh / status.sh에서 source로 불러 씀
set -euo pipefail

PROJECT="gjsuragan-60505"
REGION="asia-northeast3"
CONNECTOR="gjsuragan-seoul-connector"
CONNECTOR_CIDR="10.8.0.0/28"
CONNECTOR_NETWORK="default"
CONNECTOR_MACHINE="e2-micro"
CONNECTOR_MIN=2
CONNECTOR_MAX=3
FUNCTION="api"

TOKEN="${GJS_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "GJS_ACCESS_TOKEN 환경변수에 액세스 토큰을 넣고 실행하세요." >&2
  exit 1
fi

FN_URL="https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${FUNCTION}"
VPC_URL="https://vpcaccess.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/connectors"

api() { # method url [json-body]
  local method="$1" url="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$url" -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -sS -X "$method" "$url" -H "Authorization: Bearer $TOKEN"
  fi
}

wait_op() { # 오퍼레이션 URL을 done:true까지 폴링
  local op_url="$1" label="$2" i
  for i in $(seq 1 40); do
    sleep 15
    local res
    res=$(api GET "$op_url")
    if echo "$res" | grep -q '"done": *true'; then
      if echo "$res" | grep -q '"error"'; then
        echo "❌ ${label} 실패:" >&2
        echo "$res" | python3 -m json.tool >&2
        exit 1
      fi
      echo "✅ ${label} 완료"
      return 0
    fi
    echo "  ... ${label} 진행 중 (${i})"
  done
  echo "❌ ${label} 시간 초과 (10분)" >&2
  exit 1
}
