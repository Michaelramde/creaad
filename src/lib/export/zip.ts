/**
 * Écriture ZIP minimale, sans dépendance.
 *
 * Méthode « store » (aucune compression) : les images sont déjà compressées,
 * et une fiche produit de 37 photos pèse quelques mégaoctets. Le format ZIP
 * est assez simple pour être écrit à la main — et le faire évite d'ajouter une
 * dépendance pour un seul usage.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (date.getSeconds() >> 1);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const { time, date } = dosDateTime();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const encoder = new TextEncoder();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // signature
    localView.setUint16(4, 20, true); // version requise
    localView.setUint16(6, 0, true); // drapeaux
    localView.setUint16(8, 0, true); // méthode : store
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    chunks.push(local, entry.data);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true); // signature centrale
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, time, true);
    headerView.setUint16(14, date, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, size, true);
    headerView.setUint32(24, size, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, offset, true); // position du local header
    header.set(name, 46);
    central.push(header);

    offset += local.length + size;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total =
    chunks.reduce((sum, chunk) => sum + chunk.length, 0) + centralSize + end.length;
  const zip = new Uint8Array(total);

  let cursor = 0;
  for (const chunk of [...chunks, ...central, end]) {
    zip.set(chunk, cursor);
    cursor += chunk.length;
  }

  return zip;
}
