#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CREATE="$REPO/packages/create-sprintster/dist/index.js"
S8R="$REPO/packages/cli/dist/index.js"
PORT=3981
WORK="$(mktemp -d)"
DPID=""

cleanup() {
  [ -n "$DPID" ] && kill "$DPID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "E2E FAIL: $1"
  [ -f "$WORK/app/daemon.log" ] && cat "$WORK/app/daemon.log"
  exit 1
}

cd "$WORK"
node "$CREATE" app --backend sqlite >/dev/null
sed -i "s/\"port\": 3939/\"port\": $PORT/" app/sprintster.config.json
cd app

node "$S8R" daemon > daemon.log 2>&1 &
DPID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.25
done

curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || fail "health did not come up"
curl -sf "http://127.0.0.1:$PORT/config" | grep -q '"name":"user"' || fail "/config missing user object"
curl -sf -X POST "http://127.0.0.1:$PORT/users" -H 'content-type: application/json' \
  -d '{"id":"11111111-1111-4111-8111-111111111111","name":"Ada","email":"ada@example.com","role":"admin"}' >/dev/null \
  || fail "could not create a user"
curl -sf "http://127.0.0.1:$PORT/users" | grep -q '"name":"Ada"' || fail "created user not returned"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/users" \
  -H 'content-type: application/json' -d '{"id":"22222222-2222-4222-8222-222222222222","name":""}')
[ "$code" = "400" ] || fail "expected 400 for empty name, got $code"

curl -sf "http://127.0.0.1:$PORT/" | grep -q 'id="root"' || fail "web GUI not served at /"

echo "E2E OK: scaffold -> s8r daemon -> user CRUD + validation + web GUI served (sqlite)"
