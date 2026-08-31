/** Store-only ZIP (no compression). Filenames must be ASCII. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}

/**
 * @param {Array<{ name: string, text: string }>} files
 * @returns {Blob}
 */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encodeUtf8(file.name);
    const data = encodeUtf8(file.text);
    const crc = crc32(data);
    const local = [
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ];
    const localBytes = new Uint8Array([...local, ...nameBytes, ...data]);
    parts.push(localBytes);

    const dir = [
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ];
    central.push(new Uint8Array([...dir, ...nameBytes]));
    offset += localBytes.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const chunk of central) {
    parts.push(chunk);
    centralSize += chunk.length;
  }
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(centralStart),
    ...u16(0),
  ]);
  parts.push(end);
  return new Blob(parts, { type: "application/zip" });
}
