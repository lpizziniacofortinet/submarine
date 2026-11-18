use std::sync::Arc;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc, watch};
use tracing::{debug, info, warn};

use crate::commands::validation::validate_and_apply_command;
use crate::network::protocol::{
    ClientWorldSnapshot, CommandPayload, HelloPayload, IncomingEnvelope, PingPayload, PongPayload,
    ServerMessage, WelcomePayload, WorldEventPayload, PROTOCOL_VERSION_V1,
};
use crate::world::rooms::RoomManager;
use crate::world::simulation::SimulationRuntime;

pub async fn handle_socket(socket: WebSocket, rooms: Arc<RoomManager>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<ServerMessage>(64);
    let (stream_tx, mut stream_rx) =
        mpsc::channel::<(watch::Receiver<Arc<ClientWorldSnapshot>>, broadcast::Receiver<WorldEventPayload>)>(1);

    let mut active_room: Option<Arc<SimulationRuntime>> = None;
    let mut session_id: Option<String> = None;
    let mut handshake_complete = false;

    // Writer task waits until handshake completes and room receivers are supplied,
    // guaranteeing WELCOME + initial WORLD_SNAPSHOT always arrive first.
    let writer_handle = tokio::spawn(async move {
        let mut snapshot_rx: Option<watch::Receiver<Arc<ClientWorldSnapshot>>> = None;
        let mut event_rx: Option<broadcast::Receiver<WorldEventPayload>> = None;

        loop {
            if snapshot_rx.is_none() {
                tokio::select! {
                    biased;
                    Some(msg) = ctrl_rx.recv() => {
                        if let Ok(json) = serde_json::to_string(&msg) {
                            if ws_sender.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some((srx, erx)) = stream_rx.recv() => {
                        snapshot_rx = Some(srx);
                        event_rx = Some(erx);
                    }
                    else => break,
                }
                continue;
            }

            let srx = snapshot_rx.as_mut().unwrap();
            let erx = event_rx.as_mut().unwrap();

            tokio::select! {
                biased;
                Some(msg) = ctrl_rx.recv() => {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                Ok(evt) = erx.recv() => {
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
                changed = srx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let snap = srx.borrow_and_update().clone();
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

                let runtime = rooms.get_or_create_room(hello.room_id.as_deref()).await;
                let world_id = {
                    let w = runtime.world.lock().await;
                    w.world_id.clone()
                };

                let (session, reconnected) = {
                    let mut mgr = runtime.sessions.lock().await;
                    mgr.connect_or_resume(
                        hello.client_name,
                        hello.session_id,
                        hello.role,
                        world_id.clone(),
                        hello.vessel_id,
                    )
                };

                if session.controlled_entity_id == "OPFOR-SUB" {
                    let mut w = runtime.world.lock().await;
                    if let Some(opfor) = w.get_submarine_mut("OPFOR-SUB") {
                        opfor.human_controlled = true;
                    }
                }

                active_room = Some(runtime.clone());
                session_id = Some(session.session_id.clone());
                handshake_complete = true;

                info!(
                    session_id = %session.session_id,
                    client = %session.client_name,
                    room = %world_id,
                    vessel = %session.controlled_entity_id,
                    role = %session.role.as_str(),
                    reconnected,
                    "WebSocket client handshake complete"
                );

                let _ = ctrl_tx
                    .send(ServerMessage::Welcome {
                        version: PROTOCOL_VERSION_V1,
                        payload: WelcomePayload {
                            session_id: session.session_id.clone(),
                            world_id,
                            assigned_role: session.role.as_str().to_string(),
                            vessel_id: session.controlled_entity_id.clone(),
                            sim_hz: runtime.config.sim_hz,
                            snapshot_hz: runtime.config.snapshot_hz,
                            reconnected,
                        },
                    })
                    .await;

                let initial_snap = runtime.snapshot_for(&session.controlled_entity_id).await;
                let _ = ctrl_tx
                    .send(ServerMessage::WorldSnapshot {
                        version: PROTOCOL_VERSION_V1,
                        payload: (*initial_snap).clone(),
                    })
                    .await;

                let srx = runtime.subscribe_snapshots(&session.controlled_entity_id);
                let erx = runtime.event_tx.subscribe();
                let _ = stream_tx.send((srx, erx)).await;
            }
            "PING" => {
                if !handshake_complete {
                    let _ = ctrl_tx
                        .send(ServerMessage::error("HANDSHAKE_REQUIRED", "Send HELLO before PING."))
                        .await;
                    continue;
                }
                let Some(runtime) = active_room.as_ref() else { continue; };
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
                let Some(runtime) = active_room.as_ref() else { continue; };
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

                debug!(
                    session_id = %session.session_id,
                    vessel = %session.controlled_entity_id,
                    command = %cmd.command,
                    value = cmd.value,
                    accepted = result.accepted,
                    "Processed client command"
                );

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

    if let (Some(runtime), Some(sid)) = (active_room, session_id) {
        let mut mgr = runtime.sessions.lock().await;
        mgr.disconnect(&sid);
        info!(session_id = %sid, "WebSocket client disconnected (simulation continues)");
    }
    writer_handle.abort();
}
