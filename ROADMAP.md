# SSN-774 Submarine Simulator — Architecture Notes & Evolution Roadmap

This document summarizes what has been built so far, why evolving the simulator into a compiled client-server multiplayer architecture is a strong next step, and the different technical approaches available.

---

## 1. What Has Been Built So Far

The current simulator is a zero-build, browser-based tactical submarine simulation running on HTML5, CSS, Canvas 2D, pure WebGL 1, and Web Audio API:

### Core Simulation & Operator Stations (`F1`–`F7`)
- **7 Operator Stations** ([index.html](index.html), [js/stations.js](js/stations.js), [js/main.js](js/main.js)):
  - `[F1]` **Geo / Tactical Plot**: Leaflet nautical/satellite map, navigation waypoints, bathymetry probe, tactical overlays.
  - `[F2]` **Sonar & TMA**: AN/BQQ-10 broadband bearing-time waterfall, narrowband LOFAR/DEMON blade-rate spectrum, acoustic classifier, and Target Motion Analysis (TMA) mini-plot ([js/tma-solver.js](js/tma-solver.js)).
  - `[F3]` **Fire Control**: 4x 533mm torpedo tubes (MK-48 Mod 7 ADCAP with wire guidance, sharp-turn/spool wire breaks, and land/seabed impact destruction) + 6x VLS tubes (UGM-84 Harpoon & UGM-109E Tomahawk).
  - `[F4]` **Maneuvering**: Helm, depth, ballast/trim, emergency blow, and sound velocity profile (SVP).
  - `[F5]` **Nuclear Reactor**: S9G-inspired reactor & steam plant with control rods, coolant pump modes, diesel generator, battery, and SCRAM protection ([js/reactor.js](js/reactor.js)).
  - `[F6]` **Periscope / ESM**: Pure WebGL 1 3D ocean, atmospheric sky dome, 360° polar DEM terrain + ESRI satellite texture atlas, Kelvin wakes, FLIR thermal mode, radar/ESM mast, and external 3D orbit camera ([js/periscope3d.js](js/periscope3d.js)).
  - `[F7]` **Damage Control**: Multi-compartment hull integrity, flooding, dewatering pumps, and subsystem health ([js/damage-control.js](js/damage-control.js)).

### Acoustics, AI, Real-World Data & 3D Assets
- **Realistic WebAudio Sonar & Hydrophone Synthesis** ([js/audio.js](js/audio.js)): Contact-specific `tonalHz[]` machinery harmonics, propeller blade-rate beats, Doppler shift, stereo panning, torpedo whine, and 3.5 kHz active sonar pings with range-timed echoes.
- **ASW Air & Counter-Detection** ([js/asw-air.js](js/asw-air.js), [js/entities.js](js/entities.js)): Ka-27 Helix ASW helicopters, DIFAR/DICASS sonobuoys, APR-3E torpedoes, and counter-detection on exposed masts/snorkels.
- **Live Real-World Environmental Data**:
  - Gridded seafloor bathymetry via `/api/bathymetry` proxy in [serve_https.py](serve_https.py) (EMODnet Bathymetry + OpenTopoData ETOPO1 fallback) with automatic static-host fallback in [js/bathymetry.js](js/bathymetry.js).
  - Open-Meteo Elevation & live Mediterranean weather ([js/coastline.js](js/coastline.js), [js/weather.js](js/weather.js)) + Natural Earth 1:110m fallback ([js/med-landmask.js](js/med-landmask.js)).
- **3D Models & Branding**:
  - Zero-dependency glTF 2.0 (`.glb`) loader with texture-to-vertex-color baking ([js/glb-loader.js](js/glb-loader.js)) and open-licensed `.glb` models in `assets/models/` (`ohio-submarine.glb`, `typhoon-submarine.glb`, `helicopter.glb`, `buoy.glb`).
  - Cover banner (`assets/cover.png`), multi-size favicons (`favicon.ico`, `assets/favicon-*.png`), and 9 `node:test` suites in `tests/`.

---

## 2. Why Future Development (Client-Server Multiplayer) Is a Good Idea

1. **True Fog-of-War & Anti-Cheat**:
   - In a browser-only simulation, all enemy positions, headings, and torpedo tracks live in client JavaScript memory.
   - Moving the simulation to an **authoritative server** means clients never receive raw enemy coordinates—the server runs the acoustic SNR, thermocline, and bathymetry checks and sends each player **only what their sensors actually detect** (bearings, tonals, ESM strobes, or periscope line-of-sight).
2. **Multi-Crew Co-Op on One Submarine**:
   - The 7 stations already represent real submarine watchstations. A server lets 2–4 players crew the same SSN-774 simultaneously: **CO / Conn** (`F1`/`F6`), **Sonar / TMA** (`F2`), **Weapons** (`F3`), and **Engineering** (`F4`/`F5`).
3. **Tactical PvP (Sub-vs-Sub & Sub-vs-ASW)**:
   - Head-to-head Mediterranean engagements: SSN vs. rival SSN/SSK, or SSN vs. surface ASW frigate + helicopter crew.
