import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function XTermTerminal({ dataChannel, historyData }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        black: '#21262d',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#ffffff'
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      disableStdin: true, // We handle input separately via our ChatInput
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Write any initial history we already got
    if (historyData) {
      term.write(historyData);
    }

    const handleResize = () => {
      fitAddon.fit();
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []); // Run once on mount

  // Subscribe to dataChannel messages
  useEffect(() => {
    if (!dataChannel) return;
    
    const handleMessage = (e) => {
      try {
        const packet = JSON.parse(e.data);
        if (packet.type === 'stream' || packet.type === 'history') {
          xtermRef.current?.write(packet.data);
        }
      } catch {
        // Fallback for raw text
        xtermRef.current?.write(e.data);
      }
    };

    dataChannel.addEventListener('message', handleMessage);
    
    return () => {
      dataChannel.removeEventListener('message', handleMessage);
    };
  }, [dataChannel]);

  return (
    <div 
      ref={terminalRef} 
      className="xterm-container" 
      style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '8px' }} 
    />
  );
}
