/// Authoritative player submarine entity.
/// Contains internal/private simulation fields that must never be serialized to clients.
#[derive(Debug, Clone)]
pub struct AuthoritativeSubmarine {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub heading_deg: f64,
    pub ordered_heading_deg: f64,
    pub speed_kts: f64,
    pub ordered_speed_kts: f64,
    pub depth_m: f64,
    pub ordered_depth_m: f64,
    pub max_speed_kts: f64,
    pub max_depth_m: f64,
    pub torpedoes_remaining: u32,
    pub active_ping_cooldown_sec: f64,
    pub towed_array_deployed: bool,
    // Private authoritative fields (never exposed in snapshots)
    pub internal_reactor_power_mw: f64,
    pub internal_noise_db: f64,
}

impl AuthoritativeSubmarine {
    pub fn step(&mut self, dt_sec: f64) {
        if self.active_ping_cooldown_sec > 0.0 {
            self.active_ping_cooldown_sec = (self.active_ping_cooldown_sec - dt_sec).max(0.0);
        }

        // Turn toward ordered heading (up to 3.0 deg/sec)
        let diff = shortest_angle_diff(self.heading_deg, self.ordered_heading_deg);
        let max_turn = 3.0 * dt_sec;
        if diff.abs() <= max_turn {
            self.heading_deg = normalize_heading(self.ordered_heading_deg);
        } else {
            self.heading_deg = normalize_heading(self.heading_deg + diff.signum() * max_turn);
        }

        // Accelerate/decelerate toward ordered speed (up to 0.8 kts/sec)
        let speed_diff = self.ordered_speed_kts - self.speed_kts;
        let max_accel = 0.8 * dt_sec;
        if speed_diff.abs() <= max_accel {
            self.speed_kts = self.ordered_speed_kts;
        } else {
            self.speed_kts += speed_diff.signum() * max_accel;
        }

        // Dive/ascend toward ordered depth (up to 2.2 m/sec)
        let depth_diff = self.ordered_depth_m - self.depth_m;
        let max_dive = 2.2 * dt_sec;
        if depth_diff.abs() <= max_dive {
            self.depth_m = self.ordered_depth_m;
        } else {
            self.depth_m += depth_diff.signum() * max_dive;
        }

        let (new_lat, new_lon) =
            advance_position(self.lat, self.lon, self.heading_deg, self.speed_kts, dt_sec);
        self.lat = new_lat;
        self.lon = new_lon;

        // Internal-only acoustic/reactor telemetry
        self.internal_reactor_power_mw = 12.0 + self.speed_kts.abs() * 4.5;
        let cavitation_penalty = if self.speed_kts.abs() > 16.0 && self.depth_m < 80.0 {
            14.0
        } else {
            0.0
        };
        self.internal_noise_db = 92.0 + self.speed_kts.abs() * 1.4 + cavitation_penalty;
    }
}

/// Authoritative contact entity.
/// Hidden contacts and internal AI/weapon fields must never be leaked to clients.
#[derive(Debug, Clone)]
pub struct AuthoritativeContact {
    pub id: String,
    pub designation: String,
    pub category: String,
    pub allegiance: String,
    pub lat: f64,
    pub lon: f64,
    pub heading_deg: f64,
    pub speed_kts: f64,
    pub depth_m: f64,
    pub base_radiated_noise_db: f64,
    pub active_range_lock_sec: f64,
    pub sunk: bool,
    // Private authoritative fields (never exposed in snapshots)
    pub internal_ai_state: String,
    pub internal_weapon_load: u32,
}

impl AuthoritativeContact {
    pub fn step(&mut self, dt_sec: f64) {
        if self.sunk {
            return;
        }
        if self.active_range_lock_sec > 0.0 {
            self.active_range_lock_sec = (self.active_range_lock_sec - dt_sec).max(0.0);
        }
        let (new_lat, new_lon) =
            advance_position(self.lat, self.lon, self.heading_deg, self.speed_kts, dt_sec);
        self.lat = new_lat;
        self.lon = new_lon;
    }

    pub fn radiated_noise_db(&self) -> f64 {
        self.base_radiated_noise_db + self.speed_kts.abs() * 1.15
    }
}

