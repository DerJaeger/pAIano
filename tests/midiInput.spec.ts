import { expect, test } from '@playwright/test';
import { play, stubMidiKeyboard } from './midiStub';

test('shows the notes you play on a connected MIDI keyboard', async ({ page }) => {
  await stubMidiKeyboard(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await expect(page.getByRole('combobox', { name: /device/i })).toHaveValue('stub-1');
  await expect(page.getByRole('img', { name: 'No keys down' })).toBeVisible();

  await play(page, [0x90, 60, 100]); // C4 down
  await play(page, [0x90, 67, 100]); // G4 down
  await expect(page.getByRole('img', { name: 'Sounding: C4, G4' })).toBeVisible();

  await play(page, [0xb0, 64, 127]); // sustain pedal down
  await play(page, [0x90, 60, 0]); // C4 up, via note-on velocity 0
  await expect(page.getByText('C4 · G4 — sustain')).toBeVisible();

  await play(page, [0x80, 67, 0]); // G4 up
  await play(page, [0xb0, 64, 0]); // pedal up
  await expect(page.getByRole('img', { name: 'No keys down' })).toBeVisible();
});
