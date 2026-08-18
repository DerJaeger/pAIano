import { expect, test, type Page } from '@playwright/test';
import { attributes, backup, note, score, tempo } from '../src/core/score/musicxml/fixtures';
import { openPiece, stubMusicFolder } from './musicFolder';

/**
 * Phase 4's acceptance journey: press play and the piece goes out to your
 * instrument. The stub stands in for the hardware and records what it was sent,
 * so this exercises the real transport, the real adapter and the real UI.
 */

/** Two bars of a grand staff at 120bpm — a right hand over a held left hand. */
const musicXml = score(
  [
    [
      tempo(120) +
        attributes(1, { staves: 2 }) +
        note('C', 5, 1, { staff: 1 }) +
        note('D', 5, 1, { staff: 1 }) +
        note('E', 5, 1, { staff: 1 }) +
        note('F', 5, 1, { staff: 1 }) +
        backup(4) +
        note('C', 3, 4, { staff: 2, voice: '2' }),
      note('G', 5, 4, { staff: 1 }) + backup(4) + note('G', 2, 4, { staff: 2, voice: '2' }),
    ],
  ],
  { title: 'Two Bars' },
);

interface SentMessage {
  data: number[];
  at: number | undefined;
}

/** A MIDI destination that records instead of making a sound. */
async function stubMidiInstrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sent: SentMessage[] = [];
    const output = {
      id: 'stub-out',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      send(data: number[], at?: number) {
        sent.push({ data: [...data], at });
      },
    };
    const input = {
      id: 'stub-in',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      onmidimessage: null,
    };

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () =>
        Promise.resolve({
          inputs: new Map([[input.id, input]]),
          outputs: new Map([[output.id, output]]),
          onstatechange: null,
        }),
    });
    Object.defineProperty(window, 'midiSent', { configurable: true, value: sent });
  });
}

/** Note-ons the app has handed to the instrument, in scheduled order. */
async function noteOns(page: Page): Promise<number[]> {
  const sent = await page.evaluate(
    () => (window as unknown as { midiSent: SentMessage[] }).midiSent,
  );
  return sent
    .filter((message) => (message.data[0]! & 0xf0) === 0x90 && message.data[2]! > 0)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .map((message) => message.data[1]!);
}

async function openAndConnect(page: Page): Promise<void> {
  await stubMidiInstrument(page);
  await stubMusicFolder(page, { 'two-bars.musicxml': musicXml });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await openPiece(page, 'two-bars');
  await expect(page.locator('.sheet svg')).toBeVisible();
}

test('plays the score out to the instrument and moves the cursor with it', async ({ page }) => {
  await openAndConnect(page);
  await expect(page.getByText('Bar 1 of 2')).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).click();

  // Bar 2 is reached two seconds in; the cursor follows the transport.
  await expect(page.getByText('Bar 2 of 2')).toBeVisible({ timeout: 5000 });

  // Both hands of bar 1: C5 D5 E5 F5 over a held C3.
  expect(await noteOns(page)).toEqual(expect.arrayContaining([48, 72, 74, 76, 77]));

  // It stops on its own at the end rather than running past it.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 5000 });
});

test('slides the playhead between the notes rather than jumping', async ({ page }) => {
  await openAndConnect(page);
  const playheadX = () =>
    page.locator('.sheet .playhead').evaluate((element) => element.getBoundingClientRect().x);

  await page.getByRole('button', { name: 'Play' }).click();
  const early = await playheadX();
  // Still well inside the first quarter note (500ms at 120bpm), so any movement
  // here is interpolation between notes, not a step from one to the next.
  await page.waitForTimeout(300);
  const later = await playheadX();

  expect(later).toBeGreaterThan(early);
  await expect(page.getByText('Bar 1 of 2')).toBeVisible();
});

test('leaves out the hand you are practising', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('checkbox', { name: 'Right hand' }).uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('Bar 2 of 2')).toBeVisible({ timeout: 5000 });

  const played = await noteOns(page);
  expect(played).toContain(48); // left hand still sounds
  expect(played).not.toContain(72); // right hand does not
});

test('pauses without leaving a note hanging', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();

  // Every channel is silenced on pause, which is what stops a held note ringing.
  const allNotesOff = await page.evaluate(() =>
    (window as unknown as { midiSent: SentMessage[] }).midiSent.filter(
      (message) => message.data[1] === 123,
    ),
  );
  expect(allNotesOff.length).toBeGreaterThanOrEqual(16);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('plays the guide nowhere when you pick no destination', async ({ page }) => {
  await openAndConnect(page);

  await page.getByLabel('Play through').selectOption('');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(500);

  expect(await noteOns(page)).toEqual([]);
});

test('switches between practising and listening mid-piece, keeping the device', async ({
  page,
}) => {
  await openAndConnect(page);
  const guideSwitch = page.getByRole('checkbox', { name: 'Send guide to MIDI out' });

  await guideSwitch.uncheck();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(600);

  // Silent while you are the one playing — but the music is still running, so
  // this is a mute, not a stop.
  expect(await noteOns(page)).toEqual([]);
  await expect(page.getByText('Bar 1 of 2')).toBeVisible();

  // Flipped back mid-piece, without going anywhere near the device picker.
  await guideSwitch.check();
  await expect(page.getByText('Bar 2 of 2')).toBeVisible({ timeout: 5000 });

  expect((await noteOns(page)).length).toBeGreaterThan(0);
  await expect(page.getByLabel('Play through')).toHaveValue('stub-out');
});

test('remembers the guide switch across a reload', async ({ page }) => {
  await openAndConnect(page);
  await page.getByRole('checkbox', { name: 'Send guide to MIDI out' }).uncheck();

  await page.reload();
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await openPiece(page, 'two-bars');

  await expect(page.getByRole('checkbox', { name: 'Send guide to MIDI out' })).not.toBeChecked();
});
