use std::sync::Arc;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::commands::validation::validate_and_apply_command;
use crate::network::protocol::{
    CommandPayload, HelloPayload, IncomingEnvelope, PingPayload, PongPayload, ServerMessage,
    WelcomePayload, PROTOCOL_VERSION_V1,
};
use crate::world::simulation::SimulationRuntime;

pub async fn handle_socket(socket: WebSocket, runtime: Arc<SimulationRuntime>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Reliable bounded channel for discrete control messages (WELCOME, PONG, COMMAND_RESULT, WORLD_EVENT, ERROR)
    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<ServerMessage>(64);
    let mut snapshot_rx = runtime.snapshot_tx.subscribe();
    let mut event_rx = runtime.event_tx.subscribe();

    let mut session_id: Option<String> = None;
    let mut handshake_complete = false;

    // Writer task: prioritizes discrete control/event messages and forwards latest snapshot without stale queueing
    let writer_handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                Some(msg) = ctrl_rx.recv() => {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                Ok(evt) = event_rx.recv() => {
                    let msg = ServerMessage::WorldEvent {
                        version: PROTOCOL_VERSION_V1,
                        payload: evt,
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                changed = snapshot_rx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let snap = snapshot_rx.borrow_and_update().clone();
                    let msg = ServerMessage::WorldSnapshot {
                        version: PROTOCOL_VERSION_V1,
                        payload: (*snap).clone(),
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                else => break,
            }
        }
    });

    while let Some(Ok(frame)) = ws_receiver.next().await {
        let text = match frame {
            Message::Text(t) => t,
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Binary(_) => continue,
        };

        let envelope: IncomingEnvelope = match serde_json::from_str(&text) {
            Ok(env) => env,
            Err(err) => {
                let _ = ctrl_tx
                    .send(ServerMessage::error("INVALID_JSON", format!("Malformed JSON: {err}")))
                    .await;
                continue;
            }
        };

        if envelope.version != PROTOCOL_VERSION_V1 {
            let _ = ctrl_tx
                .send(ServerMessage::error(
                    "UNSUPPORTED_VERSION",
                    format!(
                        "Unsupported protocol version {}; expected {}.",
                        envelope.version, PROTOCOL_VERSION_V1
                    ),
                ))
                .await;
            continue;
        }

        match envelope.msg_type.as_str() {
            "HELLO" => {
                let hello: HelloPayload = match serde_json::from_value(envelope.payload) {
                    Ok(h) => h,
                    Err(err) => {
                        let _ = ctrl_tx
                            .send(ServerMessage::error("INVALID_HELLO", format!("Invalid HELLO payload: {err}")))
                            .await;
                        continue;
                    }
                };

                let (session, reconnected) = {
                    let mut mgr = runtime.sessions.lock().await;
                    mgr.connect_or_resume(hello.client_name, hello.session_id)
                };
                session_id = Some(session.session_id.clone());
                handshake_complete = true;

                let world_id = {
                    let w = runtime.world.lock().await;
                    w.world_id.clone()
                };

                info!(session_id = %session.session_id, client = %session.client_name, reconnected, "WebSocket client handshake complete");

                let _ = ctrl_tx
                    .send(ServerMessage::Welcome {
                        version: PROTOCOL_VERSION_V1,
                        payload: WelcomePayload {
                            session_id: session.session_id.clone(),
                            world_id,
                            sim_hz: runtime.config.sim_hz,
                            snapshot_hz: runtime.config.snapshot_hz,
                            reconnected,
                        },
                    })
                    .await;

                // Send a fresh complete initial/reconnected WORLD_SNAPSHOT immediately
                let initial_snap = runtime.publish_latest_snapshot().await;
                let _ = ctrl_tx
                    .send(ServerMessage::WorldSnapshot {
                        version: PROTOCOL_VERSION_V1,
                        payload: (*initial_snap).clone(),
                    })
                    .await;
            }
            "PING" => {
                if !handshake_complete {
                    let _ = ctrl_tx
                        .send(ServerMessage::error("HANDSHAKE_REQUIRED", "Send HELLO before PING."))
                        .await;
                    continue;
                }
                let ping: PingPayload = match serde_json::from_value(envelope.payload) {
                    Ok(p) => p,
                    Err(err) => {
                        let _ = ctrl_tx
                            .send(ServerMessage::error("INVALID_PING", format!("Invalid PING payload: {err}")))
                            .await;
                        continue;
                    }
                };
                if let Some(sid) = session_id.as_deref() {
                    let mut mgr = runtime.sessions.lock().await;
                    mgr.touch(sid);
                }
                let server_tick = {
                    let w = runtime.world.lock().await;
                    w.tick
                };
                let _ = ctrl_tx
                    .send(ServerMessage::Pong {
                        version: PROTOCOL_VERSION_V1,
                        payload: PongPayload {
                            client_time_ms: ping.client_time_ms,
                            server_tick,
                        },
                    })
                    .await;
            }
            "COMMAND" => {
                if !handshake_complete {
                    let _ = ctrl_tx
                        .send(ServerMessage::error("HANDSHAKE_REQUIRED", "Send HELLO before COMMAND."))
                        .await;
                    continue;
                }
                let cmd: CommandPayload = match serde_json::from_value(envelope.payload) {
                    Ok(c) => c,
                    Err(err) => {
                        let _ = ctrl_tx
                            .send(ServerMessage::error("INVALID_COMMAND", format!("Invalid COMMAND payload: {err}")))
                            .await;
                        continue;
                    }
                };

                let sid = session_id.as_deref().unwrap_or_default();
                let session_opt = {
                    let mut mgr = runtime.sessions.lock().await;
                    mgr.touch(sid);
                    mgr.get(sid).cloned()
                };

                let Some(session) = session_opt else {
                    let _ = ctrl_tx
                        .send(ServerMessage::error("SESSION_NOT_FOUND", "Active session not found."))
                        .await;
                    continue;
                };

                let seq = envelope.sequence.unwrap_or(0);
                let (result, maybe_event) = {
                    let mut world = runtime.world.lock().await;
                    validate_and_apply_command(&mut world, &session, &cmd.command, cmd.value)
                };

                debug!(session_id = %session.session_id, command = %cmd.command, value = cmd.value, accepted = result.accepted, "Processed client command");

                let _ = ctrl_tx
                    .send(ServerMessage::CommandResult {
                        version: PROTOCOL_VERSION_V1,
                        sequence: seq,
                        payload: result,
                    })
                    .await;

                if let Some(evt) = maybe_event {
                    let _ = runtime.event_tx.send(evt);
                }
            }
            other => {
                warn!(msg_type = %other, "Unknown protocol message type");
                let _ = ctrl_tx
                    .send(ServerMessage::error(
                        "UNKNOWN_MESSAGE_TYPE",
                        format!("Unsupported message type '{other}'."),
                    ))
                    .await;
            }
        }
    }

    if let Some(sid) = session_id {
        let mut mgr = runtime.sessions.lock().await;
        mgr.disconnect(&sid);
        info!(session_id = %sid, "WebSocket client disconnected (simulation continues)");
    }
    writer_handle.abort();
}
