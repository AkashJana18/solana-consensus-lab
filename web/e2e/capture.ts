import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

/**
 * Capture one of the checked-in screenshots in `e2e/screenshots/`.
 *
 * The README embeds these two PNGs, so they are tracked. Writing them on every run left
 * the tree dirty after any change at all, antialiasing included, which is noise you
 * learn to ignore and then it hides a real change. So the write is opt-in:
 *
 *   UPDATE_SCREENSHOTS=1 bun run e2e
 *
 * The screenshot is still taken either way, so a run keeps exercising the paint path and
 * still fails if the page cannot be captured. Only the file write is conditional.
 */
export async function capture(page: Page, name: string): Promise<void> {
  const png = await page.screenshot({ fullPage: false });
  if (process.env.UPDATE_SCREENSHOTS !== '1') return;
  await writeFile(`e2e/screenshots/${name}`, png);
}
