use crate::network::protocol::{
    ClientContactView, ClientEnvironmentView, ClientOwnSubView, ClientWorldSnapshot,
};
use crate::world::entity::{
    bearing_and_range_nm, AuthoritativeContact, AuthoritativeSubmarine, EnvironmentState,
};

#[derive(Debug, Clone)]
pub struct AuthoritativeWorld {
    pub world_id: String,
    pub tick: u64,
    pub sim_time_sec: f64,
    pub paused: bool,
    pub own_sub: AuthoritativeSubmarine,
    pub contacts: Vec<AuthoritativeContact>,
    pub environment: EnvironmentState,
    pub event_seq: u64,
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
                    detectable_by_client: true,
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
                    detectable_by_client: true,
                    internal_ai_state: "PATROL_SCREEN".to_string(),
                    internal_weapon_load: 8,
                },
                // Hidden stealth submarine in the authoritative world.
                // Must NEVER appear in ClientWorldSnapshot while detectable_by_client == false.
                AuthoritativeContact {
                    id: "TRK-99".to_string(),
                    designation: "K-561 KAZAN (YASEN-M)".to_string(),
                    category: "SUBMARINE".to_string(),
                    allegiance: "HOSTILE".to_string(),
                    lat: 37.2150,
                    lon: 15.4200,
                    heading_deg: 135.0,
                    speed_kts: 6.0,
                    depth_m: 160.0,
                    detectable_by_client: false,
                    internal_ai_state: "COVERT_AMBUSH".to_string(),
                    internal_weapon_load: 12,
                },
            ],
            environment: EnvironmentState {
                sea_state: 2,
                thermocline_m: 85.0,
                water_depth_m: 2305.0,
                wind_speed_kts: 9.0,
                wind_dir_deg: 135.0,
            },
            event_seq: 0,
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
    }

    pub fn next_event_id(&mut self) -> u64 {
        self.event_seq += 1;
        self.event_seq
    }

    /// Builds a client-safe DTO snapshot.
    /// Hidden contacts and private authoritative variables are strictly excluded.
    pub fn to_client_snapshot(&self, snapshot_seq: u64) -> ClientWorldSnapshot {
        let visible_contacts = self
            .contacts
            .iter()
            .filter(|c| c.detectable_by_client)
            .map(|c| {
                let (bearing_deg, range_nm) =
                    bearing_and_range_nm(self.own_sub.lat, self.own_sub.lon, c.lat, c.lon);
                ClientContactView {
                    id: c.id.clone(),
                    designation: c.designation.clone(),
                    category: c.category.clone(),
                    allegiance: c.allegiance.clone(),
                    lat: c.lat,
                    lon: c.lon,
                    bearing_deg,
                    range_nm,
                    heading_deg: c.heading_deg,
                    speed_kts: c.speed_kts,
                    depth_m: c.depth_m,
                }
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
            },
            contacts: visible_contacts,
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
