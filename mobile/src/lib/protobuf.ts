/**
 * Just enough of the protobuf wire format to read a GTFS-realtime feed.
 *
 * A generated decoder would pull in a large library for a handful of fields, so
 * this reads the wire format directly: a message is a run of (field number,
 * wire type, value) entries, and anything we do not ask about is skipped. That
 * also makes it indifferent to the MTA's own extension fields.
 */

export type Field = {
  /** Field number from the .proto file. */
  n: number;
  /** Varint and fixed values arrive as numbers. */
  v: number;
  /** Length-delimited values (strings, nested messages) arrive as bytes. */
  b?: Uint8Array;
};

const TWO32 = 4294967296;

/** Reads a varint as a JS number, exact up to 2^53 and correct for negative int32/int64. */
function varint(buf: Uint8Array, pos: { i: number }): number {
  let lo = 0;
  let hi = 0;
  let shift = 0;
  let byte: number;
  do {
    if (pos.i >= buf.length) throw new Error('truncated varint');
    byte = buf[pos.i++];
    const bits = byte & 0x7f;
    if (shift < 32) {
      lo |= bits << shift;
      if (shift > 25) hi |= bits >>> (32 - shift);
    } else {
      hi |= bits << (shift - 32);
    }
    shift += 7;
  } while (byte & 0x80 && shift < 70);

  lo >>>= 0;
  hi >>>= 0;
  // Bit 63 set means a negative two's-complement value.
  if (hi >= 0x80000000) return -(((~hi >>> 0) * TWO32) + (~lo >>> 0) + 1);
  return hi * TWO32 + lo;
}

export function* fields(buf: Uint8Array): Generator<Field> {
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const key = varint(buf, pos);
    const n = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      yield { n, v: varint(buf, pos) };
    } else if (wire === 2) {
      const len = varint(buf, pos);
      if (pos.i + len > buf.length) throw new Error('truncated field');
      yield { n, v: len, b: buf.subarray(pos.i, pos.i + len) };
      pos.i += len;
    } else if (wire === 1) {
      pos.i += 8;
    } else if (wire === 5) {
      pos.i += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

export function text(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp =
        ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  return out;
}
