# Captain's Tactical & Engineering Manual (HOWTO)

Welcome aboard **USS *Virginia* (SSN-774)** operating under **COMSUBNATO Mediterranean Command**. This manual walks you step-by-step through operating your nuclear attack submarine, managing its **S9G Pressurized Water Reactor**, analyzing sonar signatures, and executing torpedo and missile attacks.

> Back to [**Main Project README**](./README.md)

---

## Table of Contents

1. [Quick Start: Your First 60 Seconds on Patrol](#1-quick-start-your-first-60-seconds-on-patrol)
2. [Selecting a NATO Mediterranean Base & Mission](#2-selecting-a-nato-mediterranean-base--mission)
3. [Station-by-Station Guide (`F1` – `F6`)](#3-station-by-station-guide-f1--f6)
4. [Sonar, Narrowband DEMON & Target Motion Analysis (TMA)](#4-sonar-narrowband-demon--target-motion-analysis-tma)
5. [Distinguishing Threats from Whales & AIS Traffic](#5-distinguishing-threats-from-whales--ais-traffic)
6. [Ocean Acoustics: Cavitation, Thermocline & Baffles](#6-ocean-acoustics-cavitation-thermocline--baffles)
7. [Operating the S9G Pressurized Water Nuclear Reactor](#7-operating-the-s9g-pressurized-water-nuclear-reactor)
8. [Buoyancy, Ballast Tanks & Hydroplanes](#8-buoyancy-ballast-tanks--hydroplanes)
9. [Firing MK-48 ADCAP Torpedoes & VLS Missiles](#9-firing-mk-48-adcap-torpedoes--vls-missiles)
10. [Torpedo Defense & Evasion Tactics](#10-torpedo-defense--evasion-tactics)
11. [Saving, Loading & Exporting Patrols](#11-saving-loading--exporting-patrols)
12. [Keyboard Shortcuts Reference](#12-keyboard-shortcuts-reference)

---

## 1. Quick Start: Your First 60 Seconds on Patrol

1. **Deploy from a NATO Base**: On the startup modal, select a departure base (e.g., **Augusta Bay / NAS Sigonella** or **Souda Bay, Crete**), pick a mission profile (or leave on **Random Procedural Mission**), and click **`GENERATE & DEPLOY MISSION`**.
2. **Maintain Stealth**:
   - Check the top HUD bar for **`THERMAL LAYER: ~88m`** and **`OWN NOISE (CAV)`**.
   - Order a depth **below the thermal layer** (e.g., `120m`–`160m`) and keep your speed at **`2/3 (8 KT)`** or **`CREEP (4 KT)`** so you do not cavitate.
3. **Classify Contacts on Sonar (`[F2]`)**:
   - Press **`F2`** to open the **AN/BQQ-10 Sonar & TMA** console.
   - Click a bright vertical green trace on the **Broadband Waterfall** (or select a track in the right-hand **Tactical Contact List**).
   - Look at the **Narrowband LOFAR / DEMON Spectrum** in the bottom-left panel to read the contact's **Propeller Blade Count** and **Machinery Tonals (Hz)**, then click **`AUTO-ID`** (or manually match it from the dropdown and click **`CONFIRM ID`**).
4. **Build a TMA Firing Solution**:
   - Passive sonar only measures **bearing**. Wait for **TMA Solution Quality** to reach **`75%+`**, or turn your submarine by **`30°–45°`** (*"TMA Leg"*) so the bearing geometry shifts and triangulates the target's range.
5. **Engage Hostile Targets (`[F3]`)**:
   - Once positively identified as **`HOSTILE`** (Red Diamond or Red Submarine V-symbol), press **`F3`** (or click **`QUICK FIRE MK-48`** in the right sidebar) to launch a wire-guided torpedo!

---

## 2. Selecting a NATO Mediterranean Base & Mission

Click **`NATO BASE / MISSION`** in the top navigation bar at any time to choose from 7 real-world NATO naval bases:

| NATO Naval Base | Coordinates | Theater Characteristics |
| :--- | :--- | :--- |
| **Augusta Bay / NAS Sigonella (Italy)** | `37°10'N 015°21'E` | Drops rapidly into the `4,000m` Ionian Abyssal Plain; guards the shallow Strait of Sicily. |
| **Taranto Naval Base — Mar Grande (Italy)** | `40°15'N 017°09'E` | Deep Taranto submarine canyon leading toward the Strait of Otranto. |
| **Toulon Naval Base (France)** | `42°55'N 005°56'E` | Deep Algero-Provençal Basin; rich in Fin & Sperm Whale pods in the Pelagos Sanctuary. |
| **Souda Bay NATO Base (Crete, Greece)** | `35°37'N 024°16'E` | Overlooks the `5,120m` Calypso Deep / Hellenic Trench and Aegean chokepoints. |
| **La Spezia Naval Base & CMRE (Italy)** | `43°52'N 009°46'E` | Northern Tyrrhenian & Corsican channel approaches. |
| **HMNB Gibraltar / Rota (UK / Spain)** | `36°01'N 005°07'W` | Narrow Alboran Sea & Camarinal Sill (`285m`) bottleneck. |
| **Aksaz NATO Naval Base (Turkey)** | `36°34'N 028°21'E` | Deep Rhodes Abyssal Basin (`4,250m`) and Levantine Sea lanes. |

### Procedural Mission Profiles
- **`ASW HUNTER-KILLER INTERCEPT`**: Hunt Non-NATO nuclear and diesel-electric submarines (*Yasen-M SSGN*, *Akula II SSN*, *Improved Kilo SSK*).
- **`ANTI-SURFACE ACTION GROUP STRIKE`**: Penetrate an ASW screen to sink a *Slava*-class Guided Missile Cruiser and *Admiral Gorshkov* / *Grigorovich* frigates.
- **`NATO CARRIER ESCORT & SCREEN`**: Protect the allied flagship **ITS *Cavour* (CVH-550)** (`FRIENDLY` Link-16 contact) from ambushing Non-NATO submarines.
- **`MEDITERRANEAN BARRIER PATROL`**: Hold a strategic chokepoint against transiting hostile forces.

---

## 3. Station-by-Station Guide (`F1` – `F6`)

- **`[F1] GEO / TACTICAL PLOT`**:
  - Real-world interactive chart powered by **NOAA/ESRI World Ocean Basemap**, **CartoDB Dark Vector**, and **OpenSeaMap Nautical Seamarks**.
  - Click **`SET COURSE (CLICK MAP)`** and click anywhere in the sea to plot an automated navigation waypoint.
  - Click **`PROBE BATHYMETRY`** and click on the chart to drop an expendable bathythermograph (`XBT`) and query live seafloor & thermocline depth.
- **`[F2] SONAR & TMA`**:
  - Top-left: **Broadband Bearing-Time Waterfall (`000°–359°`)**.
  - Bottom-left: **Narrowband LOFAR / DEMON Spectrum (`10 Hz – 400 Hz`)** & **Acoustic Signature Matcher**.
  - Right: **Target Motion Analysis (`TMA`)** solution quality bar, range/course/speed estimates, and the **ONI Acoustic Reference Database**.
- **`[F3] FIRE CONTROL (WEPS)`**:
  - Manage **Torpedo Tubes 1–4** (`533mm` MK-48 Mod 7 ADCAP), **VLS Payload Tubes 1–6** (`UGM-84 Harpoon` & `UGM-109E Tomahawk`), **Live Fiber-Optic Wire Guidance**, and **ADC Mk 3 Noisemaker Decoys**.
- **`[F4] MANEUVERING & TRIM`**:
  - Control **Bow Planes**, **Stern Planes**, **Rudder**, **Main Ballast Tanks (`MBT`)**, **High-Pressure Air (`4500 PSI`)**, **Variable Trim Tanks**, and view the **Bathythermograph Sound Velocity Profile (`SVP`)**.
- **`[F5] S9G NUCLEAR REACTOR`**:
  - Monitor the **Reactor Pressure Vessel**, **Control Rod Withdrawal (`0–100%`)**, **Main Coolant Pumps (`NAT CIRC`, `SLOW`, `FAST`)**, **Steam Generator**, **Main Turbines**, **Main Storage Battery**, and **Emergency Diesel Generator**.
- **`[F6] PERISCOPE / RADAR / ESM`**:
  - Raise the **AN/BVS-1 Photonics Mast** (requires depth `<= 20m`) for visual/FLIR thermal target identification, raise the **AN/BLQ-10 ESM Mast** to passively intercept hostile ship radars and civilian AIS transponders, or transmit on the **AN/BPS-16 Surface Search Radar**.

---

## 4. Sonar, Narrowband DEMON & Target Motion Analysis (TMA)

### How Passive TMA Works
Passive sonar detects the **direction (bearing)** of sound, not its distance.
1. When a contact is first detected (`SIERRA-1`), its **TMA Quality** starts near `0%`, so its estimated range on the map has high uncertainty.
2. Keep the **TB-29A Towed Array** deployed (`STREAMED 800m`) for a wide acoustic aperture.
3. **Execute a TMA Leg**: Change your submarine's heading by `30°` to `60°` and maintain a steady speed for 20–30 seconds. Observing how the target's bearing rate shifts allows the AN/BYG-1 combat computer to triangulate exact range, course, and speed (`TMA > 80%`).
4. **Active Sonar Ping (`3.5 kHz`)**: Clicking **`ACTIVE PING`** (or pressing **`P`**) immediately jumps TMA quality to **`96%+`** on all contacts within `18 NM`, **but** radiates a `+55 dB` transient that alerts every hostile warship and submarine in the sector!

---

## 5. Distinguishing Threats from Whales & AIS Traffic

Strict **Rules of Engagement (ROE)** apply in the Mediterranean. Use the **Narrowband DEMON Spectrum (`[F2]`)** to check propeller blade counts and tonal frequencies before launching weapons:

| Category | Allegiance | Propeller Blades | Typical Tonals (Hz) | Examples |
| :--- | :--- | :---: | :---: | :--- |
| **Non-NATO Submarines** | `HOSTILE` (Red `V`) | **7 Blades** | `36–50 Hz`, `88–250 Hz` | *Yasen-M SSGN*, *Akula II SSN*, *Improved Kilo SSK* |
| **Non-NATO Warships** | `HOSTILE` (Red `<>`) | **5 Blades** | `50–60 Hz`, `120–290 Hz` | *Slava CG*, *Admiral Gorshkov FFG*, *Grigorovich FFG* |
| **NATO Allied Task Group** | `FRIENDLY` (Cyan `U`) | **5 Blades** | `60 Hz`, `110–310 Hz` | *ITS Cavour Carrier*, *Bergamini/Aquitaine FREMM* (Auto-ID via Link-16) |
| **Commercial AIS Traffic** | `NEUTRAL` (Green `[]`) | **3 – 4 Blades** | `22–35 Hz`, `60–190 Hz` | *MSC Container Liner*, *Grimaldi Ro-Ro Ferry*, *LNG Tanker*, *Fishing Trawler* |
| **Marine Biologics** | `BIOLOGIC` (Lime `~~`) | **0 Blades (`NONE`)** | `20 Hz`, `42 Hz` or `140–365 Hz` | *Sperm Whale Pod*, *Pelagos Fin Whale*, *Striped Dolphin Pod* |

> **Tip**: Selecting a contact also routes its acoustic signature to your **Hydrophone Audio Monitor**—ships and submarines produce a rhythmic mechanical blade swish, whereas whales and dolphins produce biological calls and clicks!

---

## 6. Ocean Acoustics: Cavitation, Thermocline & Baffles

1. **Propeller Cavitation**:
   - When propeller blade-tip pressure drops below vapor pressure, water vapor bubbles form and collapse violently (`+46 dB` noise spike).
   - Because water pressure increases every 10 meters of depth, your **Maximum Quiet Speed** increases the deeper you dive:
     - **Periscope Depth (`18m`)**: Cavitates above **`11.7 knots`**.
     - **Moderate Depth (`100m`)**: Cavitates above **`17.3 knots`**.
     - **Deep Operation (`250m`)**: Cavitates above **`27.5 knots`**.
2. **Mediterranean Thermocline (`~88m`)**:
   - Warm surface water (`~23.5°C`) sits above cooler Levantine Intermediate Water (`~13.6°C`). Sound waves bend across this boundary, creating a **`-14 dB` acoustic shadow zone**.
   - Stay **below the layer** when stalking surface warships so their hull sonars are blinded, then pop above the layer or set your torpedo run depth to `8m` to attack them.
3. **Astern Baffles (`150°–210°` Relative)**:
   - Your bow sonar array cannot hear through your own submarine's hull and propulsor wake directly astern. Keep your **TB-29A Towed Array** deployed (and stay below `25 knots` so you don't shear the cable) to monitor your baffles.

---

## 7. Operating the S9G Pressurized Water Nuclear Reactor

Open **`[F5] S9G NUCLEAR REACTOR`** to manage your propulsion plant:

- **Control Rods & Auto $T_{avg}$ Regulator**:
  - With **`AUTO T-AVG REGULATOR`** enabled, control rods automatically withdraw or insert to keep primary loop temperature at **`285°C`** as turbine steam demand changes.
- **Main Coolant Pumps (`LOOP A & B`)**:
  - **`NAT CIRC (SILENT)`**: Uses thermal buoyancy convection with pumps off (`+0 dB` noise). Supports up to **`38%` reactor power** (~12 knots). *Warning: Ordering Flank speed while on Natural Circulation will overheat the core (`T-Hot > 332°C`) and trigger an automatic **Reactor SCRAM**!*
  - **`SLOW PUMPS`**: Standard patrol setting (`+5 dB` noise, supports up to **`76%` power** / ~23 knots).
  - **`FAST PUMPS`**: Combat flank setting (`+14 dB` noise, supports **`100%+` power** / 32 knots).
- **Recovering from a Reactor SCRAM**:
  - If the reactor trips (`RX SCRAM`), control rods drop to `0%` and propulsion switches to the **Main Storage Battery** (max `6 knots`).
  - Wait `8 seconds` for the trip latch to cool down, lower your speed telegraph to `1/3` or `STOP`, and click **`RESET TRIP & PULL RODS`**.

---

## 8. Buoyancy, Ballast Tanks & Hydroplanes

Open **`[F4] MANEUVERING & TRIM`**:
- **Hydroplanes (Bow & Stern Planes)**: Effective above `4 knots`, using hydrodynamic lift to pitch the boat and change depth.
- **Variable Ballast (`AUX TRIM`)**: At very low speeds (`< 3 knots`), hydroplanes lose lift. Keep **`AUTO-NEUTRAL TRIM`** enabled so trim pumps automatically compensate for hull compression at depth.
- **Emergency Main Ballast Tank (`EMBT`) Blow**: Clicking **`EMERGENCY EMBT BLOW!`** dumps `4500 PSI` compressed air directly into the Main Ballast Tanks, creating massive positive buoyancy to surface the submarine rapidly in an emergency.

---

## 9. Firing MK-48 ADCAP Torpedoes & VLS Missiles

Open **`[F3] FIRE CONTROL (WEPS)`**:

### Firing a Wire-Guided MK-48 Mod 7 ADCAP Torpedo
1. Select a hostile track so its intercept heading populates **`LAUNCH GYRO HEADING`**.
2. Set **`TORPEDO RUN DEPTH`** (`SURF 8m` for surface warships, or the target submarine's depth).
3. Set **`SEEKER ENABLE RUN DISTANCE (YDS)`**: The torpedo will run straight for this distance before activating its acoustic seeker cone (preventing it from locking onto nearby neutral ships or your own submarine).
4. Click **`FLOOD & OPEN`** on a dry tube (`4s`), then click **`FIRE TUBE`**.
5. **Live Fiber-Optic Wire Guidance**: While the torpedo is running and **`WIRE ONLINE`** is displayed, you can steer the torpedo (`L 20°` / `R 20°`), change its depth (`SURF 15m` / `DEEP 165m`), or force its seeker active (`ENABLE NOW`). *Do not exceed `22 knots` own-ship speed or the guidance wire will snap!*

### Firing a VLS Harpoon or Tomahawk Missile
1. Bring your submarine to **`<= 45m` depth** and **`<= 12 knots` speed**.
2. Select a hostile surface warship (`depth 0m`).
3. Click any ready **`VLS 1–6`** button (or **`LAUNCH MISSILE`** in the right sidebar). The encapsulated missile broaches the surface, ignites its booster, and skims the waves at **480 knots (Mach 0.8)** toward the target.

---

## 10. Torpedo Defense & Evasion Tactics

When an enemy warship or submarine launches a **Yu-6** or **Yu-7** torpedo at you, the **`TORPEDO IN WATER`** master alarm flashes red:
1. **Launch an ADC Mk 3 Acoustic Decoy**: Press **`C`** (or click **`LAUNCH NOISEMAKER`**) to drop a high-output acoustic jammer/decoy.
2. **Cross the Thermocline Layer**: Dive below (or rise above) the `~88m` thermal layer so the incoming torpedo's seeker loses acoustic lock.
3. **Execute an Evasive Knuckle**: Click **`EVASIVE KNUCKLE`** in Fire Control (or turn `90°–110°` away from the torpedo bearing at **Ahead Flank** with **Fast Coolant Pumps** enabled) to leave a turbulent cavitation wake knuckle between the torpedo and your hull.

---

## 11. Saving, Loading & Exporting Patrols

- **Auto-Save**: Your entire patrol state (GPS coordinates, depth, reactor telemetry, tubes, contacts, and objectives) auto-saves to your browser's `localStorage` every **15 seconds**.
- **Manual Save**: Click **`SAVE`** in the top station bar at any time.
- **Resume Patrol**: When reopening the game, click **`RESUME SAVED PATROL`** in the command modal to continue right where you left off.
- **Export Save (`.json`)**: Click **`EXPORT JSON`** in the command modal to download a portable snapshot of your patrol.

---

## 12. Keyboard Shortcuts Reference

| Key | Action |
| :---: | :--- |
| **`F1` – `F6`** | Switch between Tactical Map, Sonar, Weapons, Maneuvering, Reactor, and Periscope stations |
| **`A` / `D`** | Turn ordered course Left `-5°` / Right `+5°` |
| **`W` / `S`** | Order shallower depth `-10m` / deeper depth `+10m` (triggers Dive Klaxon) |
| **`P`** | Transmit `3.5 kHz` Active Sonar Ping |
| **`C`** | Launch ADC Mk 3 Acoustic Noisemaker Decoy |
| **`ESC`** | Close Mission / Command Modal |
