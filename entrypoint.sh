#!/bin/sh
set -e

echo "[diabloweb] Starting up..."

# Ensure data dirs exist even if volume mount didn't create them.
# /data/tmp is used by nginx as client_body_temp_path (keeps 700MB MPQ
# uploads off tmpfs/RAM and on the real host volume instead).
mkdir -p /data/mpq /data/saves /data/tmp

# Patch index.html to include our overlay script (idempotent)
/inject.sh

# Start the Node API helper in the background
echo "[diabloweb] Starting helper API..."
node /app/api-server.js &
API_PID=$!

# Wait for the API to start accepting connections (up to 20 seconds).
# BusyBox sleep only supports integer seconds — use 'sleep 1', not 'sleep 0.5'.
echo "[diabloweb] Waiting for API to be ready..."
TRIES=0
until nc -z 127.0.0.1 3000 2>/dev/null; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 20 ]; then
    echo "[diabloweb] ERROR: API server did not start within 20 seconds."
    kill "$API_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
echo "[diabloweb] API ready."

# Start nginx in the background so we can capture its PID
echo "[diabloweb] Starting nginx on port 8080..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Set up clean shutdown BEFORE spawning any monitors, so a SIGTERM arriving
# at any point after this line is handled correctly.
shutdown() {
  echo "[diabloweb] Received shutdown signal. Stopping services..."
  kill "$NGINX_PID" 2>/dev/null || true
  kill "$API_PID"   2>/dev/null || true
  # Wait briefly for graceful exit, then the script ends and Docker is satisfied
  wait "$NGINX_PID" 2>/dev/null || true
  wait "$API_PID"   2>/dev/null || true
  echo "[diabloweb] Shutdown complete."
  exit 0
}
trap shutdown TERM INT

# Monitor the API process in the background.
# We use `kill -0 $pid` (signal 0 = "does this process exist?") in a polling
# loop rather than `wait $pid`, because busybox sh's `wait` for a PID that is
# not a direct child of the current subshell returns immediately with an error,
# which would cause monitor_api to kill nginx right away.
# kill -0 works for any PID the process has permission to signal.
monitor_api() {
  _api_pid="$1"
  _nginx_pid="$2"
  while kill -0 "$_api_pid" 2>/dev/null; do
    sleep 2
  done
  # Only report an unexpected exit if nginx is still running.
  # If nginx is already gone, we're in a clean shutdown path (the shutdown()
  # trap killed both processes) — printing an error here would be misleading.
  if kill -0 "$_nginx_pid" 2>/dev/null; then
    echo "[diabloweb] API server exited unexpectedly. Shutting down."
    kill "$_nginx_pid" 2>/dev/null || true
  fi
}
monitor_api "$API_PID" "$NGINX_PID" &

# Wait for nginx; capture its exit code so Docker restarts on crash.
# `wait` returns the exit code of the process it waited for.
# `|| true` was previously masking this — removed so a nginx crash
# (non-zero exit) propagates and Docker's restart policy fires.
NGINX_EXIT=0
wait "$NGINX_PID" || NGINX_EXIT=$?
echo "[diabloweb] nginx exited with code $NGINX_EXIT. Shutting down."
kill "$API_PID" 2>/dev/null || true
exit "$NGINX_EXIT"
