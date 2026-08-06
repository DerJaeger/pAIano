import { expect, test, type Page } from '@playwright/test';
import { attributes, note, score, tempo } from '../src/core/score/musicxml/fixtures';

/**
 * Phase 5's acceptance journey: practise a piece and get told how it went.
 *
 * One stub device stands in for the keyboard in both directions, so this
 * exercises the real matcher, the real transport and the real UI — only the
 * hardware is fake.
 */

/** Four quarter notes at 120bpm: C4 D4 E4 F4, one per beat. */
const musicXml = score(
  [
    [
      tempo(120) +
        attributes(1) +
        note('C', 4, 1) +
        note('D', 4, 1) +
        note('E', 4, 1) +
        note('F', 4, 1),
      note('G', 4, 4),
    ],
  ],
  { title: 'Practice Piece' },
);

async function stubMidiDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const input = {
      id: 'stub-in',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null,
    };
    const output = {
      id: 'stub-out',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      send() {
        /* the guide is not what this journey is about */
      },
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

    Object.defineProperty(window, 'midiStub', {
      configurable: true,
      value: {
        send(bytes: number[]) {
          input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
        },
      },
    });
  });
}

/** Presses and releases a key, as a player would. */
async function playNote(page: Page, midiNote: number): Promise<void> {
  await page.evaluate((value) => {
    const stub = (window as unknown as { midiStub: { send(b: number[]): void } }).midiStub;
    stub.send([0x90, value, 100]);
    stub.send([0x80, value, 0]);
  }, midiNote);
}

async function openAndConnect(page: Page): Promise<void> {
  await stubMidiDevice(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a keyboard' }).click();
  await page.getByLabel('Open a score').setInputFiles({
    name: 'practice.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(musicXml, 'utf8'),
  });
  await expect(page.locator('.sheet svg')).toBeVisible();
}

test('waits for you in Follow you, and moves on when you play the note', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('radio', { name: /Follow you/ }).check();
  await page.getByRole('button', { name: 'Play' }).click();

  // The music parks on the first note however long you take over it.
  await expect(page.getByRole('status')).toContainText('Waiting for C4');
  await page.waitForTimeout(600);
  await expect(page.getByRole('status')).toContainText('Waiting for C4');

  await playNote(page, 60);
  await expect(page.getByRole('status')).toContainText('Waiting for D4');

  await playNote(page, 62);
  await expect(page.getByRole('status')).toContainText('Waiting for E4');
});

test('scores what you played in Play along', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('radio', { name: /Play along/ }).check();
  await page.getByRole('button', { name: 'Play' }).click();

  await playNote(page, 60);
  await expect(page.getByText('Last: C4 — correct')).toBeVisible();

  await playNote(page, 61);
  await expect(page.getByText('Last: C♯4 — wrong')).toBeVisible();

  const rightNotes = page.getByText('Right notes').locator('..');
  await expect(rightNotes).toContainText('50%');
});

test('blames you for the notes you never played, and shows where', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('radio', { name: /Play along/ }).check();
  await page.getByRole('button', { name: 'Play' }).click();

  // Two bars at 120bpm is four seconds; sit them out entirely.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 8000 });

  await expect(page.getByText('Right notes').locator('..')).toContainText('0%');
  await expect(page.getByRole('button', { name: /Bar 1: 4 of 4 wrong/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bar 2: 1 of 1 wrong/ })).toBeVisible();
});

test('judges nothing in Listen', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await playNote(page, 61);
  await page.waitForTimeout(300);

  await expect(page.getByText('Right notes')).toBeHidden();
});

test('sends you back to a bar you got wrong', async ({ page }) => {
  await openAndConnect(page);

  await page.getByRole('radio', { name: /Play along/ }).check();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 8000 });

  await page.getByRole('button', { name: /Bar 2:/ }).click();

  await expect(page.getByText('Bar 2 of 2')).toBeVisible();
});
