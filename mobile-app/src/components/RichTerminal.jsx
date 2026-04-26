import { useMemo, useRef, useEffect } from 'react';
import { AnsiUp } from 'ansi_up';

const ansiUp = new AnsiUp();

export default function RichTerminal({ text }) {
  const containerRef = useRef(null);

  // Parse the terminal text to extract code blocks and ANSI text
  const blocks = useMemo(() => {
    const parsedBlocks = [];
    
    // We split by ``` to find code blocks.
    // Note: because the stream might be cut off mid-block, we handle unclosed blocks.
    const parts = text.split(/```/);
    
    parts.forEach((part, index) => {
      if (index % 2 === 0) {
        // Normal text (ANSI)
        if (part.trim() !== '') {
          parsedBlocks.push({ type: 'text', content: part });
        }
      } else {
        // Code block
        const lines = part.split('\n');
        const header = lines[0].trim();
        const codeContent = lines.slice(1).join('\n');
        
        // Strip ANSI from the code block to make it clean
        // eslint-disable-next-line no-control-regex
        const cleanCode = codeContent.replace(/\x1B\[\d+;?\d*m/g, '');
        
        parsedBlocks.push({ 
          type: 'code', 
          lang: header || 'code', 
          content: cleanCode,
          isClosed: index < parts.length - 1 // If it's the last part and an odd index, the block is unclosed
        });
      }
    });
    
    return parsedBlocks;
  }, [text]);

  // Auto-scroll to bottom when new text arrives
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks]);

  return (
    <div className="rich-terminal" ref={containerRef}>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <div 
              key={i} 
              className="terminal-text"
              dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(block.content) }} 
            />
          );
        } else {
          return (
            <div key={i} className={`code-block-container ${!block.isClosed ? 'streaming' : ''}`}>
              <div className="code-block-header">
                <span className="code-lang">{block.lang}</span>
                {!block.isClosed && <span className="typing-indicator">...</span>}
              </div>
              <pre className="code-block-body">{block.content}</pre>
            </div>
          );
        }
      })}
    </div>
  );
}
