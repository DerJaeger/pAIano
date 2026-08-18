import { attr, child, childText, children, parseXml, textOf, type XmlNode } from '../xml/xml';

/** What the library list shows about a piece, without reading the music. */
export interface ScoreMetadata {
  title?: string;
  composer?: string;
}

/**
 * Reads just the title and composer out of a MusicXML document.
 *
 * Deliberately not `parseMusicXml`: building the full repeat-expanded event
 * stream for 84 files to put names in a list would make the thing this index
 * exists to avoid — a slow startup — happen anyway.
 *
 * Never throws. The scan trusts file extensions and an extension can lie; one
 * unreadable file must not take the other 83 down with it.
 */
export function readMetadata(source: string): ScoreMetadata {
  let root: XmlNode | undefined;
  try {
    root =
      parseXml(source).find((node) => child(node, 'part-list') !== undefined) ??
      parseXml(source)[0];
  } catch {
    return {};
  }
  if (!root) return {};

  const metadata: ScoreMetadata = {};
  const title = readTitle(root);
  if (title !== undefined) metadata.title = title;
  const composer = readComposer(root);
  if (composer !== undefined) metadata.composer = composer;
  return metadata;
}

function readTitle(root: XmlNode): string | undefined {
  const work = child(root, 'work');
  // MuseScore writes the title as a credit when the work element is empty, so
  // all three are tried in the order a human would read them.
  return (
    clean(work ? childText(work, 'work-title') : undefined) ??
    clean(childText(root, 'movement-title')) ??
    clean(
      children(root, 'credit')[0]
        ? childText(children(root, 'credit')[0]!, 'credit-words')
        : undefined,
    )
  );
}

function readComposer(root: XmlNode): string | undefined {
  const identification = child(root, 'identification');
  if (!identification) return undefined;
  const composer = children(identification, 'creator').find(
    (creator) => attr(creator, 'type') === 'composer',
  );
  return composer ? clean(textOf(composer)) : undefined;
}

/** Blank is the same as absent: an empty title in a list is worse than a file name. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
