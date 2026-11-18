use tracing::info;
use tracing_subscriber::EnvFilter;

use ssn774_server::build_router;
use ssn774_server::config::ServerConfig;
use ssn774_server::world::rooms::RoomManager;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = ServerConfig::from_env();
    let bind_addr = config.bind_addr();
    let rooms = RoomManager::new(config.clone());

    let app = build_router(rooms, &config);
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("Failed to bind server address");
    info!("SSN-774 Authoritative Server listening on http://{}", bind_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server exited unexpectedly");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!("Shutdown signal received, stopping server.");
}
