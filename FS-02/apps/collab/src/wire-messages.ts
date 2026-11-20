/**
 * Just enough of the Hocuspocus/y-protocols framing to tell, without applying anything,
 * what an inbound message is. Used only for logging and counting; the library does the
 * real decoding and enforcement.
 *
 * Frame: varString(document address) · varUint(message type) · …; for a Sync message
 * (type 0) the next varUint is the sync step: 0 = state vector, 1 = update for sync step 2,
 * 2 = incremental update.
 */
function readVarUint(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let index = start;
  while (index < bytes.length && shift <= 28) {
    const byte = bytes[index++] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: index };
    shift += 7;
  }
  return null;
}

export type InboundKind = 'sync-read' | 'sync-write' | 'awareness' | 'other' | 'unknown';

export function classifyInbound(bytes: Uint8Array): InboundKind {
  const addressLength = readVarUint(bytes, 0);
  if (!addressLength) return 'unknown';
  const type = readVarUint(bytes, addressLength.next + addressLength.value);
  if (!type) return 'unknown';
  if (type.value === 1) return 'awareness';
  if (type.value !== 0) return 'other';
  const step = readVarUint(bytes, type.next);
  if (!step) return 'unknown';
  return step.value === 0 ? 'sync-read' : 'sync-write';
}
