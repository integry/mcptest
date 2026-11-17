import React, { useEffect, useState } from 'react';
import { getHighlighter, loadHighlighter } from './learn/highlighter';
import './ToolResultView.css';

/** highlight.js escapes server text before adding its own token markup. */
export default function JsonCode({ text }: { text: string }) {
  const [highlighter, setHighlighter] = useState(getHighlighter);
  useEffect(() => {
    let mounted = true;
    loadHighlighter().then(value => { if (mounted) setHighlighter(value); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return highlighter
    ? <code className="language-json result-json" dangerouslySetInnerHTML={{ __html: highlighter.highlight(text, { language: 'json' }).value }} />
    : <code className="language-json result-json">{text}</code>;
}