/// Authoritative torpedo entity (MK-48 ADCAP).
#[derive(Debug, Clone)]
pub struct AuthoritativeTorpedo {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub heading_deg: f64,
    pub speed_kts: f64,
    pub depth_m: f64,
    pub remaining_life_sec: f64,
    pub exploded: bool,
}

impl AuthoritativeTorpedo {
    pub fn step(&mut self, dt_sec: f64) {
        if self.exploded {
            return;
        }
        self.remaining_life_sec -= dt_sec;
        if self.remaining_life_sec <= 0.0 {
            self.exploded = true;
            return;
        }
        let (new_lat, new_lon) =
            advance_position(self.lat, self.lon, self.heading_deg, self.speed_kts, dt_sec);
        self.lat = new_lat;
        self.lon = new_lon;
    }
}

#[derive(Debug, Clone)]
pub struct EnvironmentState {
    pub sea_state: u8,
    pub thermocline_m: f64,
    pub water_depth_m: f64,
    pub wind_speed_kts: f64,
    pub wind_dir_deg: f64,
}

/// Computes passive sonar signal-to-noise ratio (dB) on the authoritative server.
/// Contacts with SNR < 0 dB are undetectable and must not appear in client snapshots.
pub fn compute_passive_sonar_snr(
    sub: &AuthoritativeSubmarine,
    contact: &AuthoritativeContact,
    thermocline_m: f64,
) -> (f64, f64, f64) {
    let (bearing_deg, range_nm) =
        bearing_and_range_nm(sub.lat, sub.lon, contact.lat, contact.lon);
    let range_m = (range_nm * 1852.0).max(50.0);
    let spreading_loss_db = 20.0 * range_m.log10();
    let absorption_db = 0.25 * range_nm;

    let same_side_of_layer =
        (sub.depth_m <= thermocline_m && contact.depth_m <= thermocline_m)
            || (sub.depth_m > thermocline_m && contact.depth_m > thermocline_m);
    let layer_loss_db = if same_side_of_layer { 0.0 } else { 9.0 };

    let rel_brg = normalize_heading(bearing_deg - sub.heading_deg);
    let in_baffles = !sub.towed_array_deployed && (150.0..=210.0).contains(&rel_brg);
    let baffle_loss_db = if in_baffles { 18.0 } else { 0.0 };

    let self_noise_db = 54.0 + (sub.internal_noise_db - 92.0) * 0.45;
    let snr_db = contact.radiated_noise_db()
        - spreading_loss_db
        - absorption_db
        - layer_loss_db
        - baffle_loss_db
        - (self_noise_db - 45.0);

    (bearing_deg, range_nm, snr_db)
}

pub fn normalize_heading(deg: f64) -> f64 {
    let mut h = deg % 360.0;
    if h < 0.0 {
        h += 360.0;
    }
    h
}

pub fn shortest_angle_diff(from_deg: f64, to_deg: f64) -> f64 {
    let mut d = (to_deg - from_deg) % 360.0;
    if d > 180.0 {
        d -= 360.0;
    } else if d < -180.0 {
        d += 360.0;
    }
    d
}

pub fn advance_position(
    lat: f64,
    lon: f64,
    heading_deg: f64,
    speed_kts: f64,
    dt_sec: f64,
) -> (f64, f64) {
    let dist_nm = speed_kts * (dt_sec / 3600.0);
    let rad = heading_deg.to_radians();
    let d_lat = (dist_nm * rad.cos()) / 60.0;
    let cos_lat = lat.to_radians().cos().abs().max(0.15);
    let d_lon = (dist_nm * rad.sin()) / (60.0 * cos_lat);
    (lat + d_lat, lon + d_lon)
}

pub fn bearing_and_range_nm(from_lat: f64, from_lon: f64, to_lat: f64, to_lon: f64) -> (f64, f64) {
    let d_lat_nm = (to_lat - from_lat) * 60.0;
    let avg_lat_rad = ((from_lat + to_lat) * 0.5).to_radians();
    let d_lon_nm = (to_lon - from_lon) * 60.0 * avg_lat_rad.cos();
    let range_nm = d_lat_nm.hypot(d_lon_nm);
    let brg = normalize_heading(d_lon_nm.atan2(d_lat_nm).to_degrees());
    (brg, range_nm)
}
