# SSN-774 Tactical Nuclear Submarine Simulator (Mediterranean NATO Edition)

A retro **90s CRT-styled Nuclear Attack Submarine Simulator** inspired by classic naval simulations (*Jane's 688(I) Hunter/Killer*, *Sub Command*, *Red Storm Rising*). Built with **HTML5 Canvas, Vanilla JavaScript, Web Audio API, and Real-World Geographic/Bathymetric Map Services** with zero game-engine dependencies.

> **[Read the Captain's Tactical & Engineering Manual (`HOWTO.md`)](./HOWTO.md)** for full step-by-step instructions on operating the submarine, analyzing sonar signatures, managing the nuclear reactor, and firing wire-guided torpedoes.

---

## Key Features

### 1. Mediterranean NATO Theater & Procedural Missions
- **7 Selectable NATO Naval Bases**: Start patrols from **Augusta Bay / NAS Sigonella (Sicily)**, **Taranto (Italy)**, **Toulon (France)**, **Souda Bay (Crete, Greece)**, **La Spezia (Italy)**, **HMNB Gibraltar / Rota**, or **Aksaz (Turkey)**.
- **Procedural Mission Generator**: Generates randomized **ASW Hunter-Killer Intercepts**, **Anti-Surface Action Group Strikes**, **NATO Carrier Escort & Screens** (protecting **ITS *Cavour***), and **Chokepoint Barrier Patrols** against Non-NATO naval forces (*Project 885M Yasen-M SSGN*, *Akula II SSN*, *Improved Kilo SSK*, *Slava CG*, *Admiral Gorshkov FFG*).
- **Real Mediterranean Bathymetry & Charts**: Combines **NOAA/ESRI World Ocean Basemap**, **OpenSeaMap Nautical Seamarks**, and **Open-Meteo Elevation API** probes with Mediterranean trenches (Calypso Deep `5,120m`, Ionian Abyssal Plain `4,050m`, Rhodes Basin) and shallow sills (Adventure Bank, Malta Plateau, Camarinal Sill).

### 2. Realistic Submarine Engineering & Physics
- **General Electric S9G Pressurized Water Reactor (`PWR`)**:
  - Models control rod withdrawal (`0–100%`), automatic $T_{avg}$ (`285°C`) regulator vs. manual rod control, negative moderator temperature reactivity feedback, primary loop pressure (`2250 PSI`), and Steam Generator pressure (`890 PSI`).
  - Switchable **Main Coolant Pumps**: **Natural Circulation** (`0 dB` pump noise, convection cooling up to `38%` power), **Slow Pumps** (`+5 dB`), and **Fast Pumps** (`+14 dB`, full flank power). Overpowering the core on insufficient coolant flow triggers an automatic **Reactor SCRAM**.
  - **Main Storage Battery** & snorkel-depth **Emergency Diesel Generator** (`<= 20m`).
- **Buoyancy, Ballast & Hydrodynamics**:
  - Independent **Bow & Stern Hydroplanes**, **Main Ballast Tanks (`MBT`)** with flood vents, normal blow, and `4500 PSI` **Emergency EMBT Blow**, plus **Variable Ballast Trim** compensation for deep hull compression.
  - Depth-dependent **Propeller Cavitation** ($\text{Cavitation Speed} \approx 10.5 + 0.068 \times \text{Depth}$).

### 3. Acoustic Propagation, AIS Traffic & Marine Biologics
- **AN/BQQ-10 Sonar Suite**:
  - **Passive Broadband Waterfall (`000°–359°`)** with astern hull baffles (`150°–210°` rel) and **TB-29A Thin-Line Towed Array** (`800m`).
  - **Narrowband LOFAR / DEMON Spectrum Analyzer (`10–400 Hz`)** displaying propeller blade counts and machinery tonals.
  - **Target Motion Analysis (`TMA`)** solution solver that triangulates range and course as bearing geometry changes.
  - **Mediterranean Thermocline (`~88m`)** refraction modeling a `-14 dB` cross-layer acoustic shadow zone using the Mackenzie sound velocity equation (`38.4 PSU` Mediterranean salinity).
- **Real Mediterranean Shipping & Random Biological Encounters**:
  - Named commercial **AIS Vessels** (*MSC*, *CMA CGM*, *Grimaldi Lines*, *Tirrenia Ferries*, *Maran Gas LNG Tankers*, and fishing trawlers) transit shipping lanes and broadcast AIS when your ESM mast is raised at periscope depth.
  - Dynamic **Marine Biologics** (**Sperm Whale Pods**, **Pelagos Fin Whales**, and **Striped Dolphins**) wander and dive across the sector, emitting biological frequencies (`20 Hz` pulses & echolocation clicks) with `0` propeller blades on DEMON.

### 4. Weapons, Periscope, Radar/ESM & Procedural Web Audio
- **Weapons Control (`AN/BYG-1`)**:
  - **4x 533mm Torpedo Tubes**: Flood tube, open outer shutter door, launch **MK-48 Mod 7 CBASS ADCAP** torpedoes, and steer them in real time via **Fiber-Optic Wire Guidance**.
  - **6x VLS Payload Tubes**: Launch encapsulated **UGM-84 Harpoon Block II** and **UGM-109E Tomahawk** anti-ship missiles from `<= 45m` depth.
  - **Countermeasures**: Deploy **ADC Mk 3 Noisemaker Decoys** and execute high-speed **Evasive Knuckles**.
- **Procedural Web Audio Synthesizer**:
  - Zero external audio files required—synthesizes continuous hydrophone target propeller blade-beats, biological whale songs/clicks, high-speed torpedo screw whine, `3.5 kHz` active sonar pings with distance-delayed target echoes, diving klaxons (`"AWOOGA!"`), pneumatic air hisses, and underwater explosion shockwaves.
- **Persistent Save / Load Model**:
  - Auto-saves patrol state every 15 seconds to browser `localStorage`, with manual **Save**, **Resume Saved Patrol**, and **Export JSON** support.

---

## Documentation & Operator Manual

- [**Captain's Tactical & Engineering Manual (`HOWTO.md`)**](./HOWTO.md) — Complete guide to all stations, sonar classification, reactor operation, and combat tactics.

---

## Project Structure

```text
submarine/
├── index.html          # Main multi-station CRT interface & command modal
├── README.md           # Project overview & quick setup
├── HOWTO.md            # Clickable Captain's Tactical & Engineering Manual
├── css/
│   └── style.css       # 90s MIL-STD-1472 CRT green/amber/cyan phosphor styling
└── js/
    ├── audio.js        # Procedural Web Audio synthesizer & hydrophone audio monitor
    ├── bathymetry.js   # Mediterranean Sea bathymetry, thermocline & geodesy engine
    ├── reactor.js      # General Electric S9G PWR nuclear reactor & steam plant physics
    ├── physics.js      # Submarine 6-DOF hydrodynamics, ballast, cavitation & sonar SNR
    ├── missions.js     # NATO bases, ONI acoustic DB, procedural mission & traffic generator
    ├── entities.js     # Contacts, TMA solver, wire-guided torpedoes, missiles & serialization
    ├── stations.js     # Canvas renderers for Map, Waterfall, DEMON, SVP, Reactor & Periscope
    └── main.js         # Simulation loop, UI controller, dismissible CRT popups & Save/Load
```

---

## Running Locally

No build tools or external dependencies are required.

### Option 1: Python Built-in HTTP Server (Recommended)
```bash
cd submarine
python3 -m http.server 8080
```
Then open **[http://localhost:8080](http://localhost:8080)** in any modern browser.

### Option 2: Direct Browser Open
Open `index.html` directly in Chrome, Firefox, Edge, or Safari.
*(Note: Internet connection is recommended to load live NOAA/ESRI Ocean Basemap & OpenSeaMap Nautical Seamark tiles; the analytical Mediterranean bathymetry model works both online and offline.)*
