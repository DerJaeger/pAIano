import { unzipSync, strFromU8 } from 'fflate';
import { attr, child, children, parseXml } from '../xml/xml';

/** Local file header magic ("PK\3\4") — how we tell a .mxl from a .musicxml. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function isCompressedMusicXml(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * Extracts the MusicXML document from a compressed `.mxl` container — what
 * MuseScore exports by default.
 *
 * The container names its root score in `META-INF/container.xml`; we fall back
 * to the first top-level `.xml`/`.musicxml` entry for files that omit it.
 */
export function extractMusicXml(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const path = rootFilePath(entries) ?? fallbackPath(entries);
  if (path === undefined) throw new Error('No MusicXML document found inside the .mxl container');
  return stripBom(strFromU8(entries[path]!));
}

/** Reads any MusicXML file, compressed or not, into source text. */
export function readMusicXmlSource(bytes: Uint8Array): string {
  return isCompressedMusicXml(bytes) ? extractMusicXml(bytes) : stripBom(strFromU8(bytes));
}

function rootFilePath(entries: Record<string, Uint8Array>): string | undefined {
  const container = entries['META-INF/container.xml'];
  if (container === undefined) return undefined;
  const root = parseXml(strFromU8(container))[0];
  if (root === undefined) return undefined;
  const rootFiles = child(root, 'rootfiles');
  if (rootFiles === undefined) return undefined;
  for (const rootFile of children(rootFiles, 'rootfile')) {
    const path = attr(rootFile, 'full-path');
    if (path !== undefined && entries[path] !== undefined) return path;
  }
  return undefined;
}

function fallbackPath(entries: Record<string, Uint8Array>): string | undefined {
  return Object.keys(entries).find(
    (path) => !path.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(path),
  );
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
