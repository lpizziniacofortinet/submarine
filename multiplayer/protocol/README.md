# SSN-774 Multiplayer Protocol

Versioned wire protocol for communication between `multiplayer/client/` and `multiplayer/server/`.

- Current version: [`v1/`](./v1/protocol.md)
- JSON Schema: [`v1/messages.schema.json`](./v1/messages.schema.json)

The protocol is strictly decoupled from internal Rust server structs so that future versions (e.g. MessagePack/Protobuf binary framing in `v2`) can be introduced without redesigning the simulation core.
