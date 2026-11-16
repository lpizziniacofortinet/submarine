/**
 * ============================================================================
 * MEDITERRANEAN NATO BASES, ONI ACOUSTIC DATABASE, PROCEDURAL MISSION
 * GENERATOR, REAL AIS SHIPPING TRAFFIC & BIOLOGICAL ENCOUNTERS
 * ============================================================================
 */

window.NATO_BASES = [
  {
    id: 'AUGUSTA_SIGONELLA',
    name: 'Augusta Bay / NAS Sigonella (Sicily, Italy)',
    country: 'ITALY (NATO)',
    region: 'CENTRAL MEDITERRANEAN // IONIAN SEA & SICILY STRAIT',
    lat: 37.18,
    lon: 15.36,
    defaultHeading: 125,
    seaBearingMin: 60,
    seaBearingMax: 175,
    description: 'Strategic central Mediterranean submarine hub guarding the deep Ionian Abyssal Plain and the Strait of Sicily chokepoint.'
  },
  {
    id: 'TARANTO',
    name: 'Taranto Naval Base — Mar Grande (Taranto, Italy)',
    country: 'ITALY (NATO)',
    region: 'GULF OF TARANTO // NORTHERN IONIAN SEA',
    lat: 40.26,
    lon: 17.16,
    defaultHeading: 155,
    seaBearingMin: 135,
    seaBearingMax: 185,
    description: 'Main headquarters of the Italian Navy (MARPICCOLO/MARGRANDE) and NATO Submarine Command staging into the Ionian & Otranto Strait.'
  },
  {
    id: 'TOULON',
    name: 'Toulon Naval Base (Toulon, France)',
    country: 'FRANCE (NATO)',
    region: 'WESTERN MEDITERRANEAN // LIGURIAN & BALEARIC SEA',
    lat: 42.92,
    lon: 5.94,
    defaultHeading: 175,
    seaBearingMin: 130,
    seaBearingMax: 225,
    description: 'Homeport of the French Mediterranean Fleet & nuclear attack submarine squadron operating across the Algero-Provençal Basin and Pelagos Whale Sanctuary.'
  },
  {
    id: 'SOUDA_BAY',
    name: 'Souda Bay NATO Naval Base (Crete, Greece)',
    country: 'GREECE (NATO)',
    region: 'EASTERN MEDITERRANEAN // HELLENIC TRENCH & AEGEAN',
    lat: 35.62,
    lon: 24.28,
    defaultHeading: 70,
    seaBearingMin: 20,
    seaBearingMax: 110,
    description: 'Forward NATO deep-water submarine & carrier support facility overlooking the 5,000m Hellenic Trench and Eastern Mediterranean.'
  },
  {
    id: 'LA_SPEZIA',
    name: 'La Spezia Naval Base & CMRE (Liguria, Italy)',
    country: 'ITALY (NATO)',
    region: 'LIGURIAN & NORTHERN TYRRHENIAN SEA',
    lat: 43.88,
    lon: 9.78,
    defaultHeading: 205,
    seaBearingMin: 175,
    seaBearingMax: 240,
    description: 'Historic submarine base and home of the NATO Centre for Maritime Research and Experimentation (CMRE) north of Corsica.'
  },
  {
    id: 'GIBRALTAR',
    name: 'HMNB Gibraltar / Rota Approaches (Strait of Gibraltar)',
    country: 'UK / SPAIN (NATO)',
    region: 'WESTERN CHOKEPOINT // ALBORAN SEA',
    lat: 36.02,
    lon: -5.12,
    defaultHeading: 85,
    seaBearingMin: 70,
    seaBearingMax: 105,
    description: 'Ultimate Mediterranean gatekeeper monitoring all Non-NATO submarines entering or exiting the Atlantic through the Alboran Sea.'
  },
  {
    id: 'AKSAZ',
    name: 'Aksaz NATO Naval Base (Marmaris, Turkey)',
    country: 'TURKEY (NATO)',
    region: 'LEVANTINE BASIN // RHODES CHANNEL',
    lat: 36.58,
    lon: 28.35,
    defaultHeading: 190,
    seaBearingMin: 145,
    seaBearingMax: 235,
    description: 'Major eastern NATO submarine base overlooking the deep Rhodes Basin (4,200m) and Levantine approaches.'
  }
];

