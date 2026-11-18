use std::collections::HashMap;
use crate::network::protocol::{
    ClientContactView, ClientDecoyView, ClientEnvironmentView, ClientOwnSubView, ClientWeaponView,
    ClientWorldSnapshot, WorldEventPayload,
};
use crate::world::bathymetry::seafloor_depth_m;
use crate::world::entity::{
    bearing_and_range_nm, compute_passive_snr_generic, normalize_heading, shortest_angle_diff,
    AuthoritativeContact, AuthoritativeDecoy, AuthoritativeSubmarine, AuthoritativeTorpedo,
    EnvironmentState,
};

#[derive(Debug, Clone)]
pub struct AuthoritativeWorld {
    pub world_id: String,
    pub tick: u64,
    pub sim_time_sec: f64,
    pub paused: bool,
    pub submarines: Vec<AuthoritativeSubmarine>,
    pub contacts: Vec<AuthoritativeContact>,
    pub weapons: Vec<AuthoritativeTorpedo>,
    pub decoys: Vec<AuthoritativeDecoy>,
    pub environment: EnvironmentState,
    pub event_seq: u64,
    pub weapon_seq: u64,
    pub decoy_seq: u64,
    pub pending_events: Vec<WorldEventPayload>,
    pub last_ping_alert_sec: f64,
    /// Per-(viewer_id, target_id) passive TMA quality percentage (0..72% passive).
    pub tma_quality: HashMap<(String, String), f64>,
}

impl AuthoritativeWorld {
    pub fn new_mediterranean_patrol(world_id: impl Into<String>) -> Self {
        Self {
            world_id: world_id.into(),
            tick: 0,
            sim_time_sec: 0.0,
            paused: false,
            submarines: vec![
                AuthoritativeSubmarine {
                    id: "SSN-774".to_string(),
                    name: "USS Virginia (SSN-774)".to_string(),
                    allegiance: "FRIENDLY".to_string(),
                    lat: 37.1800,
                    lon: 15.5000,
                    heading_deg: 90.0,
                    ordered_heading_deg: 90.0,
                    speed_kts: 10.0,
                    ordered_speed_kts: 10.0,
                    depth_m: 45.0,
                    ordered_depth_m: 45.0,
                    max_speed_kts: 32.0,
                    max_depth_m: 400.0,
                    hull_integrity_pct: 100.0,
                    sunk: false,
                    torpedoes_remaining: 16,
                    decoys_remaining: 8,
                    active_ping_cooldown_sec: 0.0,
                    active_range_lock_sec: 0.0,
                    towed_array_deployed: true,
                    human_controlled: true,
                    base_radiated_noise_db: 92.0,
                    internal_reactor_power_mw: 57.0,
                    internal_noise_db: 105.5,
                },
                // Second submarine: AI covert patrol by default, or player-commandable in PvP!
                AuthoritativeSubmarine {
                    id: "OPFOR-SUB".to_string(),
                    name: "K-561 Kazan (Yasen-M)".to_string(),
                    allegiance: "HOSTILE".to_string(),
                    lat: 37.2150,
                    lon: 15.4200,
                    heading_deg: 135.0,
                    ordered_heading_deg: 135.0,
                    speed_kts: 4.0,
                    ordered_speed_kts: 4.0,
                    depth_m: 160.0,
                    ordered_depth_m: 160.0,
                    max_speed_kts: 31.0,
                    max_depth_m: 450.0,
                    hull_integrity_pct: 100.0,
                    sunk: false,
                    torpedoes_remaining: 14,
                    decoys_remaining: 6,
                    active_ping_cooldown_sec: 0.0,
                    active_range_lock_sec: 0.0,
                    towed_array_deployed: false,
                    human_controlled: false,
                    base_radiated_noise_db: 91.0,
                    internal_reactor_power_mw: 30.0,
                    internal_noise_db: 96.4,
                },
            ],
            contacts: vec![
                AuthoritativeContact {
                    id: "TRK-01".to_string(),
                    designation: "M/V AEGEAN TRADER".to_string(),
                    category: "MERCHANT".to_string(),
                    allegiance: "NEUTRAL".to_string(),
                    lat: 37.2400,
                    lon: 15.5800,
                    heading_deg: 215.0,
                    ordered_heading_deg: 215.0,
                    speed_kts: 13.0,
                    depth_m: 0.0,
                    base_radiated_noise_db: 132.0,
                    active_range_lock_sec: 0.0,
                    sunk: false,
                    internal_ai_state: "TRANSIT".to_string(),
                    internal_weapon_load: 0,
                    ai_reload_sec: 0.0,
                },
                AuthoritativeContact {
                    id: "TRK-02".to_string(),
                    designation: "FFG ADMIRAL GORSHKOV".to_string(),
                    category: "WARSHIP".to_string(),
                    allegiance: "HOSTILE".to_string(),
                    lat: 37.1100,
                    lon: 15.6100,
                    heading_deg: 310.0,
                    ordered_heading_deg: 310.0,
                    speed_kts: 16.0,
                    depth_m: 0.0,
                    base_radiated_noise_db: 128.0,
                    active_range_lock_sec: 0.0,
                    sunk: false,
                    internal_ai_state: "PATROL_SCREEN".to_string(),
                    internal_weapon_load: 4,
                    ai_reload_sec: 0.0,
                },
            ],
            weapons: Vec::new(),
            decoys: Vec::new(),
            environment: EnvironmentState {
                sea_state: 2,
                thermocline_m: 85.0,
                water_depth_m: seafloor_depth_m(37.1800, 15.5000),
                wind_speed_kts: 9.0,
                wind_dir_deg: 135.0,
            },
            event_seq: 0,
            weapon_seq: 0,
            decoy_seq: 0,
            pending_events: Vec::new(),
            last_ping_alert_sec: -999.0,
            tma_quality: HashMap::new(),
        }
    }

