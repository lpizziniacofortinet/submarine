pub mod commands;
pub mod config;
pub mod network;
pub mod session;
pub mod world;

use std::sync::Arc;
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::network::websocket::handle_socket;
use crate::world::simulation::SimulationRuntime;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    world_id: String,
    server_tick: u64,
    sim_time_sec: f64,
    sim_hz: u32,
    snapshot_hz: u32,
    active_sessions: usize,
    total_sessions: usize,
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "ssn774-authoritative-server",
    })
}

async fn status(State(runtime): State<Arc<SimulationRuntime>>) -> Json<StatusResponse> {
    let (world_id, server_tick, sim_time_sec) = {
        let w = runtime.world.lock().await;
        (w.world_id.clone(), w.tick, w.sim_time_sec)
    };
    let (active_sessions, total_sessions) = {
        let s = runtime.sessions.lock().await;
        (s.active_count(), s.total_count())
    };
    Json(StatusResponse {
        world_id,
        server_tick,
        sim_time_sec,
        sim_hz: runtime.config.sim_hz,
        snapshot_hz: runtime.config.snapshot_hz,
        active_sessions,
        total_sessions,
    })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(runtime): State<Arc<SimulationRuntime>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, runtime))
}

pub fn build_router(runtime: Arc<SimulationRuntime>) -> Router {
    let static_dir = runtime.config.static_dir.clone();
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/status", get(status))
        .route("/ws", get(ws_handler))
        .with_state(runtime)
        .layer(CorsLayer::permissive());

    if static_dir.exists() {
        app.fallback_service(ServeDir::new(static_dir))
    } else {
        app
    }
}
