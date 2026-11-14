#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PYTHON="${PYTHON:-$HOME/Documents/AIYE-runtime/backend-venv/bin/python}"
if lsof -nP -iTCP:18000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 18000 is occupied; refusing to run tests against an existing server." >&2
    exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/aiye-parity.XXXXXX")"
mkdir -p "$WORK/backend"
rsync -a --exclude static --exclude '*.db*' --exclude .venv --exclude __pycache__ \
    "$ROOT/backend/" "$WORK/backend/"
PYTHONDONTWRITEBYTECODE=1 LULU_ENV=development LULU_REDIS_URL="" \
    LULU_ENABLE_DEBUG_PHONE_CODES=true LULU_SECRET_KEY=isolated-parity-test-key \
    LULU_DB_PATH="$WORK/backend/aiye.db" \
    LULU_DATABASE_URL="sqlite:///$WORK/backend/aiye.db" \
    "$PYTHON" -m uvicorn main:app --app-dir "$WORK/backend" \
    --host 127.0.0.1 --port 18000 > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT
SOURCE="$ROOT/ios_aiye/aiye/aiye/aiye"
swiftc -parse-as-library \
    "$SOURCE/Core/Network/APIClient.swift" \
    "$SOURCE/Core/Network/APIError.swift" \
    "$SOURCE/Core/Auth/TokenStore.swift" \
    "$SOURCE/Core/Storage/ContactGroupData.swift" \
    "$SOURCE/Core/Support/AppMediaURL.swift" \
    "$SOURCE/Domain/DTO/"*.swift \
    "$ROOT/ios_aiye/tests/APIParityTests.swift" \
    -o "$WORK/api-parity-tests"
if ! curl --noproxy '*' --fail --silent http://127.0.0.1:18000/healthz >/dev/null; then
    cat "$WORK/server.log"
    exit 1
fi
"$WORK/api-parity-tests"
echo "Isolated test data and server log: $WORK"