    pub fn get_submarine(&self, vessel_id: &str) -> Option<&AuthoritativeSubmarine> {
        self.submarines.iter().find(|s| s.id == vessel_id)
    }

    pub fn get_submarine_mut(&mut self, vessel_id: &str) -> Option<&mut AuthoritativeSubmarine> {
        self.submarines.iter_mut().find(|s| s.id == vessel_id)
    }

    pub fn step(&mut self, dt_sec: f64) {
        if self.paused {
            return;
        }
        self.tick += 1;
        self.sim_time_sec += dt_sec;

        for sub in &mut self.submarines {
            let sf = seafloor_depth_m(sub.lat, sub.lon);
            sub.step(dt_sec, sf);
        }

        if let Some(primary) = self.get_submarine("SSN-774") {
            self.environment.water_depth_m = seafloor_depth_m(primary.lat, primary.lon);
        }

        // Step decoys
        for d in &mut self.decoys {
            d.ttl_sec -= dt_sec;
        }
        self.decoys.retain(|d| d.ttl_sec > 0.0);

        // Update passive TMA convergence for each submarine viewer
        let thermo = self.environment.thermocline_m;
        let sub_snapshots: Vec<(String, f64, f64, f64, f64, f64, bool)> = self
            .submarines
            .iter()
            .filter(|s| !s.sunk)
            .map(|s| {
                (
                    s.id.clone(),
                    s.lat,
                    s.lon,
                    s.depth_m,
                    s.speed_kts,
                    s.internal_noise_db,
                    s.towed_array_deployed,
                )
            })
            .collect();

        for (viewer_id, _, _, _, viewer_spd, _, _) in &sub_snapshots {
            if let Some(viewer) = self.submarines.iter().find(|s| &s.id == viewer_id) {
                for c in &self.contacts {
                    if c.sunk {
                        continue;
                    }
                    let (_, _, snr) = compute_passive_snr_generic(
                        viewer,
                        c.lat,
                        c.lon,
                        c.depth_m,
                        c.radiated_noise_db(),
                        thermo,
                    );
                    if snr >= 0.0 {
                        let key = (viewer_id.clone(), c.id.clone());
                        let q = self.tma_quality.entry(key).or_insert(10.0);
                        let rate = if viewer_spd.abs() >= 3.0 { 1.8 } else { 0.4 };
                        *q = (*q + rate * dt_sec).min(72.0);
                    }
                }
            }
        }

        // Hostile surface warship AI counter-detection & torpedo launch
        let primary_pos = self
            .get_submarine("SSN-774")
            .filter(|s| !s.sunk)
            .map(|s| (s.lat, s.lon, s.depth_m, s.internal_noise_db));
        let recent_ping = (self.sim_time_sec - self.last_ping_alert_sec) < 12.0;

        let mut ai_launches: Vec<(f64, f64, f64, String)> = Vec::new();
        for c in &mut self.contacts {
            c.step(dt_sec);
            if c.sunk || c.allegiance != "HOSTILE" || c.internal_weapon_load == 0 {
                continue;
            }
            if let Some((plat, plon, _pdepth, pnoise)) = primary_pos {
                let (brg, rng) = bearing_and_range_nm(c.lat, c.lon, plat, plon);
                let detected_player =
                    (recent_ping && rng <= 14.0) || (pnoise >= 115.0 && rng <= 8.0);
                if detected_player {
                    c.internal_ai_state = "ATTACK".to_string();
                    c.ordered_heading_deg = brg;
                    if c.ai_reload_sec <= 0.0 && rng <= 7.5 {
                        c.internal_weapon_load -= 1;
                        c.ai_reload_sec = 90.0;
                        ai_launches.push((c.lat, c.lon, brg, c.designation.clone()));
                    }
                }
            }
        }

        for (lat, lon, brg, shooter) in ai_launches {
            self.weapon_seq += 1;
            let wid = format!("HOSTILE-TORP-{:02}", self.weapon_seq);
            self.weapons.push(AuthoritativeTorpedo {
                id: wid.clone(),
                owner_id: shooter.clone(),
                owner_allegiance: "HOSTILE".to_string(),
                lat,
                lon,
                heading_deg: brg,
                speed_kts: 42.0,
                depth_m: 40.0,
                remaining_life_sec: 360.0,
                exploded: false,
            });
            self.event_seq += 1;
            self.pending_events.push(WorldEventPayload {
                event_id: self.event_seq,
                server_tick: self.tick,
                category: "SONAR".to_string(),
                message: format!(
                    "CONN, SONAR! TORPEDO IN THE WATER! {shooter} launched {wid}!"
                ),
            });
        }

        // Step active torpedoes: decoy lure, homing, land/seabed impact, and target impact
        for weapon in &mut self.weapons {
            if weapon.exploded {
                continue;
            }

            // 1. Acoustic decoy lure check (within 1.2 NM)
            let mut lure_brg: Option<f64> = None;
            let mut best_decoy_rng = 1.2;
            for d in &self.decoys {
                let (brg, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, d.lat, d.lon);
                if rng <= best_decoy_rng {
                    best_decoy_rng = rng;
                    lure_brg = Some(brg);
                }
            }

            if let Some(dbrg) = lure_brg {
                let turn = shortest_angle_diff(weapon.heading_deg, dbrg);
                let max_turn = 18.0 * dt_sec;
                weapon.heading_deg = if turn.abs() <= max_turn {
                    dbrg
                } else {
                    normalize_heading(weapon.heading_deg + turn.signum() * max_turn)
                };
            } else {
                // 2. Seeker acquisition against opposing contacts/submarines
                let mut best_target: Option<(f64, f64)> = None;
                for c in &self.contacts {
                    if c.sunk || c.allegiance == weapon.owner_allegiance {
                        continue;
                    }
                    let (brg, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, c.lat, c.lon);
                    let off_bow = shortest_angle_diff(weapon.heading_deg, brg).abs();
                    if rng <= 2.5 && off_bow <= 50.0 {
                        if best_target.map_or(true, |(_, br)| rng < br) {
                            best_target = Some((brg, rng));
                        }
                    }
                }
                for s in &self.submarines {
                    if s.sunk || s.id == weapon.owner_id || s.allegiance == weapon.owner_allegiance {
                        continue;
                    }
                    let (brg, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, s.lat, s.lon);
                    let off_bow = shortest_angle_diff(weapon.heading_deg, brg).abs();
                    if rng <= 2.5 && off_bow <= 50.0 {
                        if best_target.map_or(true, |(_, br)| rng < br) {
                            best_target = Some((brg, rng));
                        }
                    }
                }
                if let Some((tgt_brg, _)) = best_target {
                    let turn = shortest_angle_diff(weapon.heading_deg, tgt_brg);
                    let max_turn = 14.0 * dt_sec;
                    weapon.heading_deg = if turn.abs() <= max_turn {
                        tgt_brg
                    } else {
                        normalize_heading(weapon.heading_deg + turn.signum() * max_turn)
                    };
                }
            }

            weapon.step(dt_sec);

            // 3. Land / coastline / seabed impact check
            if !weapon.exploded {
                let sf = seafloor_depth_m(weapon.lat, weapon.lon);
                if sf <= 1.0 || weapon.depth_m >= sf {
                    weapon.exploded = true;
                    self.event_seq += 1;
                    self.pending_events.push(WorldEventPayload {
                        event_id: self.event_seq,
                        server_tick: self.tick,
                        category: "WEPS".to_string(),
                        message: format!(
                            "{} destroyed on coastline/seabed impact ({:.0}m water).",
                            weapon.id, sf
                        ),
                    });
                    continue;
                }
            }

            // 4. Target warhead detonation check
            if !weapon.exploded {
                for c in &mut self.contacts {
                    if c.sunk || c.allegiance == weapon.owner_allegiance {
                        continue;
                    }
                    let (_, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, c.lat, c.lon);
                    if rng <= 0.12 {
                        weapon.exploded = true;
                        c.sunk = true;
                        self.event_seq += 1;
                        self.pending_events.push(WorldEventPayload {
                            event_id: self.event_seq,
                            server_tick: self.tick,
                            category: "WEPS".to_string(),
                            message: format!(
                                "TORPEDO DETONATION! {} struck and sunk {}!",
                                weapon.id, c.designation
                            ),
                        });
                        break;
                    }
                }
            }

            if !weapon.exploded {
                for s in &mut self.submarines {
                    if s.sunk || s.id == weapon.owner_id || s.allegiance == weapon.owner_allegiance {
                        continue;
                    }
                    let (_, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, s.lat, s.lon);
                    if rng <= 0.12 {
                        weapon.exploded = true;
                        s.hull_integrity_pct = (s.hull_integrity_pct - 45.0).max(0.0);
                        if s.hull_integrity_pct <= 0.0 {
                            s.sunk = true;
                        }
                        self.event_seq += 1;
                        self.pending_events.push(WorldEventPayload {
                            event_id: self.event_seq,
                            server_tick: self.tick,
                            category: "ALERT".to_string(),
                            message: format!(
                                "HULL IMPACT! {} struck {} (Hull {:.0}%)!",
                                weapon.id, s.name, s.hull_integrity_pct
                            ),
                        });
                        break;
                    }
                }
            }
        }
        self.weapons.retain(|w| !w.exploded);
    }

