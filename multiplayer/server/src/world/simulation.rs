use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, watch, Mutex};
use tracing::{debug, info};

use crate::config::ServerConfig;
use crate::network::protocol::{ClientWorldSnapshot, WorldEventPayload};
use crate::session::client::SessionManager;
use crate::world::state::AuthoritativeWorld;

/// Shared authoritative runtime state accessed by HTTP/WebSocket handlers and simulation tasks.
pub struct SimulationRuntime {
    pub config: ServerConfig,
    pub world: Mutex<AuthoritativeWorld>,
    pub sessions: Mutex<SessionManager>,
    pub snapshot_tx: watch::Sender<Arc<ClientWorldSnapshot>>,
    pub event_tx: broadcast::Sender<WorldEventPayload>,
    pub snapshot_seq: AtomicU64,
}

impl SimulationRuntime {
    pub fn new(config: ServerConfig) -> Arc<Self> {
        let world = AuthoritativeWorld::new_mediterranean_patrol();
        let initial_snapshot = Arc::new(world.to_client_snapshot(0));
        let (snapshot_tx, _) = watch::channel(initial_snapshot);
        let (event_tx, _) = broadcast::channel(128);

        Arc::new(Self {
            config,
            world: Mutex::new(world),
            sessions: Mutex::new(SessionManager::new()),
            snapshot_tx,
            event_tx,
            snapshot_seq: AtomicU64::new(0),
        })
    }

    pub async fn publish_latest_snapshot(&self) -> Arc<ClientWorldSnapshot> {
        let seq = self.snapshot_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let snapshot = {
            let guard = self.world.lock().await;
            Arc::new(guard.to_client_snapshot(seq))
        };
        let _ = self.snapshot_tx.send(snapshot.clone());
        snapshot
    }
}

/// Starts the independent 30 Hz fixed-step simulation loop and 10 Hz snapshot scheduler.
/// Simulation continues running regardless of whether any clients are connected.
pub fn spawn_simulation_loops(runtime: Arc<SimulationRuntime>) {
    let sim_hz = runtime.config.sim_hz.max(1);
    let fixed_dt = Duration::from_secs_f64(1.0 / sim_hz as f64);
    let fixed_dt_sec = fixed_dt.as_secs_f64();

    // 1. Authoritative 30 Hz monotonic fixed-step simulation loop
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

            // Clamp delta to prevent unbounded catch-up loops after OS scheduling stalls
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

    // 2. Independent 10 Hz snapshot broadcast + heartbeat timeout pruning
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
            let _ = snap_runtime.publish_latest_snapshot().await;
        }
    });
}
