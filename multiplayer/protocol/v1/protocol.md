# Protocol v1 Specification

Transport: **WebSockets over TCP** (`ws://` local, `wss://` behind TLS reverse proxy).  
Encoding: **UTF-8 JSON**, with a top-level `"type"` and `"version": 1`.

---

## Client-to-Server Messages

### 1. `HELLO`
Sent immediately after opening the WebSocket connection to negotiate protocol version and optionally resume an existing session.
```json
{
  "type": "HELLO",
  "version": 1,
  "payload": {
    "clientName": "web-tactical-client",
    "sessionId": null
  }
}
```
- `clientName` (`string`): Human-readable client label.
- `sessionId` (`string | null`): Optional previous session UUID for reconnection.

### 2. `PING`
Sent periodically by the client to measure round-trip latency and refresh the server heartbeat.
```json
{
  "type": "PING",
  "version": 1,
  "payload": {
    "clientTimeMs": 1731940000123
  }
}
```

### 3. `COMMAND`
Expresses a player intention. Never mutates world state on the client; the server validates and responds with `COMMAND_RESULT`.
```json
{
  "type": "COMMAND",
  "version": 1,
  "sequence": 12,
  "payload": {
    "command": "SET_HEADING",
    "value": 145
  }
}
```
Supported `payload.command` values:
- `SET_HEADING`: `value` in `[0, 360]` degrees true.
- `SET_SPEED`: `value` in `[-5, 32]` knots.
- `SET_DEPTH`: `value` in `[0, 400]` meters.

---

## Server-to-Client Messages

### 1. `WELCOME`
Sent in response to a valid `HELLO`, followed immediately by a complete `WORLD_SNAPSHOT`.
```json
{
  "type": "WELCOME",
  "version": 1,
  "payload": {
    "sessionId": "6b2d6f18-...",
    "worldId": "med-patrol-alpha",
    "simHz": 30,
    "snapshotHz": 10,
    "reconnected": false
  }
}
```

### 2. `WORLD_SNAPSHOT`
Authoritative, fog-of-war-filtered view of the world for this client.
```json
{
  "type": "WORLD_SNAPSHOT",
  "version": 1,
  "payload": {
    "worldId": "med-patrol-alpha",
    "serverTick": 900,
    "simTimeSec": 30.0,
    "snapshotSeq": 301,
    "ownSub": {
      "id": "SSN-774",
      "name": "USS Virginia (SSN-774)",
      "lat": 37.1805,
      "lon": 15.5012,
      "headingDeg": 90.0,
      "orderedHeadingDeg": 145.0,
      "speedKts": 10.0,
      "orderedSpeedKts": 12.0,
      "depthM": 45.0,
      "orderedDepthM": 45.0
    },
    "contacts": [
      {
        "id": "TRK-01",
        "designation": "M/V AEGEAN TRADER",
        "category": "MERCHANT",
        "allegiance": "NEUTRAL",
        "lat": 37.245,
        "lon": 15.582,
        "bearingDeg": 42.3,
        "rangeNm": 5.4,
        "headingDeg": 215.0,
        "speedKts": 13.0,
        "depthM": 0.0
      }
    ],
    "environment": {
      "seaState": 2,
      "thermoclineM": 85.0,
      "waterDepthM": 2305.0,
      "windSpeedKts": 9.0,
      "windDirDeg": 135.0
    }
  }
}
```
> **Security invariant:** Hidden authoritative contacts (e.g. `detectableByClient == false`) and internal server fields (`internalAiState`, `internalReactorPowerMw`, etc.) are never included in `WORLD_SNAPSHOT`.

### 3. `WORLD_EVENT`
Discrete event notification (never silently dropped).
```json
{
  "type": "WORLD_EVENT",
  "version": 1,
  "payload": {
    "eventId": 1,
    "serverTick": 910,
    "category": "CONN",
    "message": "Ordered course 145° TRUE."
  }
}
```

### 4. `COMMAND_RESULT`
Explicit acknowledgement or rejection of a `COMMAND` message.
```json
{
  "type": "COMMAND_RESULT",
  "version": 1,
  "sequence": 12,
  "payload": {
    "accepted": true,
    "command": "SET_HEADING",
    "message": "Heading order 145° accepted."
  }
}
```

### 5. `PONG`
Echoes `clientTimeMs` plus `serverTick` for RTT calculation.

### 6. `ERROR`
Sent when a message fails JSON parsing, protocol version check, or handshake ordering.
```json
{
  "type": "ERROR",
  "version": 1,
  "payload": {
    "code": "UNSUPPORTED_VERSION",
    "message": "Unsupported protocol version 2; expected 1."
  }
}
```
