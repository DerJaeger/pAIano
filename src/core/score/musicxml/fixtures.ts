/**
 * The fixture corpus: minimal MusicXML documents, each a named musical edge
 * case. Everything downstream trusts the event stream these produce, so this
 * is the highest-value test data in the project — every parser bug should
 * arrive here as a new fixture first.
 *
 * They are TypeScript rather than files so the tests stay dependency-free and
 * the musical intent can sit right next to the markup as a comment.
 */

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`;

interface ScoreOptions {
  title?: string;
  parts?: { id: string; name: string }[];
}

/** Wraps measure markup in the boilerplate a `score-partwise` document needs. */
export function score(measuresByPart: string[][], options: ScoreOptions = {}): string {
  const parts = options.parts ?? measuresByPart.map((_, i) => ({ id: `P${i + 1}`, name: 'Piano' }));
  const partList = parts
    .map((part) => `<score-part id="${part.id}"><part-name>${part.name}</part-name></score-part>`)
    .join('\n    ');
  const partBodies = measuresByPart
    .map(
      (measures, i) =>
        `<part id="${parts[i]!.id}">\n${measures.map((m, index) => wrapMeasure(m, index + 1)).join('\n')}\n</part>`,
    )
    .join('\n');
  return `${HEADER}
<score-partwise version="3.1">
  <work><work-title>${options.title ?? 'Fixture'}</work-title></work>
  <part-list>
    ${partList}
  </part-list>
  ${partBodies}
</score-partwise>`;
}

function wrapMeasure(inner: string, number: number): string {
  return inner.trimStart().startsWith('<measure')
    ? inner
    : `<measure number="${String(number)}">${inner}</measure>`;
}

/** `<attributes>` with the given divisions, plus optional time/key/staves. */
export function attributes(
  divisions: number,
  options: { beats?: number; beatType?: number; fifths?: number; staves?: number } = {},
): string {
  const { beats = 4, beatType = 4, fifths = 0, staves } = options;
  return `<attributes>
    <divisions>${String(divisions)}</divisions>
    <key><fifths>${String(fifths)}</fifths></key>
    <time><beats>${String(beats)}</beats><beat-type>${String(beatType)}</beat-type></time>
    ${staves === undefined ? '' : `<staves>${String(staves)}</staves>`}
    <clef><sign>G</sign><line>2</line></clef>
  </attributes>`;
}

interface NoteOptions {
  chord?: boolean;
  staff?: number;
  voice?: string;
  tie?: 'start' | 'stop' | 'continue';
  type?: string;
  dot?: boolean;
  timeMod?: [actual: number, normal: number];
  id?: string;
  grace?: boolean;
}

/** A pitched note, e.g. `note('C', 4, 4)` for a C4 lasting 4 divisions. */
export function note(
  step: string,
  octave: number,
  duration: number,
  options: NoteOptions = {},
): string {
  const alter = step.includes('#') ? 1 : step.includes('b') ? -1 : 0;
  const letter = step[0]!;
  const ties =
    options.tie === 'continue'
      ? '<tie type="stop"/><tie type="start"/>'
      : options.tie
        ? `<tie type="${options.tie}"/>`
        : '';
  const tied =
    options.tie === 'continue'
      ? '<notations><tied type="stop"/><tied type="start"/></notations>'
      : options.tie
        ? `<notations><tied type="${options.tie}"/></notations>`
        : '';
  return `<note${options.id === undefined ? '' : ` id="${options.id}"`}>
    ${options.grace ? '<grace/>' : ''}
    ${options.chord ? '<chord/>' : ''}
    <pitch><step>${letter}</step>${alter === 0 ? '' : `<alter>${String(alter)}</alter>`}<octave>${String(octave)}</octave></pitch>
    ${options.grace ? '' : `<duration>${String(duration)}</duration>`}
    ${ties}
    <voice>${options.voice ?? '1'}</voice>
    ${options.type === undefined ? '' : `<type>${options.type}</type>`}
    ${options.dot ? '<dot/>' : ''}
    ${options.timeMod === undefined ? '' : `<time-modification><actual-notes>${String(options.timeMod[0])}</actual-notes><normal-notes>${String(options.timeMod[1])}</normal-notes></time-modification>`}
    ${options.staff === undefined ? '' : `<staff>${String(options.staff)}</staff>`}
    ${tied}
  </note>`;
}

export function rest(duration: number, options: { staff?: number; voice?: string } = {}): string {
  return `<note><rest/><duration>${String(duration)}</duration><voice>${options.voice ?? '1'}</voice>${
    options.staff === undefined ? '' : `<staff>${String(options.staff)}</staff>`
  }</note>`;
}

export function backup(duration: number): string {
  return `<backup><duration>${String(duration)}</duration></backup>`;
}

export function forward(duration: number): string {
  return `<forward><duration>${String(duration)}</duration></forward>`;
}

export function tempo(bpm: number): string {
  return `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${String(bpm)}</per-minute></metronome></direction-type><sound tempo="${String(bpm)}"/></direction>`;
}

export function repeatForward(): string {
  return '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>';
}

export function repeatBackward(times?: number): string {
  return `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"${
    times === undefined ? '' : ` times="${String(times)}"`
  }/></barline>`;
}

export function endingStart(numbers: string): string {
  return `<barline location="left"><ending number="${numbers}" type="start"/></barline>`;
}

export function endingStop(numbers: string): string {
  return `<barline location="right"><ending number="${numbers}" type="stop"/></barline>`;
}

export function soundDirective(attrs: string): string {
  return `<direction placement="above"><direction-type><words>jump</words></direction-type><sound ${attrs}/></direction>`;
}
