use std::collections::HashMap;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchRole {
    Commander,
    Conn,
    Sonar,
    Weps,
}

impl WatchRole {
    pub fn from_str_or_default(raw: Option<&str>) -> Self {
        match raw.unwrap_or("COMMANDER").trim().to_ascii_uppercase().as_str() {
            "CONN" => Self::Conn,
            "SONAR" => Self::Sonar,
            "WEPS" => Self::Weps,
            _ => Self::Commander,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Commander => "COMMANDER",
            Self::Conn => "CONN",
            Self::Sonar => "SONAR",
            Self::Weps => "WEPS",
        }
    }

    pub fn can_helm(&self) -> bool {
        matches!(self, Self::Commander | Self::Conn)
    }

    pub fn can_sonar(&self) -> bool {
        matches!(self, Self::Commander | Self::Sonar)
    }

    pub fn can_weapons(&self) -> bool {
        matches!(self, Self::Commander | Self::Weps)
    }
}

#[derive(Debug, Clone)]
pub struct ClientSession {
    pub session_id: String,
    pub client_name: String,
    pub role: WatchRole,
    pub room_id: String,
    pub controlled_entity_id: String,
    pub can_command_own_sub: bool,
    pub connected: bool,
    pub last_seen: Instant,
}

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: HashMap<String, ClientSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn normalize_vessel_id(raw: Option<&str>) -> String {
        match raw.unwrap_or("SSN-774").trim().to_ascii_uppercase().as_str() {
            "OPFOR-SUB" => "OPFOR-SUB".to_string(),
            _ => "SSN-774".to_string(),
        }
    }

    /// Registers a new session or resumes an existing one when `requested_session_id` matches.
    pub fn connect_or_resume(
        &mut self,
        client_name: String,
        requested_session_id: Option<String>,
        requested_role: Option<String>,
        room_id: String,
        requested_vessel_id: Option<String>,
    ) -> (ClientSession, bool) {
        let now = Instant::now();
        if let Some(req_id) = requested_session_id {
            if let Some(existing) = self.sessions.get_mut(&req_id) {
                existing.connected = true;
                existing.last_seen = now;
                if !client_name.trim().is_empty() {
                    existing.client_name = client_name;
                }
                if requested_role.is_some() {
                    existing.role = WatchRole::from_str_or_default(requested_role.as_deref());
                }
                return (existing.clone(), true);
            }
        }

        let session_id = Uuid::new_v4().to_string();
        let role = WatchRole::from_str_or_default(requested_role.as_deref());
        let vessel_id = Self::normalize_vessel_id(requested_vessel_id.as_deref());
        let session = ClientSession {
            session_id: session_id.clone(),
            client_name: if client_name.trim().is_empty() {
                "anonymous-operator".to_string()
            } else {
                client_name
            },
            role,
            room_id,
            controlled_entity_id: vessel_id,
            can_command_own_sub: true,
            connected: true,
            last_seen: now,
        };
        self.sessions.insert(session_id, session.clone());
        (session, false)
    }

    pub fn touch(&mut self, session_id: &str) {
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.last_seen = Instant::now();
        }
    }

    pub fn disconnect(&mut self, session_id: &str) {
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.connected = false;
            s.last_seen = Instant::now();
        }
    }

    pub fn get(&self, session_id: &str) -> Option<&ClientSession> {
        self.sessions.get(session_id)
    }

    pub fn active_count(&self) -> usize {
        self.sessions.values().filter(|s| s.connected).count()
    }

    pub fn total_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn prune_expired(&mut self, heartbeat_timeout: Duration) -> usize {
        let now = Instant::now();
        let mut timed_out = 0usize;
        for session in self.sessions.values_mut() {
            if session.connected && now.duration_since(session.last_seen) > heartbeat_timeout {
                session.connected = false;
                timed_out += 1;
            }
        }
        let reconnect_ttl = Duration::from_secs(300);
        self.sessions
            .retain(|_, s| s.connected || now.duration_since(s.last_seen) <= reconnect_ttl);
        timed_out
    }
}
