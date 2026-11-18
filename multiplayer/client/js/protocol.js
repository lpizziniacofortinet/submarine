(function (root) {
  'use strict';

  const PROTOCOL_VERSION = 1;

  function buildHello(clientName, sessionId = null, role = 'COMMANDER', roomId = 'med-patrol-alpha', vesselId = 'SSN-774') {
    return JSON.stringify({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      payload: {
        clientName: clientName || 'web-tactical-client',
        sessionId: sessionId || null,
        role: role || 'COMMANDER',
        roomId: roomId || 'med-patrol-alpha',
        vesselId: vesselId || 'SSN-774'
      }
    });
  }

  function buildPing(clientTimeMs) {
    return JSON.stringify({
      type: 'PING',
      version: PROTOCOL_VERSION,
      payload: { clientTimeMs }
    });
  }

  function buildCommand(sequence, command, value) {
    return JSON.stringify({
      type: 'COMMAND',
      version: PROTOCOL_VERSION,
      sequence,
      payload: { command, value }
    });
  }

  function parseServerMessage(rawText) {
    const msg = JSON.parse(rawText);
    if (!msg || typeof msg.type !== 'string' || msg.version !== PROTOCOL_VERSION) {
      throw new Error('Unsupported or malformed server protocol message');
    }
    return msg;
  }

  root.MultiplayerProtocol = {
    PROTOCOL_VERSION,
    buildHello,
    buildPing,
    buildCommand,
    parseServerMessage
  };
})(window);
