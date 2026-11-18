use std::env;
use std::path::PathBuf;

/// Runtime configuration for the authoritative SSN-774 server.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub sim_hz: u32,
    pub snapshot_hz: u32,
    pub heartbeat_timeout_sec: u64,
    pub static_dir: PathBuf,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 9000,
            sim_hz: 30,
            snapshot_hz: 10,
            heartbeat_timeout_sec: 15,
            static_dir: PathBuf::from("client"),
        }
    }
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(v) = env::var("SSN_HOST") {
            if !v.trim().is_empty() {
                cfg.host = v;
            }
        }
        if let Ok(v) = env::var("SSN_PORT") {
            if let Ok(p) = v.parse::<u16>() {
                cfg.port = p;
            }
        }
        if let Ok(v) = env::var("SSN_SIM_HZ") {
            if let Ok(hz) = v.parse::<u32>() {
                cfg.sim_hz = hz.clamp(10, 60);
            }
        }
        if let Ok(v) = env::var("SSN_SNAPSHOT_HZ") {
            if let Ok(hz) = v.parse::<u32>() {
                cfg.snapshot_hz = hz.clamp(1, 30);
            }
        }
        if let Ok(v) = env::var("SSN_HEARTBEAT_TIMEOUT_SEC") {
            if let Ok(s) = v.parse::<u64>() {
                cfg.heartbeat_timeout_sec = s.clamp(5, 120);
            }
        }
        if let Ok(v) = env::var("SSN_STATIC_DIR") {
            if !v.trim().is_empty() {
                cfg.static_dir = PathBuf::from(v);
            }
        } else if !cfg.static_dir.exists() {
            let fallback = PathBuf::from("../client");
            if fallback.exists() {
                cfg.static_dir = fallback;
            }
        }
        cfg
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
