import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { attributes, backup, note, score } from '../src/core/score/musicxml/fixtures';
import { openPiece, stubMusicFolder } from './musicFolder';
import { play, stubMidiKeyboard } from './midiStub';

/**
 * Phase 3's acceptance journey: a MusicXML score is engraved in the browser and
 * the cursor can be driven to any bar. The colouring assertions also pin down
 * the structural mapping from our note stream to what OSMD drew — if that
 * mapping breaks, nothing turns green here.
 */

const HIGHLIGHT = '#2f6f4f';

/** Three bars: four quarters, then a whole note, then a two-note chord. */
const musicXml = score(
  [
    [
      `${attributes(1)}${note('C', 4, 1)}${note('D', 4, 1)}${note('E', 4, 1)}${note('F', 4, 1)}`,
      note('G', 4, 4),
      `${note('C', 4, 4)}${note('E', 4, 4, { chord: true })}`,
    ],
  ],
  { title: 'Three Bars' },
);

async function openScore(page: Page): Promise<void> {
  await stubMusicFolder(page, { 'three-bars.musicxml': musicXml });
  await page.goto('/');
  await openPiece(page, 'three-bars');
}

const highlighted = (page: Page) => page.locator(`.sheet svg [fill="${HIGHLIGHT}"]`);