    pub fn next_event_id(&mut self) -> u64 {
        self.event_seq += 1;
        self.event_seq
    }

    pub fn trigger_active_ping(&mut self, pinger_id: &str) -> usize {
        let Some((plat, plon)) = self
            .get_submarine_mut(pinger_id)
            .map(|s| {
                s.active_ping_cooldown_sec = 8.0;
                (s.lat, s.lon)
            })
        else {
            return 0;
        };

        if pinger_id == "SSN-774" {
            self.last_ping_alert_sec = self.sim_time_sec;
        }

        let mut echo_count = 0usize;
        for c in &mut self.contacts {
            if c.sunk {
                continue;
            }
            let (_, rng) = bearing_and_range_nm(plat, plon, c.lat, c.lon);
            if rng <= 18.0 {
                c.active_range_lock_sec = 15.0;
                echo_count += 1;
            }
        }
        for s in &mut self.submarines {
            if s.sunk || s.id == pinger_id {
                continue;
            }
            let (_, rng) = bearing_and_range_nm(plat, plon, s.lat, s.lon);
            if rng <= 18.0 {
                s.active_range_lock_sec = 15.0;
                echo_count += 1;
            }
        }
        echo_count
    }

    pub fn launch_torpedo(&mut self, shooter_id: &str, bearing_deg: f64) -> Option<String> {
        let (lat, lon, depth_m, allegiance) = {
            let sub = self.get_submarine_mut(shooter_id)?;
            if sub.torpedoes_remaining == 0 || sub.sunk {
                return None;
            }
            sub.torpedoes_remaining -= 1;
            (sub.lat, sub.lon, sub.depth_m, sub.allegiance.clone())
        };
        self.weapon_seq += 1;
        let id = format!("MK48-{:02}", self.weapon_seq);
        self.weapons.push(AuthoritativeTorpedo {
            id: id.clone(),
            owner_id: shooter_id.to_string(),
            owner_allegiance: allegiance,
            lat,
            lon,
            heading_deg: normalize_heading(bearing_deg),
            speed_kts: 45.0,
            depth_m,
            remaining_life_sec: 480.0,
            exploded: false,
        });
        Some(id)
    }