window.ACOUSTIC_PROFILES = {
  // ---------------- NON-NATO HOSTILES (Mediterranean Task Force) ----------------
  YASEN_M_SSGN: {
    id: 'YASEN_M_SSGN',
    name: 'Project 885M Yasen-M Class SSGN',
    shortName: 'YASEN-M SSGN',
    category: 'SUBMARINE',
    allegiance: 'HOSTILE',
    baseNoiseDb: 102,
    maxSpeedKts: 31,
    blades: 7,
    tonalHz: [50, 118, 215],
    plantType: 'KTP-6 PWR Nuclear (4th Gen Quiet)',
    radarName: 'MRO-550 Surface Search',
    hasActiveSonar: true,
    torpedoCount: 8,
    hitPoints: 115
  },
  AKULA_II_SSN: {
    id: 'AKULA_II_SSN',
    name: 'Project 971 Akula II (Shchuka-B) SSN',
    shortName: 'AKULA-II SSN',
    category: 'SUBMARINE',
    allegiance: 'HOSTILE',
    baseNoiseDb: 109,
    maxSpeedKts: 32,
    blades: 7,
    tonalHz: [50, 100, 175, 250],
    plantType: 'OK-650B PWR Nuclear Reactor',
    radarName: 'Chibis-M Snoop Pair Radar',
    hasActiveSonar: true,
    torpedoCount: 8,
    hitPoints: 105
  },
  KILO_636_SSK: {
    id: 'KILO_636_SSK',
    name: 'Project 636.3 Improved Kilo SSK',
    shortName: 'IMP. KILO SSK',
    category: 'SUBMARINE',
    allegiance: 'HOSTILE',
    baseNoiseDb: 93, // "Black Hole" ultra-quiet diesel-electric on battery
    maxSpeedKts: 20,
    blades: 7,
    tonalHz: [36, 88],
    plantType: 'Diesel-Electric Battery Creep',
    radarName: 'MRK-50 Albatros Radar',
    hasActiveSonar: true,
    torpedoCount: 6,
    hitPoints: 80
  },
  SLAVA_CG: {
    id: 'SLAVA_CG',
    name: 'Project 1164 Slava-Class Cruiser',
    shortName: 'SLAVA CG',
    category: 'SURFACE_WARSHIP',
    allegiance: 'HOSTILE',
    baseNoiseDb: 138,
    maxSpeedKts: 31,
    blades: 5,
    tonalHz: [60, 145, 290],
    plantType: 'COGOG (4x M8KF Gas Turbines)',
    radarName: 'MR-800 Voshkhod / Top Pair 3D Radar',
    hasActiveSonar: true,
    torpedoCount: 6,
    hitPoints: 165
  },
  GORSHKOV_FFG: {
    id: 'GORSHKOV_FFG',
    name: 'Project 22350 Admiral Gorshkov FFG',
    shortName: 'GORSHKOV FFG',
    category: 'SURFACE_WARSHIP',
    allegiance: 'HOSTILE',
    baseNoiseDb: 132,
    maxSpeedKts: 29,
    blades: 5,
    tonalHz: [55, 130, 260],
    plantType: 'CODAG (M90FR Gas Turbine + Diesel)',
    radarName: '5P-20K Poliment AESA Radar',
    hasActiveSonar: true,
    torpedoCount: 6,
    hitPoints: 115
  },
  GRIGOROVICH_FFG: {
    id: 'GRIGOROVICH_FFG',
    name: 'Project 11356R Admiral Grigorovich ASW FFG',
    shortName: 'GRIGOROVICH FFG',
    category: 'SURFACE_WARSHIP',
    allegiance: 'HOSTILE',
    baseNoiseDb: 131,
    maxSpeedKts: 30,
    blades: 5,
    tonalHz: [50, 120, 240],
    plantType: 'COGAG Gas Turbine Plant',
    radarName: 'Fregat-M2M 3D Search Radar',
    hasActiveSonar: true,
    torpedoCount: 8,
    hitPoints: 95
  },

  // ---------------- NATO FRIENDLY FORCES (Escort / Allied Task Group) ----------------
  NATO_CARRIER_CAVOUR: {
    id: 'NATO_CARRIER_CAVOUR',
    name: 'NATO Flagship Carrier (ITS Cavour / FS Charles de Gaulle)',
    shortName: 'NATO CARRIER',
    category: 'SURFACE_WARSHIP',
    allegiance: 'FRIENDLY',
    baseNoiseDb: 140,
    maxSpeedKts: 28,
    blades: 5,
    tonalHz: [60, 155, 310],
    plantType: 'NATO COGAG / PWR Carrier Plant',
    radarName: 'RAN-40L / EMPAR NATO 3D Radar',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 200
  },
  NATO_FREMM_FFG: {
    id: 'NATO_FREMM_FFG',
    name: 'NATO Bergamini/Aquitaine FREMM ASW Frigate',
    shortName: 'NATO FREMM',
    category: 'SURFACE_WARSHIP',
    allegiance: 'FRIENDLY',
    baseNoiseDb: 124,
    maxSpeedKts: 27,
    blades: 5,
    tonalHz: [60, 110, 220],
    plantType: 'CODLAG Hybrid Electric-Gas Turbine',
    radarName: 'KRONOS Grand Naval AESA (NATO IFF)',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 110
  },

  // ---------------- REAL MEDITERRANEAN COMMERCIAL AIS TRAFFIC ----------------
  MED_CONTAINER_ULCV: {
    id: 'MED_CONTAINER_ULCV',
    name: 'Suez-Med Container Liner (AIS Commercial)',
    shortName: 'AIS CONTAINER',
    category: 'MERCHANT',
    allegiance: 'NEUTRAL',
    baseNoiseDb: 147,
    maxSpeedKts: 22,
    blades: 4,
    tonalHz: [22, 60, 120],
    plantType: 'MAN B&W 2-Stroke Slow Marine Diesel',
    radarName: 'Furuno FAR-3000 Civil S/X-Band AIS',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 145
  },
  MED_RORO_FERRY: {
    id: 'MED_RORO_FERRY',
    name: 'Mediterranean Fast Ro-Ro Ferry (Grimaldi / Tirrenia)',
    shortName: 'AIS FERRY',
    category: 'MERCHANT',
    allegiance: 'NEUTRAL',
    baseNoiseDb: 141,
    maxSpeedKts: 24,
    blades: 4,
    tonalHz: [35, 95, 190],
    plantType: 'Twin Wärtsilä 4-Stroke Medium Diesels',
    radarName: ' Sperry VisionMaster Civil Nav Radar',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 110
  },
  MED_LNG_TANKER: {
    id: 'MED_LNG_TANKER',
    name: 'Mediterranean LNG / Crude Tanker (AIS)',
    shortName: 'AIS TANKER',
    category: 'MERCHANT',
    allegiance: 'NEUTRAL',
    baseNoiseDb: 144,
    maxSpeedKts: 17,
    blades: 4,
    tonalHz: [28, 74, 148],
    plantType: 'Dual-Fuel Marine Steam/Diesel',
    radarName: 'JRC Civil ARPA Marine Radar',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 150
  },
  MED_TRAWLER: {
    id: 'MED_TRAWLER',
    name: 'Mediterranean Fishing Trawler (AIS Class B)',
    shortName: 'MED TRAWLER',
    category: 'MERCHANT',
    allegiance: 'NEUTRAL',
    baseNoiseDb: 127,
    maxSpeedKts: 11,
    blades: 3,
    tonalHz: [32, 84, 168],
    plantType: 'Single Geared Marine Diesel',
    radarName: 'Simrad Halo Civil Radar',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 45
  },

  // ---------------- MEDITERRANEAN MARINE BIOLOGICS (WHALES & DOLPHINS) ----------------
  BIO_SPERM_WHALE: {
    id: 'BIO_SPERM_WHALE',
    name: 'Mediterranean Sperm Whale Pod (Physeter macrocephalus)',
    shortName: 'BIO SPERM WHALE',
    category: 'BIOLOGIC',
    allegiance: 'BIOLOGIC',
    baseNoiseDb: 126, // Loud biological echolocation clicks & codas!
    maxSpeedKts: 9,
    blades: 0,
    tonalHz: [185, 310],
    plantType: 'BIOLOGICAL (Echolocation Coda Clicks)',
    radarName: 'NONE (Marine Mammal)',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 35
  },
  BIO_FIN_WHALE: {
    id: 'BIO_FIN_WHALE',
    name: 'Pelagos Fin Whale Pod (Balaenoptera physalus)',
    shortName: 'BIO FIN WHALE',
    category: 'BIOLOGIC',
    allegiance: 'BIOLOGIC',
    baseNoiseDb: 129, // Famous 20 Hz infrasonic pulses!
    maxSpeedKts: 12,
    blades: 0,
    tonalHz: [20, 42],
    plantType: 'BIOLOGICAL (20Hz Mysticete Song)',
    radarName: 'NONE (Marine Mammal)',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 40
  },
  BIO_DOLPHIN_POD: {
    id: 'BIO_DOLPHIN_POD',
    name: 'Mediterranean Striped Dolphin Pod (Stenella)',
    shortName: 'BIO DOLPHINS',
    category: 'BIOLOGIC',
    allegiance: 'BIOLOGIC',
    baseNoiseDb: 119,
    maxSpeedKts: 16,
    blades: 0,
    tonalHz: [140, 280, 365],
    plantType: 'BIOLOGICAL (High-Freq Whistles/Clicks)',
    radarName: 'NONE (Marine Mammal)',
    hasActiveSonar: false,
    torpedoCount: 0,
    hitPoints: 25
  }
};

