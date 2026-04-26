import { useEffect, useRef, useState } from 'react';

function formatTime(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function PromptCard({ prompt, index }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="prompt-card"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <div className="prompt-header">
        <div className="prompt-label">
          <div className="prompt-label-dot" />
          Claude is asking
        </div>
        <span className="prompt-time">{formatTime(prompt.$createdAt)}</span>
      </div>

      <div className="prompt-body">
        {prompt.content}
      </div>

      <div className="prompt-footer">
        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function PromptList({ prompts }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [prompts]);

  if (!prompts || prompts.length === 0) return null;

  return (
    <>
      {prompts.map((prompt, i) => (
        <PromptCard key={prompt.$id || i} prompt={prompt} index={i} />
      ))}
      <div ref={bottomRef} />
    </>
  );
}
