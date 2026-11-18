# SSN-774 Multiplayer — Architecture Decision & Operations Guide

## 1. Architectural Boundary (Strict Isolation)

This directory (`multiplayer/`) implements a **server-authoritative, client-server multiplayer foundation** in Rust alongside a completely independent browser client (`multiplayer/client/`).

### Protected Legacy Single-Player Game
The original single-player simulator at the repository root (`index.html`, `js/`, `css/`, `assets/`, `serve_https.py`, `tests/`) is **untouched and fully independent**:
- It has **zero dependency** on Rust, Cargo, WebSockets, or `multiplayer/`.
- Its simulation loop, Leaflet maps, WebGL periscope, WebAudio synthesizer, and `localStorage` save/load continue to operate identically.

### New Authoritative Client-Server System (`multiplayer/`)
- **`multiplayer/server/`** (Rust: Tokio + Axum + Serde + Tracing):
  - Owns the authoritative world state (`AuthoritativeWorld`), simulation clock, entities, and environment.
  - Executes a deterministic **30 Hz** (`33.33 ms`) fixed-step simulation loop using a monotonic clock, independent of client connections or render rates.
  - Validates all player commands (`SET_HEADING`, `SET_SPEED`, `SET_DEPTH`) server-side.
  - Filters authoritative entities into client-visible DTOs (`ClientWorldSnapshot`) so hidden entities and internal AI/subsystem variables are never leaked over the wire.
  - Publishes periodic snapshots at **10 Hz** (configurable) without queuing stale snapshots for slow clients.
- **`multiplayer/protocol/v1/`**:
  - Versioned JSON WebSocket contract (`v1`) decoupled from internal Rust structs.
- **`multiplayer/client/`**:
  - Standalone HTML5/Canvas/JS client with six stations: Tactical Plot, Sonar/TMA, Fire Control, Environment, Platform Status, and Periscope/ESM.
  - The F6 periscope view renders a procedural optical-style horizon from client-side presentation code and overlays only server-ranged surface-track cues. These cues are explicitly not represented as optical detections.
  - The ESM panel is a reserved interface only: protocol v1 does not yet publish emitter detections or bearing-of-arrival data, so the client deliberately generates no synthetic ESM contacts.
  - The client connects via WebSocket, renders authorized snapshots, measures RTT via `PING`/`PONG`, and submits validated orders.

---

## 2. Running the Server & Client

### Start the Authoritative Rust Server
```bash
cd multiplayer
cargo run --manifest-path server/Cargo.toml
```
By default the server binds to `127.0.0.1:9000` and serves:
- `GET /` — the independent multiplayer browser client (`multiplayer/client/`)
- `GET /healthz` — health check JSON
- `GET /status` — world tick, simulation time, and active session count
- `GET /ws` — WebSocket endpoint (`/ws`)

### Configuration (Environment Variables)
| Variable | Default | Description |
| :--- | :--- | :--- |
| `SSN_HOST` | `127.0.0.1` | Bind host address |
| `SSN_PORT` | `9000` | Bind TCP port |
| `SSN_SIM_HZ` | `30` | Authoritative simulation tick rate (Hz) |
| `SSN_SNAPSHOT_HZ` | `10` | Periodic snapshot broadcast rate (Hz) |
| `SSN_HEARTBEAT_TIMEOUT_SEC` | `15` | Disconnect/stale-session timeout (seconds) |
| `SSN_STATIC_DIR` | `client` (resolved relative to `multiplayer/`) | Directory served at `/` |

### Open the Client
Open `http://127.0.0.1:9000/` in any modern browser (or serve `multiplayer/client/` separately and point the client's server URL input to `ws://127.0.0.1:9000/ws`).

### Remote Access via HTTPS/WSS Reverse Proxy
For remote deployments, keep the Rust server bound to `127.0.0.1:9000` behind TLS termination (e.g., Nginx or Caddy):
```nginx
server {
    listen 443 ssl;
    server_name sim.example.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
Clients will automatically upgrade to `wss://sim.example.com/ws`.

---

## 3. Running Tests

### Rust Server & Protocol Tests
```bash
cd multiplayer
cargo test
```

### Existing Single-Player JavaScript Tests (Unchanged)
```bash
node --test tests/*.test.js
```

---

## 4. Intentional Non-Goals (Phase 1 Foundation)
- Full migration of legacy JS physics, reactor, or acoustic ray-tracing to Rust.
- All 7 operator stations (`F1`–`F7`) in `multiplayer/client/`.
- Crew role permission matrices, account auth, matchmaking, persistent DBs, or PvP combat.
