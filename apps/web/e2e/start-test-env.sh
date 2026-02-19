#!/bin/bash

# Kill any existing processes on ports 3002 and 5174 to ensure clean start
lsof -ti:3002 | xargs kill -9 2>/dev/null
lsof -ti:5174 | xargs kill -9 2>/dev/null

# Start API in background
# Force Mailpit config and Test Port
echo "Starting API on port 3002..."
PORT=3002 \
SMTP_HOST=localhost \
SMTP_PORT=1025 \
SMTP_SECURE=false \
MAIL_MOCK=false \
BETTER_AUTH_URL=http://localhost:3002/api/auth \
FRONTEND_URL=http://localhost:5174 \
ALLOWED_ORIGINS=http://localhost:5174 \
pnpm --filter api start:dev > apps/web/e2e/api.log 2>&1 &
API_PID=$!

# Wait for API to be ready (simple sleep or health check)
echo "Waiting for API to start..."
# In a real script, we'd loop curling /health
sleep 10

# Start Web in background
echo "Starting Web on port 5174..."
PORT=5174 \
VITE_API_URL=http://localhost:3002/api \
VITE_AUTH_GOOGLE_ENABLED=true \
pnpm --filter web dev --port 5174 > apps/web/e2e/web.log 2>&1 &
WEB_PID=$!

# Wait for Web to be ready
echo "Waiting for Web to start..."
sleep 5

echo "Test Environment Started."
echo "API PID: $API_PID"
echo "Web PID: $WEB_PID"

# Wait for both processes
wait $API_PID $WEB_PID
