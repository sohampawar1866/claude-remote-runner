import { useState, useRef } from 'react';

const QUICK_REPLIES = [
  { label: '✓ Yes', value: 'Yes', cls: 'yes' },
  { label: '✕ No', value: 'No', cls: 'no' },
];

export default function ChatInput({ onSend, isSending, disabled }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!value.trim() || disabled || isSending) return;
    const success = await onSend(value.trim());
    if (success) {
      setValue('');
      inputRef.current?.focus();
    }
  };

  const handleQuick = (reply) => {
    if (disabled || isSending) return;
    onSend(reply);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="input-area">
      {/* Quick Reply Buttons */}
      <div className="quick-replies">
        {QUICK_REPLIES.map(({ label, value: v, cls }) => (
          <button
            key={v}
            className={`quick-btn ${cls}`}
            onClick={() => handleQuick(v)}
            disabled={disabled || isSending}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Text Input Row */}
      <form onSubmit={handleSubmit}>
        <div className="input-row">
          <input
            ref={inputRef}
            className="text-input"
            type="text"
            placeholder="Type a response…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isSending}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <button
            type="submit"
            className={`send-btn ${isSending ? 'sending' : ''}`}
            disabled={!value.trim() || disabled || isSending}
            title="Send"
          >
            {isSending ? (
              /* Spinner */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              /* Send arrow */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
