# SSN-774 Submarine Simulator

A browser-based, retro CRT-style submarine simulation inspired by classic naval games such as *Jane's 688(I) Hunter/Killer*, *Sub Command*, and *Red Storm Rising*.

The project is built with HTML5, CSS, Canvas, and vanilla JavaScript. It has no build step or game-engine dependency.

> **New to the simulator?** Start with the [Captain's Tactical & Engineering Guide](./HOWTO.md).

## Audio assets & licensing
- **Periscope coastline fallback:** Natural Earth 1:110m Land (public domain), cropped to the Mediterranean and Atlantic approaches, plus a small local correction around the Provençal coast near Toulon where the small-scale dataset generalizes the shoreline. Copernicus DEM GLO-90 remains the preferred elevation source when online; the local profile keeps a visible approximation available during loading or offline use.


- **Submarine sonar ping:** Spiceman — Sonar Ping, released under **CC0**. The simulator streams the MP3 directly from OpenGameArt (https://opengameart.org/sites/default/files/sonar_ping_0.mp3) and keeps a procedural Web Audio fallback if the remote asset cannot be reached. The audio therefore requires an internet connection on first playback; the source page states that no credit is required, but it is documented here for provenance.

## Features

### Mediterranean operations
- Seven selectable departure locations: Augusta Bay, Taranto, Toulon, Souda Bay, La Spezia, Gibraltar/Rota, and Aksaz.
- Procedurally generated patrol, anti-submarine, anti-surface, carrier-screen, and chokepoint missions.
- Simulated commercial shipping, hostile and friendly contacts, and marine-life encounters.

### Submarine operations
- Seven operator stations: tactical plot, sonar, weapons, maneuvering, reactor, periscope/ESM, and damage control.
- Helm orders, depth control, hydroplanes, rudder, ballast, trim, and emergency surfacing.
- A simplified S9G-inspired reactor and propulsion model with control rods, coolant-pump modes, battery, diesel generator, and SCRAM protection.
- Torpedo tubes, VLS launch controls, wire-guidance gameplay, and acoustic decoys.
- Compartment-based damage control, localized flooding, dewatering, and subsystem degradation.

### Sensors and acoustic environment
- Passive broadband bearing-time waterfall and a profile-based LOFAR/DEMON-style display.
- Contact classification against the simulator's acoustic profile database.
- TMA-style tracking display, bearing-rate information, estimated range, and contact course/speed.
- Simplified thermocline, sound-speed, propagation-loss, cavitation, and baffle effects.
- Leaflet tactical map with selectable map layers, nautical overlays, waypoints, and bathymetry probes.
- Legacy 2D periscope coastal skyline from Copernicus DEM GLO-90 elevation samples, with Earth-curvature correction and visibility presets.
- WebGL 3D periscope view (`PERISCOPE 3D`) and external hull/seabed camera (`OUTSIDE 3D`), driven by live submarine position, heading, depth, and simulated contact coordinates (`js/periscope3d.js`). Both modes support interactive mouse drag (slew bearing/elevation in periscope mode, orbit camera in external mode) and mouse-wheel zoom (`1.5×` – `12×` optics or `75m` – `680m` external orbit).
- **3D Ocean & Atmospheric Sky Dome**: Camera-centered radial LOD ocean mesh (`3m` to `52 km`) with 4-train Gerstner/trochoidal swells scaled by wind speed, per-pixel capillary wave normals, Schlick Fresnel sky reflections, solar glitter, and whitecap foam, paired with a 3D sky hemisphere featuring Rayleigh/Mie scattering, a 3D sun disc, animated FBM clouds, night stars, and thunderstorm lightning.
- **3D Terrain & Satellite Texturing**: High-resolution 360° polar multi-ring terrain (`144` azimuths × `24` rings out to `104 km`) and underwater seabed mesh with smooth Phong vertex normals, FBM mountain ridges, Copernicus DEM GLO-90 horizon samples (`js/coastline.js`), and a live `768×768` **ESRI World Imagery** satellite texture atlas draped onto Mediterranean coastlines.
- **Live Real-Time Meteorology (`js/weather.js`)**: Fetches actual current weather conditions (cloud cover, wind speed/direction, visibility, temperature, precipitation, WMO weather code, day/night) at the submarine's coordinates from the **Open-Meteo Forecast API** (`METEO: LIVE` default, with manual `CLEAR`, `HAZE`, `OVERCAST`, `STORM`, and `FOG` presets and animated lens rain streaks).
- 3D-projected tactical HUD overlay layered over the WebGL viewport, displaying target lock brackets with range (`NM` and `yards`), bearing, and speed, geographic landmark and NATO base distance tags, a 360° surroundings strip (land sectors and contacts around the compass), and a center-reticle Line-of-Sight (`LOS`) stadimeter rangefinder. The 2D optical display remains as an automatic fallback when WebGL is unavailable.

### Persistence and simulation controls
- Fixed-step simulation clock.
- F7 damage-control station with a live longitudinal compartment diagram.
- 1x, 2x, 5x, and 10x time-compression controls.
- Browser local-storage autosave and manual save/resume.
- JSON save export.

## Important simulation notes

This is an **educational/game simulation**, not a validated submarine tactical trainer. Several displays use simplified or synthetic models. In particular:

- **True Bearing-Only TMA Solver (`js/tma-solver.js`)**: 4-state Cartesian Levenberg-Marquardt / Gauss-Newton estimator (`[px, py, vx, vy]`) that solves target range, course, and speed strictly from own-ship trajectory and passive sonar bearing history (requiring an own-ship maneuver leg for range observability, or an active-ping/radar/periscope/Link-16 range aid).
- **LOFAR/DEMON is profile-driven.** The display visualizes tonal values stored in each contact's acoustic profile; it does not currently calculate a spectrum from sampled hydrophone audio using an FFT.
- **AIS and vessel traffic are generated by the mission/encounter system.** The simulator does not connect to a live AIS feed.
- **The 3D periscope and seabed terrain is a hybrid approximation.** It builds a 360° polar multi-ring mesh from the local Mediterranean land mask (`js/med-landmask.js`), procedural bathymetry/relief features, and radial horizon samples from Copernicus DEM GLO-90 (`js/coastline.js`), and applies distance-compensated visual scaling to vessels so silhouettes remain legible at naval ranges. Surface vessel positions and headings are taken from the live simulated entities, not from a live AIS feed.
- **Bathymetry used by simulation physics is procedural.** The map can display third-party map tiles, and the online elevation probe can help identify land/coastline elevation; it does not provide measured underwater seafloor depth. Do not treat the simulated depth values as navigational data.
- **Torpedo warning acknowledgement is local.** Click the active TORPEDO IN WATER annunciator to silence only the torpedo klaxon; other simulator sound effects continue.
- **The reactor, hydrodynamics, sonar propagation, and weapons are simplified gameplay models.** Their parameters are illustrative and are not engineering specifications for a real Virginia-class submarine.

These limitations are explicit so that the interface's realistic presentation is not mistaken for validated real-world modelling.

## Run locally

No package installation, build tool, or server-side application is required.

### Recommended: local HTTPS server

From the project directory (requires Python 3 and `openssl` to generate a local self-signed certificate in `/tmp/submarine-ssl`):

```bash
python3 serve_https.py
```

Then open [https://localhost:8443](https://localhost:8443) and accept the self-signed certificate prompt.

### Alternative: local HTTP server

From the project directory:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

On Windows, you can also use:

```powershell
py -m http.server 8080
```

Opening `index.html` directly may work, but serving the files over HTTP is recommended for browser API and asset compatibility.

An internet connection is required for third-party map tiles, the periscope's first terrain lookup at a new patrol location, and the optional online bathymetry probe. The periscope elevation profile is cached locally for 30 days and falls back to a sea-only horizon if unavailable. Terrain attribution is displayed in the periscope console: Copernicus DEM GLO-90 via Open-Meteo. See [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api). Core simulation logic runs locally; map layers and online probes may be unavailable offline.

## Tests

The project includes Node.js unit tests for the fixed-step simulation clock, compartment damage-control model, and hostile torpedo firing doctrine. From the project directory, run:

```bash
node --test tests/*.test.js
```

No third-party Node packages are required for this test suite.

## Project structure

```text
submarine/
├── index.html                  # Main interface and station layouts
├── serve_https.py              # Local HTTPS development server (port 8443)
├── README.md                   # Project overview and setup
├── HOWTO.md                    # Operator guide
├── css/
│   └── style.css               # CRT-inspired interface styling
├── tests/
│   ├── simulation-clock.test.js
│   ├── tma-solver.test.js
│   └── damage-control.test.js
└── js/
    ├── simulation-clock.js     # Fixed-step simulation clock
    ├── tma-solver.js           # 4-state bearing-only Levenberg-Marquardt TMA solver
    ├── audio.js                # Procedural Web Audio effects
    ├── bathymetry.js           # Procedural Mediterranean geography and acoustic profile
    ├── coastline.js            # 360° Copernicus DEM GLO-90 & fallback coastline horizon model
    ├── med-landmask.js         # Natural Earth Mediterranean land mask polygons
    ├── weather.js              # Live Open-Meteo meteorology service (wind, clouds, rain, visibility)
    ├── periscope3d.js          # WebGL 3D periscope, sky dome, satellite terrain, ocean & HUD projection
    ├── entities.js             # Contacts, tracking, weapons, and serialization
    ├── main.js                 # Simulation loop, UI controller, and save/load
    ├── missions.js             # Bases, acoustic profiles, missions, and generated traffic
    ├── damage-control.js       # Compartment integrity, flooding, and system-health model
    ├── physics.js              # Submarine movement, ballast, and sonar propagation model
    ├── reactor.js              # Simplified reactor and propulsion plant model
    └── stations.js             # Map, sonar, TMA, reactor, and periscope HUD renderers
```

## Documentation

- [Captain's Tactical & Engineering Guide](./HOWTO.md)
