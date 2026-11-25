import { useState } from 'react';
import { CHAPTERS, MODEL_DOC_URL, type ChapterId } from './content/lecture';
import { ChapterMemory } from './chapters/ChapterMemory';
import { ChapterBuild } from './chapters/ChapterBuild';
import { ChapterExecute } from './chapters/ChapterExecute';

function initialChapter(): ChapterId {
  const wanted = new URLSearchParams(window.location.search).get('ch');
  const found = CHAPTERS.find((chapter) => chapter.id === wanted);
  return found ? found.id : 'memory';
}

export function App() {
  const [chapter, setChapter] = useState<ChapterId>(initialChapter);

  function select(id: ChapterId) {
    setChapter(id);
    const url = new URL(window.location.href);
    url.searchParams.set('ch', id);
    window.history.replaceState(null, '', url);
    window.scrollTo(0, 0);
  }

  return (
    <div className="svm-page">
      <header className="svm-top">
        <a className="svm-brand" href="../">
          <span className="svm-mark" aria-hidden="true">SVM</span>
          <span className="svm-brand-text">
            <b>Solana Consensus Lab</b>
            <small>Lecture 5 · memory and execution</small>
          </span>
        </a>
        <nav className="svm-top-links" aria-label="Elsewhere">
          <a href="../">Consensus simulator</a>
          <a href={MODEL_DOC_URL} target="_blank" rel="noreferrer">Model notes</a>
          <a href="https://github.com/AkashJana18/solana-consensus-lab" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <nav className="svm-chapters" aria-label="Chapters">
        {CHAPTERS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={item.id === chapter ? 'on' : ''}
            aria-current={item.id === chapter ? 'step' : undefined}
            onClick={() => select(item.id)}
          >
            <span className="svm-chapter-num">{item.number}</span>
            <span className="svm-chapter-text">
              <small>{item.kicker}</small>
              <b>{item.title}</b>
            </span>
            <span className="svm-chapter-line" aria-hidden="true" data-last={index === CHAPTERS.length - 1} />
          </button>
        ))}
      </nav>

      <main className="svm-main">
        {chapter === 'memory' ? <ChapterMemory /> : null}
        {chapter === 'build' ? <ChapterBuild /> : null}
        {chapter === 'execute' ? <ChapterExecute /> : null}
      </main>

      <footer className="svm-foot">
        <p>
          A free, open-source teaching lab for Solana education programs. Apache-2.0.
          The model is a deliberate subset, and every number carries its provenance.
        </p>
        <nav aria-label="More">
          <a href="../lessons.html">Consensus lessons</a>
          <a href="../protocols.html">Protocol reference</a>
          <a href={MODEL_DOC_URL} target="_blank" rel="noreferrer">Model notes</a>
        </nav>
      </footer>
    </div>
  );
}
