use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use ssn774_server::build_router;
use ssn774_server::commands::validation::validate_and_apply_command;
use ssn774_server::config::ServerConfig;
use ssn774_server::network::protocol::{ServerMessage, PROTOCOL_VERSION_V1};
use ssn774_server::session::client::SessionManager;
use ssn774_server::world::simulation::{spawn_simulation_loops, SimulationRuntime};
use ssn774_server::world::state::AuthoritativeWorld;

#[test]
fn world_init_and_fixed_step_movement() {
    let mut world = AuthoritativeWorld::new_mediterranean_patrol();
    assert_eq!(world.tick, 0);
    let init_lat = world.own_sub.lat;
    let init_lon = world.own_sub.lon;
    let init_contact_lat = world.contacts[0].lat;

    // 30 steps at 30 Hz = 1.0 second
    for _ in 0..30 {
        world.step(1.0 / 30.0);
    }

    assert_eq!(world.tick, 30);
    assert!((world.sim_time_sec - 1.0).abs() < 1e-6);
    // Heading 090° moves East (+lon)
    assert!(world.own_sub.lon > init_lon);
    assert!((world.own_sub.lat - init_lat).abs() < 1e-7);
    assert_ne!(world.contacts[0].lat, init_contact_lat);
}

#[test]
fn command_validation_accepts_valid_and_rejects_invalid() {
    let mut world = AuthoritativeWorld::new_mediterranean_patrol();
    let mut mgr = SessionManager::new();
    let (session, _) = mgr.connect_or_resume("CONN-1".into(), None);

    let (ok_hdg, evt) = validate_and_apply_command(&mut world, &session, "SET_HEADING", 145.0);
    assert!(ok_hdg.accepted);
    assert!(evt.is_some());
    assert_eq!(world.own_sub.ordered_heading_deg, 145.0);

    let (bad_hdg, _) = validate_and_apply_command(&mut world, &session, "SET_HEADING", 450.0);
    assert!(!bad_hdg.accepted);

    let (bad_spd, _) = validate_and_apply_command(&mut world, &session, "SET_SPEED", 99.0);
    assert!(!bad_spd.accepted);

    let (bad_nan, _) = validate_and_apply_command(&mut world, &session, "SET_DEPTH", f64::NAN);
    assert!(!bad_nan.accepted);

    let (bad_cmd, _) = validate_and_apply_command(&mut world, &session, "LAUNCH_NUKE", 1.0);
    assert!(!bad_cmd.accepted);

    let mut unauth = session.clone();
    unauth.can_command_own_sub = false;
    let (denied, _) = validate_and_apply_command(&mut world, &unauth, "SET_SPEED", 12.0);
    assert!(!denied.accepted);
}

#[test]
fn hidden_authoritative_entities_and_private_fields_never_leak_in_snapshot() {
    let world = AuthoritativeWorld::new_mediterranean_patrol();
    // Confirm hidden stealth sub exists in authoritative world
    let hidden = world
        .contacts
        .iter()
        .find(|c| c.id == "TRK-99")
        .expect("Authoritative world should contain hidden TRK-99");
    assert!(!hidden.detectable_by_client);

    let snapshot = world.to_client_snapshot(1);
    let serialized = serde_json::to_string(&snapshot).expect("Snapshot must serialize");

    // Must expose only the 2 detectable contacts
    assert_eq!(snapshot.contacts.len(), 2);
    // Explicitly prove hidden coordinates & private fields are absent from JSON
    assert!(!serialized.contains("TRK-99"));
    assert!(!serialized.contains("KAZAN"));
    assert!(!serialized.contains("37.215"));
    assert!(!serialized.contains("15.42"));
    assert!(!serialized.contains("COVERT_AMBUSH"));
    assert!(!serialized.contains("internalReactorPowerMw"));
    assert!(!serialized.contains("internalAiState"));
    assert!(!serialized.contains("internalWeaponLoad"));
}

#[test]
fn session_lifecycle_and_expiration() {
    let mut mgr = SessionManager::new();
    let (s1, reconnected1) = mgr.connect_or_resume("OP-1".into(), None);
    assert!(!reconnected1);
    assert_eq!(mgr.active_count(), 1);

    mgr.disconnect(&s1.session_id);
    assert_eq!(mgr.active_count(), 0);

    let (s1_resumed, reconnected2) =
        mgr.connect_or_resume("OP-1".into(), Some(s1.session_id.clone()));
    assert!(reconnected2);
    assert_eq!(s1_resumed.session_id, s1.session_id);
    assert_eq!(mgr.active_count(), 1);

    // Zero timeout should immediately mark active session disconnected
    let timed_out = mgr.prune_expired(Duration::ZERO);
    assert_eq!(timed_out, 1);
    assert_eq!(mgr.active_count(), 0);
}