4. **Heavier Physics & Acoustic Ray-Tracing**:
   - A compiled server can compute convergence zones (CZ), bottom-bounce propagation, seamount acoustic shadowing, and larger fleet battles at a deterministic 10–30 Hz tick without slowing down the player's browser.

---

## 3. Architectural Approaches for a Compiled Multiplayer Version

The current codebase already separates simulation state (`physics.js`, `reactor.js`, `entities.js`, `tma-solver.js`, `asw-air.js`, `simulation-clock.js`) from rendering (`stations.js`, `periscope3d.js`), making two main architectures practical:

### Approach 1: Compiled Authoritative Server + Existing Browser Client (WebSockets)
Keep the existing HTML5/CSS/Canvas/WebGL/WebAudio frontend and replace `serve_https.py` with a compiled server binary that manages lobbies, runs the authoritative simulation loop, and streams fog-of-war snapshots over WebSockets.

```text
[Browser Client (HTML5/WebGL)]  <── WebSocket (Commands / Fog-of-War Snapshots) ──>  [Compiled Server]
   • Renders F1–F7 CRT stations                                                       • 30 Hz fixed-step sim
   • Plays WebAudio sonar/screws                                                      • True positions & SNR
   • Sends helm/tube/ping orders                                                      • Serves static + /api/bathymetry
```

- **Pros**:
  - Reuses 100% of the existing 7 stations, Leaflet chart, WebGL periscope, `.glb` loader, and WebAudio engine.
  - Zero install for players (runs in any modern browser).
  - Clean separation: solo offline play can still work statically (or via WASM).
- **Cons**:
  - Subject to browser audio/WebGL constraints unless later wrapped for desktop.

### Approach 2: Compiled Server + Compiled Native Client
Both server and client are distributed as native binaries sharing simulation types/logic.

- **Variant 2A — Hybrid Desktop Wrapper (`Tauri` with Rust, or `Wails` with Go)**:
  - Wraps the existing HTML5/WebGL UI inside a lightweight (~10 MB) native desktop executable talking to the server over WebSockets/TLS.
  - Gives native distribution (`.exe` / `.AppImage` / `.dmg`) without rewriting the UI.
- **Variant 2B — Pure Native 3D Client (`Rust` + `Bevy` / `wgpu` + `egui`)**:
  - Rewrites both the server and the 7 operator stations + 3D ocean/periscope in native Rust sharing one `sim_core` crate.
  - **Pros**: Full native PBR 3D graphics, zero JS/Rust boundary, Steam/itch.io-ready builds.
  - **Cons**: Largest effort—requires rebuilding the 7 CRT stations, map tiles, and audio synthesizer from scratch.

---

## 4. Language Comparison: Rust vs. Go

| Criterion | **Rust** (`tokio` + `axum`) | **Go** (`net/http` + `websocket`) |
| :--- | :--- | :--- |
| **Server Performance** | Zero GC pauses, ideal for heavy acoustic ray-tracing & 30 Hz ticks | Very fast, sub-ms GC pauses (more than enough for 30 Hz naval sims) |
| **Development Speed** | Moderate (stricter types & borrow checker) | Very fast & simple goroutine-per-match concurrency |
| **Single Binary + Static Assets** | Yes (`rust-embed` / static dir) | Yes (`//go:embed` built into stdlib) |
| **Offline Browser Sharing (WASM)** | **Strong**: same `sim_core` crate compiles to WASM for solo mode | **Weak**: Go WASM binaries are large and less ergonomic for browser math |
| **Desktop / Native Client Path** | **Strong**: Tauri (hybrid) or Bevy/wgpu (native 3D) | **Moderate**: Wails (hybrid); weaker 3D native ecosystem |

### Recommended Path
**Rust + Approach 1** (`sim_core` crate + `axum` WebSocket server + existing browser client):
1. Keeps all existing frontend work intact and playable immediately.
2. Enforces true server-side fog-of-war for Co-Op Crew and PvP matches.
3. Leaves the door open for **WASM single-player**, **Tauri desktop builds (2A)**, or a **Bevy native 3D client (2B)** without rewriting the core simulation.

---

## 5. Additional Future Gameplay & Technical Evolutions

- **3D Surface Fleet & Effects**: Add `.glb` models for frigates, destroyers, cruisers, carriers, and merchant/cargo ships in [js/glb-loader.js](js/glb-loader.js), plus 3D underwater explosion plumes and torpedo bubble trails.
- **Persistent Mediterranean Campaign & Replay**: Chain patrols across the 7 NATO bases with persistent hull/magazine logistics, theatre alert escalation, and a `10x–60x` post-mission tactical track replay.
- **Environmental & Special Ops**: Moored/bottom minefields in chokepoints (Gibraltar, Messina), convergence-zone acoustic paths, P-8/Il-38 maritime patrol aircraft, and Tomahawk/SEAL SDV covert missions.
- **Automated CI**: Add a `.github/workflows/` pipeline to run `node --test tests/*.test.js` automatically on every push and pull request.
