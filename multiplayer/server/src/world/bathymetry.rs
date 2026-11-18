use crate::world::entity::bearing_and_range_nm;

/// Deterministic Mediterranean bathymetry & coastline model for authoritative server checks.
/// Provides seafloor depth (0 = land/island), seabed collision, and torpedo land-impact checks.
pub fn seafloor_depth_m(lat: f64, lon: f64) -> f64 {
    // Major Mediterranean landmasses & islands: (lat, lon, radius_nm, peak_m)
    const LANDMASSES: &[(f64, f64, f64, f64)] = &[
        (37.58, 14.15, 42.0, 1200.0), // Sicily
        (37.75, 15.00, 18.0, 2800.0), // Mt. Etna / East Sicily
        (38.15, 15.85, 22.0, 950.0),  // Calabria
        (40.15, 18.15, 24.0, 250.0),  // Salento
        (40.05, 9.05, 52.0, 1100.0),  // Sardinia
        (42.15, 9.15, 34.0, 1400.0),  // Corsica
        (35.90, 14.42, 9.5, 180.0),   // Malta & Gozo
        (36.78, 11.98, 6.5, 420.0),   // Pantelleria
        (35.30, 24.00, 26.0, 1500.0), // Crete West
        (35.20, 25.35, 32.0, 1400.0), // Crete East
    ];

    // Deep Ionian / Tyrrhenian baseline
    let mut elev_m = -2250.0
        + (lat * 7.0).sin() * 140.0
        + (lon * 9.0).cos() * 120.0;

    for &(f_lat, f_lon, radius_nm, peak_m) in LANDMASSES {
        let (_, dist_nm) = bearing_and_range_nm(lat, lon, f_lat, f_lon);
        if dist_nm < radius_nm * 1.4 {
            let norm = dist_nm / radius_nm;
            let influence = (-norm * norm * 1.8).exp();
            elev_m += (peak_m + 2250.0) * influence;
        }
    }

    if elev_m >= -1.0 {
        0.0
    } else {
        (-elev_m).max(12.0).round()
    }
}

pub fn elevation_m(lat: f64, lon: f64) -> f64 {
    let d = seafloor_depth_m(lat, lon);
    if d <= 0.0 {
        15.0
    } else {
        -d
    }
}