#[tokio::test]
async fn websocket_end_to_end_multi_client_commands_and_reconnect() {
    let cfg = ServerConfig {
        host: "127.0.0.1".into(),
        port: 0,
        sim_hz: 30,
        snapshot_hz: 10,
        heartbeat_timeout_sec: 15,
        static_dir: "nonexistent-dir".into(),
    };
    let runtime = SimulationRuntime::new(cfg);
    spawn_simulation_loops(runtime.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = build_router(runtime.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let ws_url = format!("ws://{}/ws", addr);

    // Client 1 connects & sends invalid protocol version first
    let (mut ws1, _) = connect_async(&ws_url).await.unwrap();
    ws1.send(Message::Text(
        r#"{"type":"HELLO","version":2,"payload":{"clientName":"C1"}}"#.into(),
    ))
    .await
    .unwrap();
    let err_frame = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    let err_msg: ServerMessage = serde_json::from_str(&err_frame).unwrap();
    match err_msg {
        ServerMessage::Error { payload, .. } => assert_eq!(payload.code, "UNSUPPORTED_VERSION"),
        other => panic!("Expected ERROR, got {other:?}"),
    }

    // Valid HELLO v1
    ws1.send(Message::Text(
        r#"{"type":"HELLO","version":1,"payload":{"clientName":"C1"}}"#.into(),
    ))
    .await
    .unwrap();

    let welcome_txt = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    let session_id = match serde_json::from_str::<ServerMessage>(&welcome_txt).unwrap() {
        ServerMessage::Welcome { version, payload } => {
            assert_eq!(version, PROTOCOL_VERSION_V1);
            assert!(!payload.reconnected);
            payload.session_id
        }
        other => panic!("Expected WELCOME, got {other:?}"),
    };

    // Initial snapshot arrives immediately
    let snap_txt = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    match serde_json::from_str::<ServerMessage>(&snap_txt).unwrap() {
        ServerMessage::WorldSnapshot { payload, .. } => {
            assert_eq!(payload.contacts.len(), 2);
        }
        other => panic!("Expected WORLD_SNAPSHOT, got {other:?}"),
    }

    // Client 2 connects simultaneously
    let (mut ws2, _) = connect_async(&ws_url).await.unwrap();
    ws2.send(Message::Text(
        r#"{"type":"HELLO","version":1,"payload":{"clientName":"C2"}}"#.into(),
    ))
    .await
    .unwrap();
    let _ = ws2.next().await.unwrap().unwrap(); // WELCOME

    // Client 1 sends valid SET_HEADING command
    ws1.send(Message::Text(
        r#"{"type":"COMMAND","version":1,"sequence":1,"payload":{"command":"SET_HEADING","value":145}}"#.into(),
    ))
    .await
    .unwrap();

    let mut got_ack = false;
    for _ in 0..10 {
        let frame = ws1.next().await.unwrap().unwrap().into_text().unwrap();
        if let ServerMessage::CommandResult { sequence, payload, .. } =
            serde_json::from_str(&frame).unwrap()
        {
            assert_eq!(sequence, 1);
            assert!(payload.accepted);
            got_ack = true;
            break;
        }
    }
    assert!(got_ack, "Expected COMMAND_RESULT");

    // Disconnect both clients; verify server simulation continues advancing
    let tick_before = runtime.world.lock().await.tick;
    let _ = ws1.close(None).await;
    let _ = ws2.close(None).await;
    tokio::time::sleep(Duration::from_millis(120)).await;
    let tick_after = runtime.world.lock().await.tick;
    assert!(tick_after > tick_before, "Server simulation must keep advancing with 0 clients");

    // Client 1 reconnects with sessionId and receives fresh snapshot
    let (mut ws1_re, _) = connect_async(&ws_url).await.unwrap();
    let hello_re = format!(
        r#"{{"type":"HELLO","version":1,"payload":{{"clientName":"C1","sessionId":"{}"}}}}"#,
        session_id
    );
    ws1_re.send(Message::Text(hello_re)).await.unwrap();

    let w_re = ws1_re.next().await.unwrap().unwrap().into_text().unwrap();
    match serde_json::from_str::<ServerMessage>(&w_re).unwrap() {
        ServerMessage::Welcome { payload, .. } => assert!(payload.reconnected),
        other => panic!("Expected WELCOME(reconnected=true), got {other:?}"),
    }
    let s_re = ws1_re.next().await.unwrap().unwrap().into_text().unwrap();
    match serde_json::from_str::<ServerMessage>(&s_re).unwrap() {
        ServerMessage::WorldSnapshot { payload, .. } => {
            assert_eq!(payload.own_sub.ordered_heading_deg, 145.0);
        }
        other => panic!("Expected WORLD_SNAPSHOT after reconnect, got {other:?}"),
    }
}
