use crate::network::protocol::{
    ClientContactView, ClientEnvironmentView, ClientOwnSubView, ClientWeaponView,
    ClientWorldSnapshot, WorldEventPayload,
};
use crate::world::entity::{
    bearing_and_range_nm, compute_passive_sonar_snr, shortest_angle_diff, normalize_heading,
    AuthoritativeContact, AuthoritativeSubmarine, AuthoritativeTorpedo, EnvironmentState,
};

#[derive(Debug, Clone)]
pub struct AuthoritativeWorld {
    pub world_id: String,
    pub tick: u64,
    pub sim_time_sec: f64,
    pub paused: bool,
    pub own_sub: AuthoritativeSubmarine,
    pub contacts: Vec<AuthoritativeContact>,
    pub weapons: Vec<AuthoritativeTorpedo>,
    pub environment: EnvironmentState,
    pub event_seq: u64,
    pub weapon_seq: u64,
    pub pending_events: Vec<WorldEventPayload>,
}

impl AuthoritativeWorld {
    pub fn new_mediterranean_patrol() -> Self {
        Self {
            world_id: "med-patrol-alpha".to_string(),
            tick: 0,
            sim_time_sec: 0.0,
            paused: false,
            own_sub: AuthoritativeSubmarine {
                id: "SSN-774".to_string(),
                name: "USS Virginia (SSN-774)".to_string(),
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
                torpedoes_remaining: 16,
                active_ping_cooldown_sec: 0.0,
                towed_array_deployed: true,
                internal_reactor_power_mw: 57.0,
                internal_noise_db: 106.0,
            },
            contacts: vec![
                AuthoritativeContact {
                    id: "TRK-01".to_string(),
                    designation: "M/V AEGEAN TRADER".to_string(),
                    category: "MERCHANT".to_string(),
                    allegiance: "NEUTRAL".to_string(),
                    lat: 37.2400,
                    lon: 15.5800,
                    heading_deg: 215.0,
                    speed_kts: 13.0,
                    depth_m: 0.0,
                    base_radiated_noise_db: 132.0,
                    active_range_lock_sec: 0.0,
                    sunk: false,
                    internal_ai_state: "TRANSIT".to_string(),
                    internal_weapon_load: 0,
                },
                AuthoritativeContact {
                    id: "TRK-02".to_string(),
                    designation: "FFG ADMIRAL GORSHKOV".to_string(),
                    category: "WARSHIP".to_string(),
                    allegiance: "HOSTILE".to_string(),
                    lat: 37.1100,
                    lon: 15.6100,
                    heading_deg: 310.0,
                    speed_kts: 16.0,
                    depth_m: 0.0,
                    base_radiated_noise_db: 128.0,
                    active_range_lock_sec: 0.0,
                    sunk: false,
                    internal_ai_state: "PATROL_SCREEN".to_string(),
                    internal_weapon_load: 8,
                },
                // Ultra-quiet submerged hostile submarine below the thermocline.
                // Passive SNR < 0 dB at initial range, so completely invisible until active ping or close approach.
                AuthoritativeContact {
                    id: "TRK-99".to_string(),
                    designation: "K-561 KAZAN (YASEN-M)".to_string(),
                    category: "SUBMARINE".to_string(),
                    allegiance: "HOSTILE".to_string(),
                    lat: 37.2150,
                    lon: 15.4200,
                    heading_deg: 135.0,
                    speed_kts: 4.0,
                    depth_m: 160.0,
                    base_radiated_noise_db: 95.0,
                    active_range_lock_sec: 0.0,
                    sunk: false,
                    internal_ai_state: "COVERT_AMBUSH".to_string(),
                    internal_weapon_load: 12,
                },
            ],
            weapons: Vec::new(),
            environment: EnvironmentState {
                sea_state: 2,
                thermocline_m: 85.0,
                water_depth_m: 2305.0,
                wind_speed_kts: 9.0,
                wind_dir_deg: 135.0,
            },
            event_seq: 0,
            weapon_seq: 0,
            pending_events: Vec::new(),
        }
    }

