export async function installSyntheticVoice(page: any, transcript: string): Promise<void> {
  await page.addInitScript(() => {
    const state: { contexts: AudioContext[] } = { contexts: [] }; (window as any).syntheticToolkit = state;
    navigator.mediaDevices.getUserMedia = async () => { const context = new AudioContext(), source = context.createOscillator(), output = context.createMediaStreamDestination(); source.connect(output); source.start(); await context.resume(); state.contexts.push(context); return output.stream; };
  });
  await page.route("**/api/speech/transcribe", async (route: any) => { const body = route.request().postDataJSON(); if (!body.audio) throw new Error("Expected recorded audio"); await route.fulfill({ json: { text: transcript } }); });
}

export async function recordSyntheticVoice(page: any): Promise<void> {
  await page.locator('[data-voice="toolkit"]').click(); await page.waitForFunction(() => document.querySelector('[data-voice="toolkit"]')?.getAttribute("aria-pressed") === "true");
  const start = await page.evaluate(() => (window as any).syntheticToolkit.contexts.at(-1).currentTime);
  await page.waitForFunction((value: number) => (window as any).syntheticToolkit.contexts.at(-1).currentTime >= value + .3, start);
  await page.locator('[data-voice="toolkit"]').click(); await page.locator('.pith-shadowing-feedback').waitFor();
}
