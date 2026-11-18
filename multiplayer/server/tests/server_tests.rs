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

    for _ in 0..30 {
        world.step(1.0 / 30.0);
    }

    assert_eq!(world.tick, 30);
    assert!((world.sim_time_sec - 1.0).abs() < 1e-6);
    assert!(world.own_sub.lon > init_lon);
    assert!((world.own_sub.lat - init_lat).abs() < 1e-7);
    assert_ne!(world.contacts[0].lat, init_contact_lat);
}

#[test]
fn command_validation_and_role_permissions() {
    let mut world = AuthoritativeWorld::new_mediterranean_patrol();
    let mut mgr = SessionManager::new();
    let (cmdr, _) = mgr.connect_or_resume("CMDR".into(), None, Some("COMMANDER".into()));
    let (sonar, _) = mgr.connect_or_resume("SONAR-1".into(), None, Some("SONAR".into()));
    let (conn, _) = mgr.connect_or_resume("CONN-1".into(), None, Some("CONN".into()));
    let (weps, _) = mgr.connect_or_resume("WEPS-1".into(), None, Some("WEPS".into()));

    // Role enforcement
    assert!(!validate_and_apply_command(&mut world, &sonar, "SET_HEADING", 145.0).0.accepted);
    assert!(validate_and_apply_command(&mut world, &sonar, "ACTIVE_PING", 1.0).0.accepted);
    assert!(!validate_and_apply_command(&mut world, &conn, "FIRE_TUBE", 90.0).0.accepted);
    assert!(validate_and_apply_command(&mut world, &conn, "SET_HEADING", 145.0).0.accepted);
    assert!(validate_and_apply_command(&mut world, &weps, "FIRE_TUBE", 90.0).0.accepted);

    // Out-of-range / NaN / unknown
    assert!(!validate_and_apply_command(&mut world, &cmdr, "SET_HEADING", 450.0).0.accepted);
    assert!(!validate_and_apply_command(&mut world, &cmdr, "SET_SPEED", 99.0).0.accepted);
    assert!(!validate_and_apply_command(&mut world, &cmdr, "SET_DEPTH", f64::NAN).0.accepted);
    assert!(!validate_and_apply_command(&mut world, &cmdr, "LAUNCH_NUKE", 1.0).0.accepted);
    assert_eq!(world.own_sub.ordered_heading_deg, 145.0);
}

#[test]
fn acoustic_fog_of_war_hides_quiet_sub_and_omits_passive_ranges() {
    let mut world = AuthoritativeWorld::new_mediterranean_patrol();
    let snapshot = world.to_client_snapshot(1);
    let serialized = serde_json::to_string(&snapshot).expect("Snapshot must serialize");

    // Only the 2 loud surface contacts are passively detectable; quiet sub TRK-99 below layer is hidden
    assert_eq!(snapshot.contacts.len(), 2);
    for c in &snapshot.contacts {
        assert!(!c.ranged);
        assert!(c.lat.is_none());
        assert!(c.lon.is_none());
        assert!(c.range_nm.is_none());
    }

    // Explicitly prove hidden TRK-99 and surface contact coordinates & private fields are absent
    assert!(!serialized.contains("TRK-99"));
    assert!(!serialized.contains("KAZAN"));
    assert!(!serialized.contains("37.215"));
    assert!(!serialized.contains("37.24"));
    assert!(!serialized.contains("COVERT_AMBUSH"));
    assert!(!serialized.contains("internalReactorPowerMw"));
    assert!(!serialized.contains("internalAiState"));

    // Active ping resolves range/coordinates for contacts within 18 NM
    let echoes = world.trigger_active_ping();
    assert_eq!(echoes, 3);
    let ranged_snap = world.to_client_snapshot(2);
    assert_eq!(ranged_snap.contacts.len(), 3);
    assert!(ranged_snap.contacts.iter().all(|c| c.ranged && c.lat.is_some() && c.range_nm.is_some()));
}