    pub fn step(&mut self, dt_sec: f64) {
        if self.paused {
            return;
        }
        self.tick += 1;
        self.sim_time_sec += dt_sec;
        self.own_sub.step(dt_sec);
        for contact in &mut self.contacts {
            contact.step(dt_sec);
        }

        // Step active torpedoes and evaluate homing + warhead detonation
        for weapon in &mut self.weapons {
            if weapon.exploded {
                continue;
            }
            // Seeker acquisition on nearest unsunk contact within 2.5 NM & +-50°
            let mut best_target: Option<(usize, f64, f64)> = None;
            for (idx, c) in self.contacts.iter().enumerate() {
                if c.sunk {
                    continue;
                }
                let (brg, rng) = bearing_and_range_nm(weapon.lat, weapon.lon, c.lat, c.lon);
                let off_bow = shortest_angle_diff(weapon.heading_deg, brg).abs();
                if rng <= 2.5 && off_bow <= 50.0 {
                    if best_target.map_or(true, |(_, _, best_rng)| rng < best_rng) {
                        best_target = Some((idx, brg, rng));
                    }
                }
            }

            if let Some((_, tgt_brg, _)) = best_target {
                let turn = shortest_angle_diff(weapon.heading_deg, tgt_brg);
                let max_turn = 14.0 * dt_sec;
                weapon.heading_deg = if turn.abs() <= max_turn {
                    tgt_brg
                } else {
                    normalize_heading(weapon.heading_deg + turn.signum() * max_turn)
                };
            }

            weapon.step(dt_sec);

            if !weapon.exploded {
                for c in &mut self.contacts {
                    if c.sunk {
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
        }
        self.weapons.retain(|w| !w.exploded);
    }

    pub fn next_event_id(&mut self) -> u64 {
        self.event_seq += 1;
        self.event_seq
    }

    pub fn trigger_active_ping(&mut self) -> usize {
        self.own_sub.active_ping_cooldown_sec = 8.0;
        let mut echo_count = 0usize;
        for c in &mut self.contacts {
            if c.sunk {
                continue;
            }
            let (_, rng) =
                bearing_and_range_nm(self.own_sub.lat, self.own_sub.lon, c.lat, c.lon);
            if rng <= 18.0 {
                c.active_range_lock_sec = 15.0;
                echo_count += 1;
            }
        }
        echo_count
    }

    pub fn launch_torpedo(&mut self, bearing_deg: f64) -> String {
        self.own_sub.torpedoes_remaining = self.own_sub.torpedoes_remaining.saturating_sub(1);
        self.weapon_seq += 1;
        let id = format!("MK48-{:02}", self.weapon_seq);
        self.weapons.push(AuthoritativeTorpedo {
            id: id.clone(),
            lat: self.own_sub.lat,
            lon: self.own_sub.lon,
            heading_deg: normalize_heading(bearing_deg),
            speed_kts: 45.0,
            depth_m: self.own_sub.depth_m,
            remaining_life_sec: 480.0,
            exploded: false,
        });
        id
    }

    /// Builds a client-safe DTO snapshot with true acoustic fog-of-war:
    /// - Undetected contacts (passive SNR < 0 dB and no active lock) are omitted.
    /// - Passive-only contacts expose bearing & SNR only (lat/lon/rangeNm are None).
    /// - Private authoritative variables are never included.
    pub fn to_client_snapshot(&self, snapshot_seq: u64) -> ClientWorldSnapshot {
        let visible_contacts = self
            .contacts
            .iter()
            .filter(|c| !c.sunk)
            .filter_map(|c| {
                let (bearing_deg, range_nm, snr_db) = compute_passive_sonar_snr(
                    &self.own_sub,
                    c,
                    self.environment.thermocline_m,
                );
                let ranged = c.active_range_lock_sec > 0.0;
                if !ranged && snr_db < 0.0 {
                    return None;
                }

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

        let visible_weapons = self
            .weapons
            .iter()
            .filter(|w| !w.exploded)
            .map(|w| ClientWeaponView {
                id: w.id.clone(),
                weapon_type: "MK-48 ADCAP".to_string(),
                lat: w.lat,
                lon: w.lon,
                heading_deg: w.heading_deg,
                speed_kts: w.speed_kts,
                depth_m: w.depth_m,
            })
            .collect();

        ClientWorldSnapshot {
            world_id: self.world_id.clone(),
            server_tick: self.tick,
            sim_time_sec: self.sim_time_sec,
            snapshot_seq,
            own_sub: ClientOwnSubView {
                id: self.own_sub.id.clone(),
                name: self.own_sub.name.clone(),
                lat: self.own_sub.lat,
                lon: self.own_sub.lon,
                heading_deg: self.own_sub.heading_deg,
                ordered_heading_deg: self.own_sub.ordered_heading_deg,
                speed_kts: self.own_sub.speed_kts,
                ordered_speed_kts: self.own_sub.ordered_speed_kts,
                depth_m: self.own_sub.depth_m,
                ordered_depth_m: self.own_sub.ordered_depth_m,
                torpedoes_remaining: self.own_sub.torpedoes_remaining,
                active_ping_cooldown_sec: self.own_sub.active_ping_cooldown_sec,
            },
            contacts: visible_contacts,
            weapons: visible_weapons,
            environment: ClientEnvironmentView {
                sea_state: self.environment.sea_state,
                thermocline_m: self.environment.thermocline_m,
                water_depth_m: self.environment.water_depth_m,
                wind_speed_kts: self.environment.wind_speed_kts,
                wind_dir_deg: self.environment.wind_dir_deg,
            },
        }
    }
}
