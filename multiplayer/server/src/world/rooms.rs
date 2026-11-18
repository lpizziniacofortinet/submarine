use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::config::ServerConfig;
use crate::world::simulation::{spawn_simulation_loops, SimulationRuntime};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub room_id: String,
    pub server_tick: u64,
    pub sim_time_sec: f64,
    pub active_sessions: usize,
}

pub struct RoomManager {
    config: ServerConfig,
    rooms: Mutex<HashMap<String, Arc<SimulationRuntime>>>,
}

impl RoomManager {
    pub fn new(config: ServerConfig) -> Arc<Self> {
        let default_room = SimulationRuntime::new(config.clone(), "med-patrol-alpha");
        spawn_simulation_loops(default_room.clone());

        let mut map = HashMap::new();
        map.insert("med-patrol-alpha".to_string(), default_room);

        Arc::new(Self {
            config,
            rooms: Mutex::new(map),
        })
    }

    pub async fn get_or_create_room(&self, room_id: Option<&str>) -> Arc<SimulationRuntime> {
        let normalized = room_id
            .map(|r| r.trim())
            .filter(|r| !r.is_empty())
            .unwrap_or("med-patrol-alpha")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(40)
            .collect::<String>();
        let key = if normalized.is_empty() {
            "med-patrol-alpha".to_string()
        } else {
            normalized
        };

        let mut guard = self.rooms.lock().await;
        if let Some(existing) = guard.get(&key) {
            return existing.clone();
        }
        let runtime = SimulationRuntime::new(self.config.clone(), &key);
        spawn_simulation_loops(runtime.clone());
        guard.insert(key, runtime.clone());
        runtime
    }

    pub async fn default_room(&self) -> Arc<SimulationRuntime> {
        self.get_or_create_room(Some("med-patrol-alpha")).await
    }

    pub async fn list_rooms(&self) -> Vec<RoomSummary> {
        let runtimes: Vec<(String, Arc<SimulationRuntime>)> = {
            let guard = self.rooms.lock().await;
            guard.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        };
        let mut out = Vec::with_capacity(runtimes.len());
        for (room_id, rt) in runtimes {
            let (server_tick, sim_time_sec) = {
                let w = rt.world.lock().await;
                (w.tick, w.sim_time_sec)
            };
            let active_sessions = rt.sessions.lock().await.active_count();
            out.push(RoomSummary {
                room_id,
                server_tick,
                sim_time_sec,
                active_sessions,
            });
        }
        out.sort_by(|a, b| a.room_id.cmp(&b.room_id));
        out
    }
}
