import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { attributes, note, score } from '../src/core/score/musicxml/fixtures';

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
  await page.goto('/');
  await page.getByLabel('Open a score').setInputFiles({
    name: 'three-bars.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(musicXml, 'utf8'),
  });
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
  await page.goto('/');
  await page.getByLabel('Open a score').setInputFiles({
    name: 'many-bars.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(manyBars, 'utf8'),
  });

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

/**
 * `samples/` holds copyrighted arrangements and is git-ignored, so this runs
 * locally — where a real MuseScore export is the actual acceptance criterion —
 * and skips in CI.
 */
const samplePath = fileURLToPath(new URL('../samples/adele-skyfall.mxl', import.meta.url));

test.describe(() => {
  test.skip(!existsSync(samplePath), 'no local MuseScore export to render');

  test('renders a real MuseScore export and jumps to a late bar', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open a score').setInputFiles(samplePath);

    await expect(page.locator('.sheet svg').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Bar 1 of 89')).toBeVisible();
    await expect(highlighted(page).first()).toBeVisible();

    await page.getByLabel('Bar').fill('60');
    await expect(page.getByText('Bar 61 of 89')).toBeVisible();
    await expect(highlighted(page).first()).toBeVisible();
  });
});
