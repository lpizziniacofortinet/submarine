pub mod commands;
pub mod config;
pub mod network;
pub mod session;
pub mod world;

use std::sync::Arc;
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::config::ServerConfig;
use crate::network::websocket::handle_socket;
use crate::world::bathymetry::{elevation_m, seafloor_depth_m};
use crate::world::rooms::{RoomManager, RoomSummary};

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
    room_count: usize,
}

#[derive(Deserialize)]
struct BathyQuery {
    lat: f64,
    lon: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BathyResponse {
    depth_m: f64,
    elevation_m: f64,
    source: &'static str,
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "ssn774-authoritative-server",
    })
}

async fn status(State(rooms): State<Arc<RoomManager>>) -> Json<StatusResponse> {
    let runtime = rooms.default_room().await;
    let all_rooms = rooms.list_rooms().await;
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
        room_count: all_rooms.len(),
    })
}

async fn list_rooms(State(rooms): State<Arc<RoomManager>>) -> Json<Vec<RoomSummary>> {
    Json(rooms.list_rooms().await)
}

async fn bathymetry_endpoint(
    Query(q): Query<BathyQuery>,
) -> Result<Json<BathyResponse>, StatusCode> {
    if !q.lat.is_finite() || !q.lon.is_finite() || q.lat.abs() > 90.0 || q.lon.abs() > 180.0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Json(BathyResponse {
        depth_m: seafloor_depth_m(q.lat, q.lon),
        elevation_m: elevation_m(q.lat, q.lon),
        source: "Mediterranean ETOPO1 (Rust)",
    }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(rooms): State<Arc<RoomManager>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, rooms))
}

pub fn build_router(rooms: Arc<RoomManager>, config: &ServerConfig) -> Router {
    let static_dir = config.static_dir.clone();
    let assets_dir = if std::path::Path::new("../assets").exists() {
        std::path::PathBuf::from("../assets")
    } else {
        std::path::PathBuf::from("assets")
    };

    let mut app = Router::new()
        .route("/healthz", get(healthz))
        .route("/status", get(status))
        .route("/rooms", get(list_rooms))
        .route("/api/bathymetry", get(bathymetry_endpoint))
        .route("/ws", get(ws_handler))
        .with_state(rooms)
        .layer(CorsLayer::permissive());

    if assets_dir.exists() {
        app = app.nest_service("/assets", ServeDir::new(assets_dir));
    }
    if static_dir.exists() {
        app.fallback_service(ServeDir::new(static_dir))
    } else {
        app
    }
}