#[test]
fn torpedo_launch_homes_and_sinks_target() {
    let mut world = AuthoritativeWorld::new_mediterranean_patrol();
    // Place TRK-02 0.4 NM dead ahead (East, 090°)
    world.contacts[1].lat = world.own_sub.lat;
    world.contacts[1].lon = world.own_sub.lon + (0.4 / (60.0 * world.own_sub.lat.to_radians().cos()));
    world.contacts[1].speed_kts = 0.0;

    let id = world.launch_torpedo(90.0);
    assert_eq!(id, "MK48-01");
    assert_eq!(world.own_sub.torpedoes_remaining, 15);

    // Step 40 seconds at 30 Hz (torpedo at 45 kts covers 0.5 NM in 40s)
    for _ in 0..(40 * 30) {
        world.step(1.0 / 30.0);
    }

    assert!(world.contacts[1].sunk, "Target should be sunk by MK-48 ADCAP");
    assert!(world.pending_events.iter().any(|e| e.category == "WEPS" && e.message.contains("TORPEDO DETONATION")));
}

#[test]
fn session_lifecycle_and_expiration() {
    let mut mgr = SessionManager::new();
    let (s1, reconnected1) = mgr.connect_or_resume("OP-1".into(), None, Some("SONAR".into()));
    assert!(!reconnected1);
    assert_eq!(mgr.active_count(), 1);

    mgr.disconnect(&s1.session_id);
    assert_eq!(mgr.active_count(), 0);

    let (s1_resumed, reconnected2) =
        mgr.connect_or_resume("OP-1".into(), Some(s1.session_id.clone()), None);
    assert!(reconnected2);
    assert_eq!(s1_resumed.session_id, s1.session_id);
    assert_eq!(mgr.active_count(), 1);

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

    let (mut ws1, _) = connect_async(&ws_url).await.unwrap();
    ws1.send(Message::Text(
        r#"{"type":"HELLO","version":2,"payload":{"clientName":"C1"}}"#.into(),
    ))
    .await
    .unwrap();
    let err_frame = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    match serde_json::from_str::<ServerMessage>(&err_frame).unwrap() {
        ServerMessage::Error { payload, .. } => assert_eq!(payload.code, "UNSUPPORTED_VERSION"),
        other => panic!("Expected ERROR, got {other:?}"),
    }

    ws1.send(Message::Text(
        r#"{"type":"HELLO","version":1,"payload":{"clientName":"C1","role":"COMMANDER"}}"#.into(),
    ))
    .await
    .unwrap();

    let welcome_txt = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    let session_id = match serde_json::from_str::<ServerMessage>(&welcome_txt).unwrap() {
        ServerMessage::Welcome { version, payload } => {
            assert_eq!(version, PROTOCOL_VERSION_V1);
            assert_eq!(payload.assigned_role, "COMMANDER");
            assert!(!payload.reconnected);
            payload.session_id
        }
        other => panic!("Expected WELCOME, got {other:?}"),
    };

    let snap_txt = ws1.next().await.unwrap().unwrap().into_text().unwrap();
    match serde_json::from_str::<ServerMessage>(&snap_txt).unwrap() {
        ServerMessage::WorldSnapshot { payload, .. } => {
            assert_eq!(payload.contacts.len(), 2);
            assert!(payload.contacts.iter().all(|c| !c.ranged));
        }
        other => panic!("Expected WORLD_SNAPSHOT, got {other:?}"),
    }

    // Client 2 connects as SONAR
    let (mut ws2, _) = connect_async(&ws_url).await.unwrap();
    ws2.send(Message::Text(
        r#"{"type":"HELLO","version":1,"payload":{"clientName":"C2","role":"SONAR"}}"#.into(),
    ))
    .await
    .unwrap();
    let _ = ws2.next().await.unwrap().unwrap();

    // Client 1 sends SET_HEADING
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

    let tick_before = runtime.world.lock().await.tick;
    let _ = ws1.close(None).await;
    let _ = ws2.close(None).await;
    tokio::time::sleep(Duration::from_millis(120)).await;
    let tick_after = runtime.world.lock().await.tick;
    assert!(tick_after > tick_before, "Server simulation must keep advancing with 0 clients");

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
