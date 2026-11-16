#!/usr/bin/env bash
#
# Start the local submarine simulator:
# - Static HTTP server for the browser simulator
# - Optional HeadTTS/Kokoro neural crew voice service (only with --with-voice)
#
# Usage:
#   bash start-local.sh
#   SIM_PORT=8090 bash start-local.sh
#   bash start-local.sh --with-voice
#   bash start-local.sh --no-open
#
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SIM_PORT="${SIM_PORT:-8080}"
TTS_URL="http://127.0.0.1:8882"
SIM_URL="http://127.0.0.1:${SIM_PORT}"
NO_OPEN=0
WITH_VOICE=0
for arg in "$@"; do
  case "$arg" in
    --no-open) NO_OPEN=1 ;;
    --with-voice) WITH_VOICE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

TTS_PID=""
WEB_PID=""
TTS_OWNED=0
LOG_DIR="${HOME}/.submarine-simulator/logs"
mkdir -p "$LOG_DIR"
TTS_LOG="${LOG_DIR}/kokoro-tts.log"
WEB_LOG="${LOG_DIR}/simulator-http.log"

log() {
  printf '[SUBMARINE] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ "$TTS_OWNED" -eq 1 && -n "$TTS_PID" ]]; then
    # start.mjs supervises the actual HeadTTS Node server as its child.
    pkill -TERM -P "$TTS_PID" 2>/dev/null || true
    kill "$TTS_PID" 2>/dev/null || true
    wait "$TTS_PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    log "Stopped after an error. Logs: ${LOG_DIR}"
  else
    log "Local simulator services stopped."
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v python3 >/dev/null 2>&1 || fail "Python 3 is required to serve the simulator."
command -v curl >/dev/null 2>&1 || fail "curl is required for local service health checks."

if [[ "$WITH_VOICE" -eq 1 ]]; then
  command -v node >/dev/null 2>&1 || fail "Node.js is required for crew voice. Install Node.js 20 or newer."
  command -v npm >/dev/null 2>&1 || fail "npm is missing. Install the current Node.js LTS distribution."
  command -v git >/dev/null 2>&1 || fail "Git is required for the first-time HeadTTS installation."
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
  [[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js 20 or newer is required (found $(node -v))."
fi

if [[ ! "$SIM_PORT" =~ ^[0-9]+$ ]] || [[ "$SIM_PORT" -lt 1024 ]] || [[ "$SIM_PORT" -gt 65535 ]]; then
  fail "SIM_PORT must be a TCP port between 1024 and 65535."
fi

tts_ready() {
  local response
  response="$(curl -sS --max-time 2 -X POST \
    -H 'Content-Type: application/json' \
    -d '{}' "${TTS_URL}/v1/hello" 2>/dev/null || true)"
  [[ "$response" == HeadTTS* ]]
}

if [[ "$WITH_VOICE" -eq 1 ]]; then
  log "Checking local neural voice engine..."
  if tts_ready; then
    log "HeadTTS is already running at ${TTS_URL}; reusing it."
  else
    log "Starting HeadTTS + Kokoro. First run downloads the model and may take several minutes."
    node "$ROOT_DIR/tts-server/start.mjs" >>"$TTS_LOG" 2>&1 &
    TTS_PID=$!
    TTS_OWNED=1
  fi
fi

if curl -fsS --max-time 2 "$SIM_URL" -o /dev/null 2>/dev/null; then
  fail "Port ${SIM_PORT} is already serving HTTP. Stop the other server or choose another port with SIM_PORT=8090."
fi

log "Starting simulator web server on ${SIM_URL}..."
python3 -m http.server "$SIM_PORT" --bind 127.0.0.1 >>"$WEB_LOG" 2>&1 &
WEB_PID=$!

web_attempt=0
until curl -fsS --max-time 2 "$SIM_URL" -o /dev/null 2>/dev/null; do
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    tail -n 40 "$WEB_LOG" >&2 || true
    fail "The simulator HTTP server exited unexpectedly."
  fi
  web_attempt=$((web_attempt + 1))
  if [[ "$web_attempt" -ge 30 ]]; then
    fail "The simulator HTTP server did not become ready on port ${SIM_PORT}."
  fi
  sleep 1
done

if [[ "$WITH_VOICE" -eq 1 ]]; then
  log "Waiting for Kokoro to finish loading..."
  dots=0
  until tts_ready; do
    if [[ "$TTS_OWNED" -eq 1 ]] && ! kill -0 "$TTS_PID" 2>/dev/null; then
      tail -n 80 "$TTS_LOG" >&2 || true
      fail "The local TTS server exited. Review ${TTS_LOG}."
    fi
    dots=$((dots + 1))
    if (( dots % 10 == 0 )); then
      log "Still loading the local model; details are in ${TTS_LOG}."
    fi
    sleep 2
  done
  log "Kokoro is ready."
else
  log "Crew voice is disabled. Use --with-voice to start the optional Kokoro engine."
fi
log "Simulator: ${SIM_URL}"
if [[ "$WITH_VOICE" -eq 1 ]]; then log "Voice API: ${TTS_URL}"; fi
log "Logs: ${LOG_DIR}"
log "Keep this terminal open. Press Ctrl+C to stop the services started by this script."

if [[ "$NO_OPEN" -eq 0 ]]; then
  case "$(uname -s)" in
    Darwin) open "$SIM_URL" >/dev/null 2>&1 || log "Open ${SIM_URL} in your browser." ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$SIM_URL" >/dev/null 2>&1 || log "Open ${SIM_URL} in your browser."
      else
        log "Open ${SIM_URL} in your browser."
      fi
      ;;
    *)
      log "Open ${SIM_URL} in your browser."
      ;;
  esac
fi

# Keep the launcher alive so Ctrl+C also stops the background services.
while true; do
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    fail "The simulator HTTP server stopped unexpectedly. Review ${WEB_LOG}."
  fi
  if [[ "$TTS_OWNED" -eq 1 ]] && ! kill -0 "$TTS_PID" 2>/dev/null; then
    tail -n 80 "$TTS_LOG" >&2 || true
    fail "The local TTS server stopped unexpectedly. Review ${TTS_LOG}."
  fi
  sleep 2
done
