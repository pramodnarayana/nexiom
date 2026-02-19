#!/bin/bash
set -e
# Ensure child processes are killed when this script exits
cleanup() {
    echo "Cleaning up test environment..."
    if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; fi
    if [ -n "$WEB_PID" ]; then kill "$WEB_PID" 2>/dev/null; wait "$WEB_PID" 2>/dev/null; fi
}
trap cleanup EXIT INT TERM
# Kill any existing processes on ports 3002 and 5174 to ensure clean start
lsof -ti:3002 | xargs kill -15 2>/dev/null || true
lsof -ti:5174 | xargs kill -15 2>/dev/null || true
sleep 1

# Start API in background
# Force Mailpit config and Test Port
echo "Starting API on port 3002..."
PORT=3002 \
SMTP_HOST=localhost \
SMTP_PORT=1025 \
SMTP_SECURE=false \
MAIL_MOCK=false \
TEST_SEND_ON_SIGNUP=true \
BETTER_AUTH_URL=http://localhost:3002/api/auth \
FRONTEND_URL=http://localhost:5174 \
ALLOWED_ORIGINS=http://localhost:5174 \
pnpm --filter api start:dev > apps/web/e2e/api.log 2>&1 &
API_PID=$!

# Wait for API to be ready
echo "Waiting for API to start..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:3002/api > /dev/null 2>&1; then
        echo "API is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: API failed to start within 30s"
        cat apps/web/e2e/api.log
        exit 1
    fi
    sleep 1
done

# Start Web in background
echo "Starting Web on port 5174..."
PORT=5174 \
VITE_API_URL=http://localhost:3002/api \
VITE_AUTH_GOOGLE_ENABLED=true \
pnpm --filter web dev --port 5174 > apps/web/e2e/web.log 2>&1 &
WEB_PID=$!

# Wait for Web to be ready
echo "Waiting for Web to start..."
for i in $(seq 1 20); do
    if curl -sf http://localhost:5174 > /dev/null 2>&1; then
        echo "Web is ready."
        break
    fi
    if [ "$i" -eq 20 ]; then
        echo "ERROR: Web failed to start within 20s"
        cat apps/web/e2e/web.log
        exit 1
    fi
    sleep 1
done

echo "Test Environment Started."
echo "API PID: $API_PID"
echo "Web PID: $WEB_PID"

# Wait for both processes
wait $API_PID $WEB_PID