test('engraves a score and drives the cursor to any bar', async ({ page }) => {
  await openScore(page);

  await expect(page.locator('.sheet svg')).toBeVisible();
  await expect(page.getByText('Engraving the score…')).toBeHidden();
  await expect(page.getByText('Bar 1 of 3')).toBeVisible();
  await expect(page.locator('.sheet .playhead')).toBeVisible();

  // Bar 1 holds four notes; each notehead is one coloured path.
  await expect(highlighted(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Next bar' }).click();
  await expect(page.getByText('Bar 2 of 3')).toBeVisible();
  await expect(highlighted(page)).toHaveCount(1);

  // The chord in bar 3 highlights both of its notes.
  await page.getByRole('button', { name: 'Next bar' }).click();
  await expect(page.getByText('Bar 3 of 3')).toBeVisible();
  await expect(highlighted(page)).toHaveCount(2);

  await expect(page.getByRole('button', { name: 'Next bar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous bar' }).click();
  await expect(page.getByText('Bar 2 of 3')).toBeVisible();
});

/** Long enough to be engraved over more lines than fit in the window. */
const manyBars = score(
  [[`${attributes(1)}${note('C', 4, 4)}`, ...Array.from({ length: 47 }, () => note('C', 4, 4))]],
  { title: 'Many Bars' },
);

test('shows a window of lines and scrolls it as the score moves on', async ({ page }) => {
  await stubMusicFolder(page, { 'many-bars.musicxml': manyBars });
  await page.goto('/');
  await openPiece(page, 'many-bars');

  const sheet = page.locator('.sheet');
  await expect(sheet.locator('svg').first()).toBeVisible();
  const scrollTop = () => sheet.evaluate((element) => element.scrollTop);

  // Only part of the engraved page is on screen, starting at the top.
  const sheetBox = await sheet.boundingBox();
  const pageBox = await sheet.locator('svg').first().boundingBox();
  expect(sheetBox!.height).toBeLessThan(pageBox!.height);
  const atTheTop = await scrollTop();

  // Moving down the score scrolls the window rather than growing it.
  await page.getByLabel('Bar').fill('40');
  await expect(page.getByText('Bar 41 of 48')).toBeVisible();
  expect(await scrollTop()).toBeGreaterThan(atTheTop);
  expect((await sheet.boundingBox())!.height).toBeLessThan(pageBox!.height);
});

test('keeps the highlight after zooming', async ({ page }) => {
  await openScore(page);
  await expect(highlighted(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('125%')).toBeVisible();
  await expect(page.locator('.sheet svg')).toBeVisible();
  await expect(highlighted(page)).toHaveCount(4);
});

test('writes the note names on the sheet on request', async ({ page }) => {
  await openScore(page);
  await expect(page.locator('.note-label')).toHaveCount(0);

  await page.getByLabel('Note names').check();
  // Seven notes: four in bar 1, the whole note, and both notes of the chord.
  await expect(page.locator('.note-label')).toHaveCount(7);
  await expect(page.locator('.note-label').first()).toHaveText('C');

  // A redraw does not lose them: they are ours, not part of the engraving.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('125%')).toBeVisible();
  await expect(page.locator('.note-label')).toHaveCount(7);

  await page.getByLabel('Note names').uncheck();
  await expect(page.locator('.note-label')).toHaveCount(0);
});

test('colours the notes by pitch on request', async ({ page }) => {
  await openScore(page);
  await expect(highlighted(page)).toHaveCount(4);

  await page.getByLabel('Colour by pitch').check();
  // Pitch colours replace the bar highlight rather than fighting it, and each
  // of C, D, E, F, G gets its own — the C in bar 3 shares the C in bar 1.
  await expect(highlighted(page)).toHaveCount(0);
  for (const color of ['#d32f2f', '#ef6c00', '#7f8400', '#4c8a1f', '#00786e']) {
    await expect(page.locator(`.sheet svg [fill="${color}"]`).first()).toBeVisible();
  }

  await page.getByLabel('Colour by pitch').uncheck();
  await expect(highlighted(page)).toHaveCount(4);
  await expect(page.locator('.sheet svg [fill="#d32f2f"]')).toHaveCount(0);
});

/** A grand staff, so a held key has to pick a hand to be drawn on. */
const grandStaff = score([
  [
    `<attributes>
      <divisions>1</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef>
    </attributes>
    ${note('G', 4, 4, { staff: 1 })}${backup(4)}${note('C', 3, 4, { staff: 2 })}`,
  ],
]);

test('draws the keys you are holding on the staff at their own pitch', async ({ page }) => {
  await stubMidiKeyboard(page);
  await stubMusicFolder(page, { 'grand-staff.musicxml': grandStaff });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await openPiece(page, 'grand-staff');
  await expect(page.locator('.sheet svg')).toBeVisible();

  const bar = (midiNote: number) => page.locator(`.held-note[data-note="${String(midiNote)}"]`);
  const topOf = (midiNote: number) =>
    bar(midiNote).evaluate((element) => (element as HTMLElement).offsetTop);

  await play(page, [0x90, 67, 100]); // G4, on the right hand's staff
  await play(page, [0x90, 48, 100]); // C3, on the left hand's
  await expect(bar(67)).toBeVisible();
  await expect(bar(48)).toBeVisible();
  expect(await topOf(67)).toBeLessThan(await topOf(48));

  // A sharp is written on its letter's line, so F♯4 sits below the G above it.
  await play(page, [0x90, 66, 100]);
  expect(await topOf(66)).toBeGreaterThan(await topOf(67));

  await play(page, [0x80, 67, 0]);
  await play(page, [0x80, 66, 0]);
  await expect(bar(67)).toHaveCount(0);
  await expect(bar(48)).toBeVisible(); // still held

  // Switching the aid off takes the bars away even with keys still down.
  await page.getByLabel('Show what I play').uncheck();
  await expect(page.locator('.held-note')).toHaveCount(0);
});

/**
 * `samples/` holds copyrighted arrangements and is git-ignored, so this runs
 * locally — where a real MuseScore export is the actual acceptance criterion —
 * and skips in CI.
 */
const samplePath = fileURLToPath(new URL('../samples/adele-skyfall.mxl', import.meta.url));

test.describe(() => {
  test.skip(!existsSync(samplePath), 'no local MuseScore export to render');

  test('renders a real MuseScore export and jumps to a late bar', async ({ page }) => {
    await stubMusicFolder(page, {
      'adele-skyfall.mxl': { base64: readFileSync(samplePath).toString('base64') },
    });
    await page.goto('/');
    await openPiece(page, 'skyfall');

    await expect(page.locator('.sheet svg').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Bar 1 of 89')).toBeVisible();
    await expect(highlighted(page).first()).toBeVisible();

    await page.getByLabel('Bar').fill('60');
    await expect(page.getByText('Bar 61 of 89')).toBeVisible();
    await expect(highlighted(page).first()).toBeVisible();
  });
});