// Authentic Named Vessels for Mediterranean Immersion
const HOSTILE_NAMES = {
  YASEN_M_SSGN: ['RFS Kazan (K-561)', 'RFS Severodvinsk (K-560)', 'RFS Novosibirsk (K-573)'],
  AKULA_II_SSN: ['RFS Pantera (K-317)', 'RFS Vepr (K-157)', 'RFS Gepard (K-335)'],
  KILO_636_SSK: ['RFS Novorossiysk (B-261)', 'RFS Rostov-on-Don (B-237)', 'RFS Stary Oskol (B-262)', 'RFS Krasnodar (B-265)'],
  SLAVA_CG: ['RFS Marshal Ustinov (055)', 'RFS Varyag (011)'],
  GORSHKOV_FFG: ['RFS Admiral Kasatonov (461)', 'RFS Admiral Gorshkov (454)', 'RFS Admiral Golovko (456)'],
  GRIGOROVICH_FFG: ['RFS Admiral Essen (490)', 'RFS Admiral Makarov (499)', 'RFS Admiral Grigorovich (494)']
};

const AIS_SHIP_NAMES = {
  MED_CONTAINER_ULCV: [
    'MV MSC Loreto (MMSI 636022841)',
    'MV CMA CGM Jacques Saade (MMSI 228386800)',
    'MV Maersk Mc-Kinney Moller (MMSI 219018492)',
    'MV Hapag-Lloyd Algeciras (MMSI 218849000)',
    'MV Cosco Shipping Universe (MMSI 477194500)'
  ],
  MED_RORO_FERRY: [
    'MV Cruise Roma — Grimaldi Lines (MMSI 247219400)',
    'MV Janas — Tirrenia Ferry (MMSI 247056200)',
    'MV Superfast XI — Adriatic Line (MMSI 239924000)',
    'MV Mega Express Two — Corsica Ferries (MMSI 247182900)'
  ],
  MED_LNG_TANKER: [
    'MT Maran Gas Apollonia (MMSI 241298000)',
    'MT Minerva Chios (MMSI 240891000)',
    'MT GasLog Athens (MMSI 240562000)',
    'MT Eni Mediterraneo (MMSI 247311000)'
  ],
  MED_TRAWLER: [
    'FV San Vito — Mazara del Vallo (MMSI 247091230)',
    'FV Stella del Sud — Siracusa (MMSI 247119820)',
    'FV Poseidon II — Heraklion (MMSI 237481000)',
    'FV Sainte Marie — Marseille (MMSI 227491000)'
  ]
};

