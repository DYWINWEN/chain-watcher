// BullMQ jobIds cannot contain ':' (reserved Redis key separator) and other
// special characters can also trip Redis key parsing under uncommon configs.
// safeJobId joins parts with '_' and scrubs any non-word, non-dash chars.
//
// Used by both ingestors (RawEvent → raw-tx queue) and the decoder worker
// (NormalizedTx → norm queue). BTC NormalizedTx.txHash already contains '#'
// to disambiguate vouts; the scrubber handles that too.

export function safeJobId(...parts: Array<string | number>): string {
  return parts.map((p) => String(p).replace(/[^\w-]/g, '_')).join('_');
}
