import { expect, test, type Page } from '@playwright/test';
import { attributes, note, score, tempo } from '../src/core/score/musicxml/fixtures';
import { openPiece, stubMusicFolder } from './musicFolder';
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
  await stubMusicFolder(page, { 'four-bars.musicxml': musicXml });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await openPiece(page, 'four-bars');
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
  await openPiece(page, 'four-bars');

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

test('counts a play only when the music actually runs', async ({ page }) => {
  await openAndConnect(page);

  // Opened but never played: the library must not call that a play.
  await page.getByRole('button', { name: /Open a piece/ }).click();
  const palette = page.getByRole('dialog', { name: 'Library' });
  await expect(palette.getByText(/played/)).toBeHidden();
  await palette.getByRole('searchbox', { name: 'Find a piece' }).press('Escape');

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /Open a piece/ }).click();
  await expect(palette.getByText(/played 1×/)).toBeVisible();
});

test('opens the library on alt+p, leaving the browser its own shortcuts', async ({ page }) => {
  await openAndConnect(page);

  await page.keyboard.press('Alt+p');

  const palette = page.getByRole('dialog', { name: 'Library' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('searchbox', { name: 'Find a piece' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
