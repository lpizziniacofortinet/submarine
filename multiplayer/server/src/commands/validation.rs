use crate::network::protocol::{CommandResultPayload, WorldEventPayload};
use crate::session::client::ClientSession;
use crate::world::entity::normalize_heading;
use crate::world::state::AuthoritativeWorld;

/// Validates and applies a player command against the authoritative submarine owned by `session`.
pub fn validate_and_apply_command(
    world: &mut AuthoritativeWorld,
    session: &ClientSession,
    command: &str,
    value: f64,
) -> (CommandResultPayload, Option<WorldEventPayload>) {
    if !session.connected {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Session is not active.".to_string(),
            },
            None,
        );
    }

    let Some((vessel_sunk, max_speed, max_depth, ping_cd)) = world
        .get_submarine(&session.controlled_entity_id)
        .map(|s| (s.sunk, s.max_speed_kts, s.max_depth_m, s.active_ping_cooldown_sec))
    else {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Controlled submarine not found in world.".to_string(),
            },
            None,
        );
    };

    if !session.can_command_own_sub {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Client is not authorized to issue vessel commands.".to_string(),
            },
            None,
        );
    }

    if vessel_sunk {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: format!("{} has been lost.", session.controlled_entity_id),
            },
            None,
        );
    }

    if world.paused {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Simulation is paused; command rejected.".to_string(),
            },
            None,
        );
    }

    if !value.is_finite() {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Command value must be a finite number.".to_string(),
            },
            None,
        );
    }

    let vessel_id = session.controlled_entity_id.clone();

    match command {
        "SET_HEADING" => {
            if !session.role.can_helm() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot issue helm orders.", session.role.as_str()),
                    },
                    None,
                );
            }
            if !(0.0..=360.0).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Heading {value} out of valid range [0, 360]."),
                    },
                    None,
                );
            }
            let normalized = normalize_heading(value);
            if let Some(sub) = world.get_submarine_mut(&vessel_id) {
                sub.ordered_heading_deg = normalized;
            }
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "CONN".to_string(),
                message: format!("[{vessel_id}] {} ordered course {:03.0}° TRUE.", session.client_name, normalized),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("Heading order {:03.0}° accepted.", normalized),
                },
                Some(event),
            )
        }
        "SET_SPEED" => {
            if !session.role.can_helm() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot issue speed orders.", session.role.as_str()),
                    },
                    None,
                );
            }
            if !(-5.0..=max_speed).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Speed {value} out of valid range [-5, {max_speed}] kts."),
                    },
                    None,
                );
            }
            if let Some(sub) = world.get_submarine_mut(&vessel_id) {
                sub.ordered_speed_kts = value;
            }
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "HELM".to_string(),
                message: format!("[{vessel_id}] {} ordered speed {:.1} kts.", session.client_name, value),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("Speed order {:.1} kts accepted.", value),
                },
                Some(event),
            )
        }
        "SET_DEPTH" => {
            if !session.role.can_helm() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot issue depth orders.", session.role.as_str()),
                    },
                    None,
                );
            }
            if !(0.0..=max_depth).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Depth {value} out of valid range [0, {max_depth}] m."),
                    },
                    None,
                );
            }
            if let Some(sub) = world.get_submarine_mut(&vessel_id) {
                sub.ordered_depth_m = value;
            }
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "DIVING".to_string(),
                message: format!("[{vessel_id}] {} ordered depth {:.0} m.", session.client_name, value),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("Depth order {:.0} m accepted.", value),
                },
                Some(event),
            )
        }
        "ACTIVE_PING" => {
            if !session.role.can_sonar() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot transmit active sonar.", session.role.as_str()),
                    },
                    None,
                );
            }
            if ping_cd > 0.0 {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Active sonar recharging ({ping_cd:.1}s)."),
                    },
                    None,
                );
            }
            let echoes = world.trigger_active_ping(&vessel_id);
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "SONAR".to_string(),
                message: format!(
                    "[{vessel_id}] {} transmitted 3.5 kHz Active Ping ({echoes} echo returns).",
                    session.client_name
                ),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("Active ping transmitted ({echoes} echoes)."),
                },
                Some(event),
            )
        }
        "TOGGLE_TOWED_ARRAY" => {
            if !session.role.can_sonar() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot operate towed array.", session.role.as_str()),
                    },
                    None,
                );
            }
            let deployed = if let Some(sub) = world.get_submarine_mut(&vessel_id) {
                sub.towed_array_deployed = !sub.towed_array_deployed;
                sub.towed_array_deployed
            } else {
                false
            };
            let state_str = if deployed { "DEPLOYED" } else { "RETRACTED" };
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "SONAR".to_string(),
                message: format!("[{vessel_id}] TB-29A Towed Array {state_str}."),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("Towed array {state_str}."),
                },
                Some(event),
            )
        }
        "FIRE_TUBE" => {
            if !session.role.can_weapons() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot fire torpedoes.", session.role.as_str()),
                    },
                    None,
                );
            }
            if !(0.0..=360.0).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Launch bearing {value} out of valid range [0, 360]."),
                    },
                    None,
                );
            }
            let brg = normalize_heading(value);
            let Some(wep_id) = world.launch_torpedo(&vessel_id, brg) else {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: "No MK-48 ADCAP torpedoes remaining.".to_string(),
                    },
                    None,
                );
            };
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "WEPS".to_string(),
                message: format!(
                    "[{vessel_id}] {} launched {wep_id} bearing {brg:03.0}° TRUE!",
                    session.client_name
                ),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("{wep_id} away bearing {brg:03.0}°."),
                },
                Some(event),
            )
        }
        "DEPLOY_DECOY" => {
            if !session.role.can_weapons() {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!("Role {} cannot deploy countermeasures.", session.role.as_str()),
                    },
                    None,
                );
            }
            let Some(decoy_id) = world.deploy_decoy(&vessel_id) else {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: "No acoustic decoys remaining.".to_string(),
                    },
                    None,
                );
            };
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "WEPS".to_string(),
                message: format!("[{vessel_id}] Deployed {decoy_id} acoustic decoy noisemaker!"),
            };
            (
                CommandResultPayload {
                    accepted: true,
                    command: command.to_string(),
                    message: format!("{decoy_id} deployed."),
                },
                Some(event),
            )
        }
        _ => (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: format!("Unknown command '{command}'."),
            },
            None,
        ),
    }
}
