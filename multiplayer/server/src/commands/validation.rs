use crate::network::protocol::{CommandResultPayload, WorldEventPayload};
use crate::session::client::ClientSession;
use crate::world::entity::normalize_heading;
use crate::world::state::AuthoritativeWorld;

/// Validates and applies a player command against the authoritative world.
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

    if !session.can_command_own_sub || session.controlled_entity_id != world.own_sub.id {
        return (
            CommandResultPayload {
                accepted: false,
                command: command.to_string(),
                message: "Client is not authorized to command SSN-774.".to_string(),
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
            world.own_sub.ordered_heading_deg = normalized;
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "CONN".to_string(),
                message: format!("{} ordered course {:03.0}° TRUE.", session.client_name, normalized),
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
            if !(-5.0..=world.own_sub.max_speed_kts).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!(
                            "Speed {value} out of valid range [-5, {}] kts.",
                            world.own_sub.max_speed_kts
                        ),
                    },
                    None,
                );
            }
            world.own_sub.ordered_speed_kts = value;
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "HELM".to_string(),
                message: format!("{} ordered speed {:.1} kts.", session.client_name, value),
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
            if !(0.0..=world.own_sub.max_depth_m).contains(&value) {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!(
                            "Depth {value} out of valid range [0, {}] m.",
                            world.own_sub.max_depth_m
                        ),
                    },
                    None,
                );
            }
            world.own_sub.ordered_depth_m = value;
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "DIVING".to_string(),
                message: format!("{} ordered depth {:.0} m.", session.client_name, value),
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
            if world.own_sub.active_ping_cooldown_sec > 0.0 {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: format!(
                            "Active sonar recharging ({:.1}s).",
                            world.own_sub.active_ping_cooldown_sec
                        ),
                    },
                    None,
                );
            }
            let echoes = world.trigger_active_ping();
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "SONAR".to_string(),
                message: format!(
                    "{} transmitted 3.5 kHz Active Ping ({} echo returns).",
                    session.client_name, echoes
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
            if world.own_sub.torpedoes_remaining == 0 {
                return (
                    CommandResultPayload {
                        accepted: false,
                        command: command.to_string(),
                        message: "No MK-48 ADCAP torpedoes remaining.".to_string(),
                    },
                    None,
                );
            }
            let brg = normalize_heading(value);
            let wep_id = world.launch_torpedo(brg);
            let event = WorldEventPayload {
                event_id: world.next_event_id(),
                server_tick: world.tick,
                category: "WEPS".to_string(),
                message: format!(
                    "{} launched {} bearing {:03.0}° TRUE!",
                    session.client_name, wep_id, brg
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
