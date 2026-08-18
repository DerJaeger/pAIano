import { expect, test, type Page } from '@playwright/test';
import { attributes, note, score, tempo } from '../src/core/score/musicxml/fixtures';
import { stubMidiKeyboard } from './midiStub';

/**
 * Phase 6b's acceptance journey: find, start, loop and restart a piece without
 * touching the mouse.
 */

/** Four bars of one note each, so bar navigation has somewhere to go. */
const musicXml = score(
  [
    [
      tempo(120) + attributes(1) + note('C', 4, 4),
      note('D', 4, 4),
      note('E', 4, 4),
      note('F', 4, 4),
    ],
  ],
  { title: 'Four Bars' },
);

async function openAndConnect(page: Page): Promise<void> {
  await stubMidiKeyboard(page, { withOutput: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await page.getByLabel('Open a score').setInputFiles({
    name: 'four-bars.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(musicXml, 'utf8'),
  });
  await expect(page.locator('.sheet svg')).toBeVisible();
  // Click the heading, not the page: clicking the sheet seeks to a bar, and
  // this only needs focus off the file input so keys reach the window.
  await page.getByRole('heading', { name: 'Web PianoBooster' }).click();
}

test('drives the transport from the computer keyboard', async ({ page }) => {
  await openAndConnect(page);

  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Bar 2 of 4')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Bar 1 of 4')).toBeVisible();
});

test('loops and unloops the current bar from the keyboard', async ({ page }) => {
  await openAndConnect(page);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('l');
  await expect(page.getByText('Looping bar 2')).toBeVisible();

  await page.keyboard.press('l');
  await expect(page.getByText('Looping bar 2')).toBeHidden();
});

test('flips the guide switch from the keyboard, and remembers it', async ({ page }) => {
  await openAndConnect(page);
  const guideSwitch = page.getByRole('checkbox', { name: 'Send guide to MIDI out' });
  await expect(guideSwitch).toBeChecked();

  await page.keyboard.press('g');

  await expect(guideSwitch).not.toBeChecked();

  await page.reload();
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await page.getByLabel('Open a score').setInputFiles({
    name: 'four-bars.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(musicXml, 'utf8'),
  });

  // The shortcut persists the same way the checkbox does, because both go
  // through the transport.
  await expect(page.getByRole('checkbox', { name: 'Send guide to MIDI out' })).not.toBeChecked();
});

test('shows a cheat sheet, and lets a shortcut be moved', async ({ page }) => {
  await openAndConnect(page);

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Change the key for Next bar' }).click();
  await page.keyboard.press('j');
  await expect(sheet.getByRole('button', { name: 'Change the key for Next bar' })).toHaveText('J');

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole('heading', { name: 'Web PianoBooster' }).click();
  await page.keyboard.press('j');
  await expect(page.getByText('Bar 2 of 4')).toBeVisible();
});

test('keeps the space bar out of the transport while a control has focus', async ({ page }) => {
  await openAndConnect(page);

  await page.getByLabel('Play through').focus();
  await page.keyboard.press('Space');

  // A space aimed at a form control is not a play command.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});
