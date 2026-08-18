import type { Page } from '@playwright/test';

/**
 * Web MIDI needs hardware and a permission prompt, so we install a stub before
 * the page loads and play it from the test. This exercises the real adapter and
 * the real UI — only the keyboard is fake.
 */
export async function stubMidiKeyboard(
  page: Page,
  { withOutput = false }: { withOutput?: boolean } = {},
): Promise<void> {
  await page.addInitScript((wantsOutput: boolean) => {
    const input = {
      id: 'stub-1',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null,
    };
    // A destination only when the test asks for one: specs about input alone
    // assert on the app's "no MIDI destination" state.
    const output = {
      id: 'stub-out',
      name: 'Stub Piano',
      manufacturer: 'Playwright',
      state: 'connected',
      send() {
        // The commands specs assert on the UI, not on what was sounded.
      },
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: wantsOutput ? new Map([[output.id, output]]) : new Map(),
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
  }, withOutput);
}

/** Sends raw MIDI bytes from the stubbed keyboard, e.g. `[0x90, 60, 100]`. */
export function play(page: Page, bytes: number[]): Promise<void> {
  return page.evaluate(
    (data) => (window as unknown as { midiStub: { send(b: number[]): void } }).midiStub.send(data),
    bytes,
  );
}
