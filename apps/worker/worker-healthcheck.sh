#!/bin/sh
# Lightweight healthcheck for the Nexiom worker container.
# Verifies the Node process started by CMD is still running.
# Used by the Dockerfile HEALTHCHECK instruction.
pgrep -f "apps/worker/dist/main.js" > /dev/null 2>&1
