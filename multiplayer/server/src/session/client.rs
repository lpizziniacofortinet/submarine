use std::collections::HashMap;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ClientSession {
    pub session_id: String,
    pub client_name: String,
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

    /// Registers a new session or resumes an existing one when `requested_session_id` matches.
    pub fn connect_or_resume(
        &mut self,
        client_name: String,
        requested_session_id: Option<String>,
    ) -> (ClientSession, bool) {
        let now = Instant::now();
        if let Some(req_id) = requested_session_id {
            if let Some(existing) = self.sessions.get_mut(&req_id) {
                existing.connected = true;
                existing.last_seen = now;
                if !client_name.trim().is_empty() {
                    existing.client_name = client_name;
                }
                return (existing.clone(), true);
            }
        }

        let session_id = Uuid::new_v4().to_string();
        let session = ClientSession {
            session_id: session_id.clone(),
            client_name: if client_name.trim().is_empty() {
                "anonymous-operator".to_string()
            } else {
                client_name
            },
            controlled_entity_id: "SSN-774".to_string(),
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

    /// Marks timed-out active sessions disconnected and prunes stale disconnected entries.
    pub fn prune_expired(&mut self, heartbeat_timeout: Duration) -> usize {
        let now = Instant::now();
        let mut timed_out = 0usize;
        for session in self.sessions.values_mut() {
            if session.connected && now.duration_since(session.last_seen) > heartbeat_timeout {
                session.connected = false;
                timed_out += 1;
            }
        }
        // Keep disconnected sessions around for 5 minutes to allow reconnection
        let reconnect_ttl = Duration::from_secs(300);
        self.sessions
            .retain(|_, s| s.connected || now.duration_since(s.last_seen) <= reconnect_ttl);
        timed_out
    }
}
