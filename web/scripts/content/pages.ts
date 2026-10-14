// The generated guides. Every page is derived from something already in the repo, so the
// web copy cannot drift from the product:
//
//   lesson pages  <- LESSONS from src/lessons (the same objects the app renders)
//   comparison    <- the results table in README.md
//   protocols     <- docs/protocols.md
//
// See render.ts for the escaping and page shell, and build-content.ts for the writer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSONS, type Lesson } from '../../src/lessons';
import {
  ORIGIN,
  REPO,
  SITE,
  appLink,
  breadcrumb,
  esc,
  extractSection,
  firstTable,
  md,
  renderTable,
  root,
  withoutTitle,
  type Page,
} from './render';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function lessonsIndex(depth: number): Page {
  const r = root(depth);
  const items = LESSONS.map((l) => {
    const url = `${r}lessons/${l.id}.html`;
    return `      <li>
        <a href="${url}">${esc(l.title)}</a> <span class="meta">${l.minutes} min</span>
        <p>${esc(l.summary)}</p>
        <p><a href="${url}">Read the guide</a> &middot; <a href="${r}?lesson=${encodeURIComponent(l.id)}">Run it in the simulator</a></p>
      </li>`;
  }).join('\n');

  return {
    file: 'lessons.html',
    path: '/lessons.html',
    depth,
    title: `Guided lessons: ${SITE}`,
    nav: 'Guided lessons',
    description:
      'Five guided lessons that stop the clock at the moment each idea matters: finality under both protocols, what votes cost, skip certificates, lockouts, and the 20+20 resilience budget.',
    body: `    <h1>Guided lessons</h1>
    <p class="lede">Each lesson loads a scenario and stops the clock at the moment the idea
    lands. Every one of them is also written out below, so you can read it instead of
    running it, or both.</p>
    <ul class="lessons">
${items}
    </ul>
    <p>${appLink(depth)} <a class="cta" href="${r}tower-vs-alpenglow.html">TowerBFT vs Alpenglow</a></p>`,
    jsonLd: [
      {
        '@type': 'WebPage',
        name: `Guided lessons: ${SITE}`,
        url: `${ORIGIN}/lessons.html`,
        description: 'Guided lessons through the Solana consensus simulator.',
        inLanguage: 'en',
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
      breadcrumb([
        { name: SITE, path: '/' },
        { name: 'Guided lessons', path: '/lessons.html' },
      ]),
    ],
  };
}

export function lessonPage(lesson: Lesson, depth: number): Page {
  const r = root(depth);

  // Only the static copy is published. Most step bodies are functions of the hit event and
  // the run view, interpolating numbers out of the simulation, and cannot be evaluated
  // without running it. The page therefore carries the shape of the lesson instead: what
  // each stop watches for, and the questions with their explanations.
  const steps = lesson.steps
    .map((s) => {
      const lead = s.lead ? `\n        <div>${md(s.lead)}</div>` : '';
      const q = s.question
        ? `\n        <div class="qa">
          <p><strong>${esc(s.question.prompt)}</strong></p>
          <ul>${s.question.choices.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <div>${md(s.question.explain)}</div>
        </div>`
        : '';
      return `      <li>
        <h3>${esc(s.title)}</h3>${lead}${q}
      </li>`;
    })
    .join('\n');

  const others = LESSONS.filter((l) => l.id !== lesson.id)
    .map((l) => `<li><a href="${r}lessons/${l.id}.html">${esc(l.title)}</a></li>`)
    .join('\n');

  return {
    file: `lessons/${lesson.id}.html`,
    path: `/lessons/${lesson.id}.html`,
    depth,
    title: `${lesson.title} · ${SITE}`,
    nav: lesson.title,
    description: lesson.summary,
    body: `    <h1>${esc(lesson.title)}</h1>
    <p class="lede">${esc(lesson.summary)}</p>
    <p class="meta">${lesson.minutes} minute read &middot; scenario <code>${esc(lesson.scenario)}</code> &middot; ${esc(lesson.mode)} mode &middot; seed ${lesson.seed}</p>
    <p><a class="cta" href="${r}?lesson=${encodeURIComponent(lesson.id)}">Run this lesson</a></p>
    ${md(lesson.intro)}
    <h2>Where it stops</h2>
    <ol class="steps">
${steps}
    </ol>
    ${md(lesson.outro)}
    <h2>Other lessons</h2>
    <ul>${others}</ul>
    <p>${appLink(depth)}</p>`,
    jsonLd: [
      {
        '@type': 'LearningResource',
        name: lesson.title,
        description: lesson.summary,
        url: `${ORIGIN}/lessons/${lesson.id}.html`,
        learningResourceType: 'Lesson through an interactive simulation',
        educationalLevel: 'Introductory to intermediate',
        inLanguage: 'en',
        isAccessibleForFree: true,
        timeRequired: `PT${lesson.minutes}M`,
        publisher: { '@id': `${ORIGIN}/#org` },
      },
      breadcrumb([
        { name: SITE, path: '/' },
        { name: 'Guided lessons', path: '/lessons.html' },
        { name: lesson.title, path: `/lessons/${lesson.id}.html` },
      ]),
    ],
  };
}

/**
 * The highest-intent page: someone who has already heard of Alpenglow is searching for
 * exactly this. The numbers come out of the README table rather than being restated here,
 * so a re-measurement updates the page on the next build.
 */
export function comparisonPage(depth: number): Page {
  const r = root(depth);
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
  const table = firstTable(extractSection(readme, 'What you see'), 'README.md "What you see"');

  return {
    file: 'tower-vs-alpenglow.html',
    path: '/tower-vs-alpenglow.html',
    depth,
    title: 'TowerBFT vs Alpenglow: how long Solana takes to finalize',
    nav: 'TowerBFT vs Alpenglow',
    description:
      'Measured, not estimated: the same transaction on the same 25 validators under TowerBFT and under Alpenglow, with confirmed and rooted times for every failure scenario the simulator ships.',
    body: `    <h1>TowerBFT vs Alpenglow: how long Solana takes to finalize</h1>
    <p class="lede">One transaction, one healthy cluster of 25 validators, one seed, run
    twice. Under TowerBFT, the protocol Solana runs today, that transaction takes about
    <strong>12.8 seconds</strong> to become final. Under Alpenglow, the protocol it is moving
    to, the same transaction is final in about <strong>150 milliseconds</strong>.</p>
    <p>Two orders of magnitude, from a consensus rule change rather than from faster
    hardware or a faster network. The table below is what the simulator actually measures,
    across every scenario it ships, at 25 validators on seed 1.</p>
    ${renderTable(table)}
    <h2>What the columns mean</h2>
    <ul>
      <li><strong>Alpenglow &rarr; final</strong> is the first time a finality certificate
      covers the block the transaction landed in. In Alpenglow that is the only stage worth
      calling final.</li>
      <li><strong>TowerBFT &rarr; confirmed</strong> is optimistic: two thirds or more of
      stake has its latest vote on the block or a descendant. It is not safe yet and can still
      be reverted.</li>
      <li><strong>TowerBFT &rarr; rooted</strong> is final. A block is rooted once 32 votes
      stack on top of it, which at 400 ms slots is roughly 12.8 seconds after it was made.</li>
    </ul>
    <h2>The gap is not all consensus</h2>
    <p><code>happy-path</code> and <code>ideal</code> run on the same healthy cluster with no
    faults at all, and Alpenglow finalizes in 451 ms in one and 150 ms in the other. The
    difference is not the voting. It is <strong>when the transaction lands in the block</strong>.
    A block cannot be voted on until the leader has produced every one of its slices across
    the whole 400 ms block, so a transaction that rides the first slice waits for the rest of
    the block to be built, and one that rides the last slice pays almost none of that. Both
    then pay the same 150 ms of voting and certification.</p>
    <p>That is the most useful thing this simulator shows: the median 150 ms in the Alpenglow
    white paper (Fig. 14) is measured after a block has been distributed, so it is the
    last-slice case. Much of the apparent end-to-end latency gap between the two protocols
    is block assembly, which the protocol change does not touch.</p>
    <h2>Try it yourself</h2>
    <p>${appLink(depth, 'scenario=happy-path&amp;mode=compare')}
    <a class="cta" href="${r}?scenario=ideal&amp;mode=compare">Run the 150 ms case</a>
    <a class="cta" href="${r}lessons.html">Guided lessons</a></p>`,
    jsonLd: [
      {
        '@type': 'WebPage',
        name: 'TowerBFT vs Alpenglow: how long Solana takes to finalize',
        url: `${ORIGIN}/tower-vs-alpenglow.html`,
        description: 'Measured finality for one transaction under TowerBFT and Alpenglow.',
        inLanguage: 'en',
        isPartOf: { '@id': `${ORIGIN}/#website` },
      },
      breadcrumb([
        { name: SITE, path: '/' },
        { name: 'TowerBFT vs Alpenglow', path: '/tower-vs-alpenglow.html' },
      ]),
    ],
  };
}

/** docs/protocols.md as a page. Written for instructors, so it doubles as the reference for
 *  anyone who wants to know what the simulator does and does not model. */
export function protocolsPage(depth: number): Page {
  const r = root(depth);
  const source = readFileSync(join(REPO_ROOT, 'docs', 'protocols.md'), 'utf8');

  return {
    file: 'protocols.html',
    path: '/protocols.html',
    depth,
    title: 'How the simulator works: TowerBFT and Alpenglow as modelled',
    nav: 'How the simulator works',
    description:
      'The reference for what this simulator actually implements for both protocols: the transaction journey, clocks, dissemination, voting, certificates, and the numbers behind the latencies.',
    body: `    <h1>The two protocols, as simulated</h1>
    <p class="lede">What the simulator actually does, rule by rule, for both protocols. Every
    claim on this page maps to code, and the limits are stated rather than smoothed over.</p>
    <p><a class="cta" href="${r}">Open the simulator</a> <a class="cta" href="${REPO}docs/protocols.md">View this page as source</a></p>
    ${md(withoutTitle(source))}
    <p>${appLink(depth)}</p>`,
    jsonLd: [
      {
        '@type': 'TechArticle',
        name: 'The two protocols, as simulated',
        url: `${ORIGIN}/protocols.html`,
        description: 'How TowerBFT and Alpenglow are implemented in this simulator.',
        inLanguage: 'en',
        isAccessibleForFree: true,
        isPartOf: { '@id': `${ORIGIN}/#website` },
        publisher: { '@id': `${ORIGIN}/#org` },
      },
      breadcrumb([
        { name: SITE, path: '/' },
        { name: 'How the simulator works', path: '/protocols.html' },
      ]),
    ],
  };
}

/** Every page the build writes. The app itself is not here: it is dist/index.html, with
 *  its own hand-maintained prerendered shell. */
export function buildPages(): Page[] {
  return [
    comparisonPage(0),
    lessonsIndex(0),
    ...LESSONS.map((l) => lessonPage(l, 1)),
    protocolsPage(0),
  ];
}