class MissionGenerator {
  static pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  static randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * Finds a safe deep-water coordinate near a base along its seaward sector
   */
  static findDeepWaterPoint(baseLat, baseLon, minBrg, maxBrg, minDistNm, maxDistNm) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const brg = this.randRange(minBrg, maxBrg);
      const dist = this.randRange(minDistNm, maxDistNm);
      const pt = window.Bathymetry.destinationPoint(baseLat, baseLon, brg, dist);
      const depth = window.Bathymetry.getSeafloorDepthMeters(pt.lat, pt.lon);
      if (depth >= 120) {
        return { lat: pt.lat, lon: pt.lon, brg, depth };
      }
    }
    const fallbackBrg = (minBrg + maxBrg) / 2;
    const pt = window.Bathymetry.destinationPoint(baseLat, baseLon, fallbackBrg, (minDistNm + maxDistNm) / 2);
    return { lat: pt.lat, lon: pt.lon, brg: fallbackBrg, depth: 350 };
  }

  /**
   * Procedurally generates a realistic NATO Mediterranean Patrol Mission starting from `baseId`
   * @param {string} baseId - ID from window.NATO_BASES
   * @param {string} preferredType - 'RANDOM', 'ASW_HUNT', 'SAG_STRIKE', 'NATO_ESCORT', 'PATROL_RECON'
   */
  static generateMission(baseId = 'AUGUSTA_SIGONELLA', preferredType = 'RANDOM') {
    const base = window.NATO_BASES.find((b) => b.id === baseId) || window.NATO_BASES[0];
    const missionTypes = ['ASW_HUNT', 'SAG_STRIKE', 'NATO_ESCORT', 'PATROL_RECON'];
    const mType = preferredType === 'RANDOM' ? this.pick(missionTypes) : preferredType;

    // Place submarine 4-6 NM seaward of the NATO naval base in deep water
    const startPt = this.findDeepWaterPoint(base.lat, base.lon, base.seaBearingMin, base.seaBearingMax, 4.0, 6.5);
    const startHeading = Math.round(startPt.brg) % 360;
    const startDepth = 75;

    const opNames = ['MEDUSA SHIELD', 'TRIDENT GUARD', 'IONIAN SHADOW', 'NOBLE MANTA', 'POSEIDON SPEAR', 'SIREN WATCH', 'AEGEAN SENTINEL'];
    const opCode = `OP-${this.pick(opNames).replace(' ', '-')}-${Math.floor(10 + Math.random() * 89)}`;

    const contacts = [];
    const objectives = [];
    let title = '';
    let briefingHtml = '';

    // 1. Build Primary Mission Forces based on Mission Type
    if (mType === 'ASW_HUNT') {
      const subTypes = ['YASEN_M_SSGN', 'AKULA_II_SSN', 'KILO_636_SSK'];
      const mainSubProf = this.pick(subTypes);
      const escortSubOrShip = this.pick(['KILO_636_SSK', 'GRIGOROVICH_FFG', 'GORSHKOV_FFG']);

      const pt1 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin - 15, base.seaBearingMax + 15, 5.2, 8.8);
      const pt2 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin - 15, base.seaBearingMax + 15, 4.5, 7.8);

      contacts.push({
        profileId: mainSubProf,
        trueName: this.pick(HOSTILE_NAMES[mainSubProf]),
        lat: pt1.lat,
        lon: pt1.lon,
        heading: Math.round((startHeading + 165 + this.randRange(-25, 25)) % 360),
        speedKts: mainSubProf === 'KILO_636_SSK' ? 6 : 11,
        depthM: Math.min(pt1.depth - 30, 145),
        aiBehavior: 'HUNTER_KILLER'
      });

      contacts.push({
        profileId: escortSubOrShip,
        trueName: this.pick(HOSTILE_NAMES[escortSubOrShip]),
        lat: pt2.lat,
        lon: pt2.lon,
        heading: Math.round((startHeading + 175 + this.randRange(-25, 25)) % 360),
        speedKts: escortSubOrShip === 'KILO_636_SSK' ? 7 : 15,
        depthM: escortSubOrShip === 'KILO_636_SSK' ? 115 : 0,
        aiBehavior: escortSubOrShip === 'KILO_636_SSK' ? 'HUNTER_KILLER' : 'ASW_SCREEN'
      });

      objectives.push({
        id: 'OBJ_MAIN_SUB',
        text: `Locate, Classify & Sink Non-NATO ${window.ACOUSTIC_PROFILES[mainSubProf].shortName}`,
        targetProfile: mainSubProf,
        requiredKills: 1
      });
      objectives.push({
        id: 'OBJ_ESCORT',
        text: `Neutralize Escorting ${window.ACOUSTIC_PROFILES[escortSubOrShip].shortName}`,
        targetProfile: escortSubOrShip,
        requiredKills: 1
      });

      title = `${opCode}: ASW HUNTER-KILLER INTERCEPT (${base.name.split('(')[0].trim()})`;
      briefingHtml = `
        <p><strong style="color:var(--crt-amber)">DEPARTURE BASE:</strong> ${base.name} (${window.Bathymetry.formatLatLon(base.lat, base.lon)})</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-cyan)">SITUATION (COMSUBNATO FLASH):</strong> Allied maritime patrol aircraft (P-8A Poseidon out of Sigonella) detected a transient from a Non-NATO <strong>${window.ACOUSTIC_PROFILES[mainSubProf].name}</strong> supported by a <strong>${window.ACOUSTIC_PROFILES[escortSubOrShip].name}</strong> operating in your sector.</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-green)">ORDERS:</strong> Sortie from ${base.name}, establish passive sonar contact, distinguish hostile signatures from heavy Mediterranean AIS shipping and marine mammals (whales/dolphins), and neutralize both hostile contacts.</p>
      `;
    } else if (mType === 'SAG_STRIKE') {
      const cruiserProf = 'SLAVA_CG';
      const frigateProf = this.pick(['GORSHKOV_FFG', 'GRIGOROVICH_FFG']);
      const screenSubProf = 'KILO_636_SSK';

      const pt1 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 6.2, 9.5);
      const pt2 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 5.0, 8.2);
      const pt3 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 4.2, 7.0);

      contacts.push({
        profileId: cruiserProf,
        trueName: this.pick(HOSTILE_NAMES[cruiserProf]),
        lat: pt1.lat,
        lon: pt1.lon,
        heading: Math.round((startHeading + 180) % 360),
        speedKts: 16,
        depthM: 0,
        aiBehavior: 'ASW_SCREEN'
      });
      contacts.push({
        profileId: frigateProf,
        trueName: this.pick(HOSTILE_NAMES[frigateProf]),
        lat: pt2.lat,
        lon: pt2.lon,
        heading: Math.round((startHeading + 175) % 360),
        speedKts: 17,
        depthM: 0,
        aiBehavior: 'ASW_SCREEN'
      });
      contacts.push({
        profileId: screenSubProf,
        trueName: this.pick(HOSTILE_NAMES[screenSubProf]),
        lat: pt3.lat,
        lon: pt3.lon,
        heading: Math.round((startHeading + 190) % 360),
        speedKts: 6,
        depthM: 125,
        aiBehavior: 'HUNTER_KILLER'
      });

      objectives.push({
        id: 'OBJ_SLAVA',
        text: 'Sink Flagship Slava-Class Guided Missile Cruiser',
        targetProfile: cruiserProf,
        requiredKills: 1
      });
      objectives.push({
        id: 'OBJ_FFG',
        text: `Sink Escorting ${window.ACOUSTIC_PROFILES[frigateProf].shortName}`,
        targetProfile: frigateProf,
        requiredKills: 1
      });

      title = `${opCode}: ANTI-SURFACE ACTION GROUP STRIKE (${base.name.split('(')[0].trim()})`;
      briefingHtml = `
        <p><strong style="color:var(--crt-amber)">DEPARTURE BASE:</strong> ${base.name}</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-cyan)">SITUATION:</strong> A Non-NATO Surface Action Group led by a <strong>Slava-Class Guided Missile Cruiser</strong> and a <strong>${window.ACOUSTIC_PROFILES[frigateProf].name}</strong> (screened below the thermocline by an <strong>Improved Kilo SSK</strong>) is conducting live-fire blockade maneuvers across Mediterranean sea lanes.</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-green)">ORDERS:</strong> Evade the Kilo SSK screen, use your MK-48 ADCAP torpedoes or VLS Harpoon/Tomahawk missiles to sink the Cruiser and Frigate, and avoid hitting neutral AIS vessels.</p>
      `;
    } else if (mType === 'NATO_ESCORT') {
      // Friendly NATO Carrier + NATO FREMM Frigate being stalked by 2 hostile Non-NATO submarines!
      const friendlyPt = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 2.5, 4.2);
      const stalker1Pt = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 5.2, 8.2);
      const stalker2Pt = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 6.0, 9.0);

      const sub1 = this.pick(['YASEN_M_SSGN', 'AKULA_II_SSN']);
      const sub2 = 'KILO_636_SSK';

      contacts.push({
        profileId: 'NATO_CARRIER_CAVOUR',
        trueName: 'ITS Cavour (CVH-550) [NATO HVU]',
        lat: friendlyPt.lat,
        lon: friendlyPt.lon,
        heading: startHeading,
        speedKts: 14,
        depthM: 0,
        aiBehavior: 'FRIENDLY_ESCORT'
      });

      contacts.push({
        profileId: sub1,
        trueName: this.pick(HOSTILE_NAMES[sub1]),
        lat: stalker1Pt.lat,
        lon: stalker1Pt.lon,
        heading: Math.round((startHeading + 180) % 360),
        speedKts: 11,
        depthM: 155,
        aiBehavior: 'HUNTER_KILLER'
      });

      contacts.push({
        profileId: sub2,
        trueName: this.pick(HOSTILE_NAMES[sub2]),
        lat: stalker2Pt.lat,
        lon: stalker2Pt.lon,
        heading: Math.round((startHeading + 165) % 360),
        speedKts: 6,
        depthM: 120,
        aiBehavior: 'HUNTER_KILLER'
      });

      objectives.push({
        id: 'OBJ_PROTECT_NATO',
        text: `Destroy Stalking ${window.ACOUSTIC_PROFILES[sub1].shortName} Threatening NATO Carrier`,
        targetProfile: sub1,
        requiredKills: 1
      });
      objectives.push({
        id: 'OBJ_PROTECT_KILO',
        text: 'Eliminate Ambushing Improved Kilo SSK',
        targetProfile: sub2,
        requiredKills: 1
      });

      title = `${opCode}: NATO CARRIER STRIKE GROUP ASW SCREEN (${base.name.split('(')[0].trim()})`;
      briefingHtml = `
        <p><strong style="color:var(--crt-amber)">DEPARTURE BASE:</strong> ${base.name}</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-cyan)">SITUATION:</strong> You are assigned as the forward subsurface vanguard for the allied flagship <strong>ITS Cavour (CVH-550)</strong> transiting out of ${base.name}. SOSUS indicates a Non-NATO <strong>${window.ACOUSTIC_PROFILES[sub1].name}</strong> and an <strong>Improved Kilo SSK</strong> have set an ambush ahead of the carrier!</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-green)">ORDERS:</strong> Screen ahead of <strong>ITS Cavour</strong> (do NOT fire on friendly NATO contacts!), classify the hostile submarines below the thermal layer, and destroy both before they can attack.</p>
      `;
    } else {
      // PATROL_RECON: Barrier patrol against Yasen-M + Gorshkov FFG
      const pt1 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 5.0, 8.5);
      const pt2 = this.findDeepWaterPoint(startPt.lat, startPt.lon, base.seaBearingMin, base.seaBearingMax, 5.8, 9.2);

      contacts.push({
        profileId: 'YASEN_M_SSGN',
        trueName: this.pick(HOSTILE_NAMES.YASEN_M_SSGN),
        lat: pt1.lat,
        lon: pt1.lon,
        heading: Math.round((startHeading + 150) % 360),
        speedKts: 10,
        depthM: 165,
        aiBehavior: 'HUNTER_KILLER'
      });
      contacts.push({
        profileId: 'GORSHKOV_FFG',
        trueName: this.pick(HOSTILE_NAMES.GORSHKOV_FFG),
        lat: pt2.lat,
        lon: pt2.lon,
        heading: Math.round((startHeading + 165) % 360),
        speedKts: 15,
        depthM: 0,
        aiBehavior: 'ASW_SCREEN'
      });

      objectives.push({
        id: 'OBJ_RECON_YASEN',
        text: 'Track, Classify & Neutralize Yasen-M Class SSGN',
        targetProfile: 'YASEN_M_SSGN',
        requiredKills: 1
      });
      objectives.push({
        id: 'OBJ_RECON_FFG',
        text: 'Neutralize Escorting Admiral Gorshkov FFG',
        targetProfile: 'GORSHKOV_FFG',
        requiredKills: 1
      });

      title = `${opCode}: MEDITERRANEAN BARRIER PATROL (${base.name.split('(')[0].trim()})`;
      briefingHtml = `
        <p><strong style="color:var(--crt-amber)">DEPARTURE BASE:</strong> ${base.name}</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-cyan)">SITUATION:</strong> Non-NATO naval forces including a 4th-generation <strong>Project 885M Yasen-M SSGN</strong> and a <strong>Project 22350 Admiral Gorshkov Frigate</strong> are attempting to slip past our Mediterranean barrier near ${base.name}.</p>
        <p style="margin-top:5px;"><strong style="color:var(--crt-green)">ORDERS:</strong> Establish a quiet barrier patrol below the thermocline (~88m), use Narrowband DEMON to separate the Yasen-M from Mediterranean commercial traffic and whale pods, and neutralize both hostile units.</p>
      `;
    }

    // 2. Add Real Mediterranean AIS Commercial Shipping Traffic (3 vessels in sector)
    const aisProfiles = ['MED_CONTAINER_ULCV', 'MED_RORO_FERRY', 'MED_LNG_TANKER', 'MED_TRAWLER'];
    for (let i = 0; i < 3; i++) {
      const profId = aisProfiles[i % aisProfiles.length];
      const shipPt = this.findDeepWaterPoint(startPt.lat, startPt.lon, 0, 360, 3.2, 8.5);
      contacts.push({
        profileId: profId,
        trueName: this.pick(AIS_SHIP_NAMES[profId]),
        lat: shipPt.lat,
        lon: shipPt.lon,
        heading: Math.floor(Math.random() * 360),
        speedKts: profId === 'MED_TRAWLER' ? 8 : 17,
        depthM: 0,
        aiBehavior: 'CIVILIAN'
      });
    }

    // 3. Add Initial Random Marine Biological Encounter (1-2 Whale/Dolphin pods)
    const bioProfiles = ['BIO_SPERM_WHALE', 'BIO_FIN_WHALE', 'BIO_DOLPHIN_POD'];
    const numBio = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numBio; i++) {
      const bProf = this.pick(bioProfiles);
      const bPt = this.findDeepWaterPoint(startPt.lat, startPt.lon, 0, 360, 2.2, 6.8);
      contacts.push({
        profileId: bProf,
        trueName: window.ACOUSTIC_PROFILES[bProf].name,
        lat: bPt.lat,
        lon: bPt.lon,
        heading: Math.floor(Math.random() * 360),
        speedKts: bProf === 'BIO_DOLPHIN_POD' ? 11 : 5,
        depthM: bProf === 'BIO_SPERM_WHALE' ? 220 : 35,
        aiBehavior: 'BIOLOGIC'
      });
    }

    return {
      id: opCode,
      code: opCode,
      baseId: base.id,
      baseName: base.name,
      missionType: mType,
      title,
      region: base.region,
      startLat: startPt.lat,
      startLon: startPt.lon,
      startHeading,
      startDepth,
      briefingHtml,
      objectives,
      contacts
    };
  }

  /**
   * Dynamically spawns a new biological encounter (Whale or Dolphin pod) near the submarine during patrol
   */
  static createDynamicBiologicConfig(subLat, subLon) {
    const bioProfiles = ['BIO_SPERM_WHALE', 'BIO_FIN_WHALE', 'BIO_DOLPHIN_POD'];
    const profId = this.pick(bioProfiles);
    const pt = this.findDeepWaterPoint(subLat, subLon, 0, 360, 2.8, 5.5);
    return {
      profileId: profId,
      trueName: window.ACOUSTIC_PROFILES[profId].name,
      lat: pt.lat,
      lon: pt.lon,
      heading: Math.floor(Math.random() * 360),
      speedKts: profId === 'BIO_DOLPHIN_POD' ? 12 : 5,
      depthM: profId === 'BIO_SPERM_WHALE' ? 190 : 30,
      aiBehavior: 'BIOLOGIC'
    };
  }

  /**
   * Dynamically spawns a new Mediterranean AIS commercial vessel transiting the area
   */
  static createDynamicAisVesselConfig(subLat, subLon) {
    const aisProfiles = ['MED_CONTAINER_ULCV', 'MED_RORO_FERRY', 'MED_LNG_TANKER', 'MED_TRAWLER'];
    const profId = this.pick(aisProfiles);
    const pt = this.findDeepWaterPoint(subLat, subLon, 0, 360, 5.5, 9.5);
    return {
      profileId: profId,
      trueName: this.pick(AIS_SHIP_NAMES[profId]),
      lat: pt.lat,
      lon: pt.lon,
      heading: Math.floor(Math.random() * 360),
      speedKts: profId === 'MED_TRAWLER' ? 9 : 18,
      depthM: 0,
      aiBehavior: 'CIVILIAN'
    };
  }
}

window.MissionGenerator = MissionGenerator;
