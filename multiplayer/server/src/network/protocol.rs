use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION_V1: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
pub struct IncomingEnvelope {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub version: u32,
    #[serde(default)]
    pub sequence: Option<u64>,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub client_name: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub room_id: Option<String>,
    #[serde(default)]
    pub vessel_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingPayload {
    pub client_time_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPayload {
    pub command: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "WELCOME")]
    Welcome {
        version: u32,
        payload: WelcomePayload,
    },
    #[serde(rename = "WORLD_SNAPSHOT")]
    WorldSnapshot {
        version: u32,
        payload: ClientWorldSnapshot,
    },
    #[serde(rename = "WORLD_EVENT")]
    WorldEvent {
        version: u32,
        payload: WorldEventPayload,
    },
    #[serde(rename = "PONG")]
    Pong {
        version: u32,
        payload: PongPayload,
    },
    #[serde(rename = "COMMAND_RESULT")]
    CommandResult {
        version: u32,
        sequence: u64,
        payload: CommandResultPayload,
    },
    #[serde(rename = "ERROR")]
    Error {
        version: u32,
        payload: ErrorPayload,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomePayload {
    pub session_id: String,
    pub world_id: String,
    pub assigned_role: String,
    pub vessel_id: String,
    pub sim_hz: u32,
    pub snapshot_hz: u32,
    pub reconnected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientWorldSnapshot {
    pub world_id: String,
    pub server_tick: u64,
    pub sim_time_sec: f64,
    pub snapshot_seq: u64,
    pub own_sub: ClientOwnSubView,
    pub contacts: Vec<ClientContactView>,
    pub weapons: Vec<ClientWeaponView>,
    pub decoys: Vec<ClientDecoyView>,
    pub environment: ClientEnvironmentView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOwnSubView {
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
    pub hull_integrity_pct: f64,
    pub torpedoes_remaining: u32,
    pub decoys_remaining: u32,
    pub towed_array_deployed: bool,
    pub active_ping_cooldown_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientContactView {
    pub id: String,
    pub designation: String,
    pub category: String,
    pub allegiance: String,
    pub bearing_deg: f64,
    pub snr_db: f64,
    pub tma_quality_pct: f64,
    pub ranged: bool,
    // Strictly None unless ranged by active sonar or high-confidence TMA
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub range_nm: Option<f64>,
    pub heading_deg: Option<f64>,
    pub speed_kts: Option<f64>,
    pub depth_m: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientWeaponView {
    pub id: String,
    pub weapon_type: String,
    pub owner_id: String,
    pub lat: f64,
    pub lon: f64,
    pub heading_deg: f64,
    pub speed_kts: f64,
    pub depth_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDecoyView {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub depth_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEnvironmentView {
    pub sea_state: u8,
    pub thermocline_m: f64,
    pub water_depth_m: f64,
    pub wind_speed_kts: f64,
    pub wind_dir_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldEventPayload {
    pub event_id: u64,
    pub server_tick: u64,
    pub category: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PongPayload {
    pub client_time_ms: f64,
    pub server_tick: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResultPayload {
    pub accepted: bool,
    pub command: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

impl ServerMessage {
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Error {
            version: PROTOCOL_VERSION_V1,
            payload: ErrorPayload {
                code: code.into(),
                message: message.into(),
            },
        }
    }
}
