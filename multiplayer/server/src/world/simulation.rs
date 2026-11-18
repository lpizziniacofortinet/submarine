use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, watch, Mutex};
use tracing::{debug, info};

use crate::config::ServerConfig;
use crate::network::protocol::{ClientWorldSnapshot, WorldEventPayload};
use crate::session::client::SessionManager;
use crate::world::state::AuthoritativeWorld;

/// Shared authoritative runtime state for a single match room.
pub struct SimulationRuntime {
    pub config: ServerConfig,
    pub world: Mutex<AuthoritativeWorld>,
    pub sessions: Mutex<SessionManager>,
    pub snapshot_tx_ssn774: watch::Sender<Arc<ClientWorldSnapshot>>,
    pub snapshot_tx_opfor: watch::Sender<Arc<ClientWorldSnapshot>>,
    pub event_tx: broadcast::Sender<WorldEventPayload>,
    pub snapshot_seq: AtomicU64,
}

impl SimulationRuntime {
    pub fn new(config: ServerConfig, world_id: impl Into<String>) -> Arc<Self> {
        let world = AuthoritativeWorld::new_mediterranean_patrol(world_id);
        let init_ssn = Arc::new(world.to_client_snapshot_for("SSN-774", 0));
        let init_opfor = Arc::new(world.to_client_snapshot_for("OPFOR-SUB", 0));
        let (snapshot_tx_ssn774, _) = watch::channel(init_ssn);
        let (snapshot_tx_opfor, _) = watch::channel(init_opfor);
        let (event_tx, _) = broadcast::channel(128);

        Arc::new(Self {
            config,
            world: Mutex::new(world),
            sessions: Mutex::new(SessionManager::new()),
            snapshot_tx_ssn774,
            snapshot_tx_opfor,
            event_tx,
            snapshot_seq: AtomicU64::new(0),
        })
    }

    pub fn subscribe_snapshots(&self, vessel_id: &str) -> watch::Receiver<Arc<ClientWorldSnapshot>> {
        if vessel_id == "OPFOR-SUB" {
            self.snapshot_tx_opfor.subscribe()
        } else {
            self.snapshot_tx_ssn774.subscribe()
        }
    }

    pub async fn publish_latest_snapshots(&self) -> (Arc<ClientWorldSnapshot>, Arc<ClientWorldSnapshot>) {
        let seq = self.snapshot_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let (snap_ssn, snap_opfor) = {
            let guard = self.world.lock().await;
            (
                Arc::new(guard.to_client_snapshot_for("SSN-774", seq)),
                Arc::new(guard.to_client_snapshot_for("OPFOR-SUB", seq)),
            )
        };
        let _ = self.snapshot_tx_ssn774.send(snap_ssn.clone());
        let _ = self.snapshot_tx_opfor.send(snap_opfor.clone());
        (snap_ssn, snap_opfor)
    }

    pub async fn snapshot_for(&self, vessel_id: &str) -> Arc<ClientWorldSnapshot> {
        let (snap_ssn, snap_opfor) = self.publish_latest_snapshots().await;
        if vessel_id == "OPFOR-SUB" {
            snap_opfor
        } else {
            snap_ssn
        }
    }
}

/// Starts the independent 30 Hz fixed-step simulation loop and 10 Hz snapshot scheduler.
pub fn spawn_simulation_loops(runtime: Arc<SimulationRuntime>) {
    let sim_hz = runtime.config.sim_hz.max(1);
    let fixed_dt = Duration::from_secs_f64(1.0 / sim_hz as f64);
    let fixed_dt_sec = fixed_dt.as_secs_f64();

    let sim_runtime = runtime.clone();
    tokio::spawn(async move {
        let mut last = Instant::now();
        let mut accumulator = Duration::ZERO;
        let mut interval = tokio::time::interval(fixed_dt);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        info!(sim_hz, "Authoritative simulation loop started");
        loop {
            interval.tick().await;
            let now = Instant::now();
            let frame_delta = now.saturating_duration_since(last);
            last = now;

            let clamped = frame_delta.min(fixed_dt * 4);
            accumulator += clamped;

            let mut steps = 0u32;
            let mut drained_events = Vec::new();
            while accumulator >= fixed_dt && steps < 4 {
                {
                    let mut world = sim_runtime.world.lock().await;
                    world.step(fixed_dt_sec);
                    if !world.pending_events.is_empty() {
                        drained_events.append(&mut world.pending_events);
                    }
                }
                accumulator -= fixed_dt;
                steps += 1;
            }
            for evt in drained_events {
                let _ = sim_runtime.event_tx.send(evt);
            }
            if accumulator >= fixed_dt {
                accumulator = Duration::ZERO;
            }
        }
    });

    let snap_hz = runtime.config.snapshot_hz.max(1);
    let snap_dt = Duration::from_secs_f64(1.0 / snap_hz as f64);
    let snap_runtime = runtime.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(snap_dt);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let heartbeat_timeout = Duration::from_secs(snap_runtime.config.heartbeat_timeout_sec);

        info!(snap_hz, "Snapshot broadcast scheduler started");
        loop {
            interval.tick().await;
            let timed_out = {
                let mut sessions = snap_runtime.sessions.lock().await;
                sessions.prune_expired(heartbeat_timeout)
            };
            if timed_out > 0 {
                debug!(timed_out, "Pruned timed-out client sessions");
            }
            let _ = snap_runtime.publish_latest_snapshots().await;
        }
    });
}
