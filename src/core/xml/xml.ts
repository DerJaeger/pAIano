/**
 * A thin, ordered view over XML.
 *
 * MusicXML is order-sensitive: within a measure, `<note>`, `<backup>`,
 * `<forward>`, `<direction>` and `<barline>` interleave and the document order
 * *is* the timeline. So we parse with `preserveOrder` and walk the resulting
 * array-of-single-key-objects shape through these helpers rather than letting
 * a name-keyed object throw the ordering away.
 */
import { XMLParser } from 'fast-xml-parser';

const ATTRS = ':@';
const ATTR_PREFIX = '@_';
const TEXT = '#text';

/** One element: exactly one element-name key, plus an optional attribute key. */
export type XmlNode = { readonly [key: string]: unknown };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
});

/**
 * Parses a document into its top-level elements, dropping the XML declaration,
 * processing instructions and doctype so callers can just take `[0]`.
 */
export function parseXml(source: string): XmlNode[] {
  const parsed = parser.parse(source) as XmlNode[];
  return parsed.filter((node) => {
    const name = nameOf(node);
    return name !== undefined && !name.startsWith('?') && !name.startsWith('!');
  });
}

/** The element name of a node, or undefined for a bare text node. */
export function nameOf(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ATTRS && key !== TEXT) return key;
  }
  return undefined;
}

/** The child elements of a node. */
export function childrenOf(node: XmlNode): XmlNode[] {
  const name = nameOf(node);
  if (name === undefined) return [];
  const value = node[name];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

export function attr(node: XmlNode, name: string): string | undefined {
  const attrs = node[ATTRS] as Record<string, unknown> | undefined;
  return scalar(attrs?.[ATTR_PREFIX + name]);
}

export function numAttr(node: XmlNode, name: string): number | undefined {
  return toNumber(attr(node, name));
}

/** The concatenated text content of a node. */
export function textOf(node: XmlNode): string {
  const direct = scalar(node[TEXT]);
  if (direct !== undefined) return direct;
  return childrenOf(node)
    .map((child) => scalar(child[TEXT]) ?? '')
    .join('');
}

/** Text and attribute values arrive as strings, numbers or booleans — never objects. */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Depth-1 lookup: the first child element with this name. */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return childrenOf(node).find((c) => nameOf(c) === name);
}

/** Depth-1 lookup: all child elements with this name, in document order. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return childrenOf(node).filter((c) => nameOf(c) === name);
}

export function has(node: XmlNode, name: string): boolean {
  return child(node, name) !== undefined;
}

export function childText(node: XmlNode, name: string): string | undefined {
  const found = child(node, name);
  return found === undefined ? undefined : textOf(found);
}

export function childNumber(node: XmlNode, name: string): number | undefined {
  return toNumber(childText(node, name));
}

/** Every descendant element with this name, in document order. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const visit = (current: XmlNode): void => {
    for (const c of childrenOf(current)) {
      if (nameOf(c) === name) found.push(c);
      visit(c);
    }
  };
  visit(node);
  return found;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
