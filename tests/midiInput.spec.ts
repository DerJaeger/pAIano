import { expect, test, type Page } from '@playwright/test';

/**
 * Web MIDI needs hardware and a permission prompt, so we install a stub before
 * the page loads and play it from the test. This exercises the real adapter,
 * the real audio clock and the real UI — only the keyboard is fake.
 */
async function stubMidiKeyboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const input = {
      id: 'stub-1',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null,
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      onstatechange: null,
    };

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
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

const play = (page: Page, bytes: number[]) =>
  page.evaluate(
    (data) => (window as unknown as { midiStub: { send(b: number[]): void } }).midiStub.send(data),
    bytes,
  );

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
