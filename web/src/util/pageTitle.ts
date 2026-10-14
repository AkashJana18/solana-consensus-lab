import { lessonById } from '../lessons';
import type { Mode } from '../store/useStore';

const MODE_LABEL: Record<Mode, string> = {
  alpenglow: 'Alpenglow',
  tower: 'TowerBFT',
  compare: 'TowerBFT vs Alpenglow',
};

/**
 * Scenario filenames are slugs (`partition-heal`), which read as noise in a search result
 * or a browser tab. Capitalise each hyphen-separated word; single letters such as the "p" in
 * `20pct` are left alone so they do not become "Pct".
 */
export function scenarioTitle(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w.length <= 1 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

export interface TitleInput {
  scenarioName: string;
  mode: Mode;
  isCustom: boolean;
  /** Active lesson id, if a lesson is open. Wins over scenario and mode. */
  lessonId?: string;
}

/**
 * The rendered document title. A share link lands on a specific scenario, protocol or
 * lesson rather than on the landing view, so the static <title> in index.html is only ever
 * right for someone who arrived at "/". This is not SSR, so it cannot help a crawler that
 * does not run JavaScript, but it is what a rendering crawler and a browser tab both show.
 */
export function pageTitle({ scenarioName, mode, isCustom, lessonId }: TitleInput): string {
  const brand = 'Solana Consensus Lab';
  if (lessonId) {
    const lesson = lessonById(lessonId);
    // An unknown lesson id in a hand-edited URL falls back to the brand rather than
    // rendering "undefined" into the tab.
    return lesson ? `${lesson.title} · ${brand}` : brand;
  }
  const scenario = isCustom ? 'Custom scenario' : scenarioTitle(scenarioName);
  return `${scenario} · ${MODE_LABEL[mode]} · ${brand}`;
}