    pub fn deploy_decoy(&mut self, vessel_id: &str) -> Option<String> {
        let (lat, lon, depth_m) = {
            let sub = self.get_submarine_mut(vessel_id)?;
            if sub.decoys_remaining == 0 || sub.sunk {
                return None;
            }
            sub.decoys_remaining -= 1;
            (sub.lat, sub.lon, sub.depth_m)
        };
        self.decoy_seq += 1;
        let id = format!("ADC-{:02}", self.decoy_seq);
        self.decoys.push(AuthoritativeDecoy {
            id: id.clone(),
            lat,
            lon,
            depth_m,
            ttl_sec: 75.0,
        });
        Some(id)
    }

    /// Builds a per-player fog-of-war snapshot for `viewer_vessel_id` (e.g. `SSN-774` or `OPFOR-SUB`).
    pub fn to_client_snapshot_for(
        &self,
        viewer_vessel_id: &str,
        snapshot_seq: u64,
    ) -> ClientWorldSnapshot {
        let viewer = self
            .get_submarine(viewer_vessel_id)
            .unwrap_or(&self.submarines[0]);

        let mut visible_contacts: Vec<ClientContactView> = self
            .contacts
            .iter()
            .filter(|c| !c.sunk)
            .filter_map(|c| {
                let (bearing_deg, range_nm, snr_db) = compute_passive_snr_generic(
                    viewer,
                    c.lat,
                    c.lon,
                    c.depth_m,
                    c.radiated_noise_db(),
                    self.environment.thermocline_m,
                );
                let ranged = c.active_range_lock_sec > 0.0;
                if !ranged && snr_db < 0.0 {
                    return None;
                }
                let tma_q = if ranged {
                    98.0
                } else {
                    *self
                        .tma_quality
                        .get(&(viewer.id.clone(), c.id.clone()))
                        .unwrap_or(&10.0)
                };
                Some(ClientContactView {
                    id: c.id.clone(),
                    designation: if snr_db >= 6.0 || ranged {
                        c.designation.clone()
                    } else {
                        "UNCLASSIFIED CONTACT".to_string()
                    },
                    category: c.category.clone(),
                    allegiance: if ranged || snr_db >= 8.0 {
                        c.allegiance.clone()
                    } else {
                        "UNKNOWN".to_string()
                    },
                    bearing_deg,
                    snr_db: (snr_db * 10.0).round() / 10.0,
                    tma_quality_pct: tma_q.round(),
                    ranged,
                    lat: if ranged { Some(c.lat) } else { None },
                    lon: if ranged { Some(c.lon) } else { None },
                    range_nm: if ranged { Some(range_nm) } else { None },
                    heading_deg: if ranged { Some(c.heading_deg) } else { None },
                    speed_kts: if ranged { Some(c.speed_kts) } else { None },
                    depth_m: if ranged { Some(c.depth_m) } else { None },
                })
            })
            .collect();

        // Also evaluate other submarines (e.g. OPFOR-SUB for SSN-774, or SSN-774 for OPFOR-SUB)
        for other in &self.submarines {
            if other.sunk || other.id == viewer.id {
                continue;
            }
            let (bearing_deg, range_nm, snr_db) = compute_passive_snr_generic(
                viewer,
                other.lat,
                other.lon,
                other.depth_m,
                other.internal_noise_db,
                self.environment.thermocline_m,
            );
            let ranged = other.active_range_lock_sec > 0.0;
            if !ranged && snr_db < 0.0 {
                continue;
            }
            visible_contacts.push(ClientContactView {
                id: other.id.clone(),
                designation: if ranged || snr_db >= 6.0 {
                    other.name.clone()
                } else {
                    "SUBSURFACE CONTACT".to_string()
                },
                category: "SUBMARINE".to_string(),
                allegiance: other.allegiance.clone(),
                bearing_deg,
                snr_db: (snr_db * 10.0).round() / 10.0,
                tma_quality_pct: if ranged { 98.0 } else { 25.0 },
                ranged,
                lat: if ranged { Some(other.lat) } else { None },
                lon: if ranged { Some(other.lon) } else { None },
                range_nm: if ranged { Some(range_nm) } else { None },
                heading_deg: if ranged { Some(other.heading_deg) } else { None },
                speed_kts: if ranged { Some(other.speed_kts) } else { None },
                depth_m: if ranged { Some(other.depth_m) } else { None },
            });
        }

        let visible_weapons = self
            .weapons
            .iter()
            .filter(|w| !w.exploded)
            .map(|w| ClientWeaponView {
                id: w.id.clone(),
                weapon_type: "MK-48 ADCAP".to_string(),
                owner_id: w.owner_id.clone(),
                lat: w.lat,
                lon: w.lon,
                heading_deg: w.heading_deg,
                speed_kts: w.speed_kts,
                depth_m: w.depth_m,
            })
            .collect();

        let visible_decoys = self
            .decoys
            .iter()
            .map(|d| ClientDecoyView {
                id: d.id.clone(),
                lat: d.lat,
                lon: d.lon,
                depth_m: d.depth_m,
            })
            .collect();

        ClientWorldSnapshot {
            world_id: self.world_id.clone(),
            server_tick: self.tick,
            sim_time_sec: self.sim_time_sec,
            snapshot_seq,
            own_sub: ClientOwnSubView {
                id: viewer.id.clone(),
                name: viewer.name.clone(),
                lat: viewer.lat,
                lon: viewer.lon,
                heading_deg: viewer.heading_deg,
                ordered_heading_deg: viewer.ordered_heading_deg,
                speed_kts: viewer.speed_kts,
                ordered_speed_kts: viewer.ordered_speed_kts,
                depth_m: viewer.depth_m,
                ordered_depth_m: viewer.ordered_depth_m,
                hull_integrity_pct: viewer.hull_integrity_pct,
                torpedoes_remaining: viewer.torpedoes_remaining,
                decoys_remaining: viewer.decoys_remaining,
                towed_array_deployed: viewer.towed_array_deployed,
                active_ping_cooldown_sec: viewer.active_ping_cooldown_sec,
            },
            contacts: visible_contacts,
            weapons: visible_weapons,
            decoys: visible_decoys,
            environment: ClientEnvironmentView {
                sea_state: self.environment.sea_state,
                thermocline_m: self.environment.thermocline_m,
                water_depth_m: seafloor_depth_m(viewer.lat, viewer.lon),
                wind_speed_kts: self.environment.wind_speed_kts,
                wind_dir_deg: self.environment.wind_dir_deg,
            },
        }
    }

    pub fn to_client_snapshot(&self, snapshot_seq: u64) -> ClientWorldSnapshot {
        self.to_client_snapshot_for("SSN-774", snapshot_seq)
    }
}
