import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function XTermTerminal({ dataChannel }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const dataChannelRef = useRef(dataChannel);

  // Keep ref in sync so resize handler always has the latest channel
  useEffect(() => {
    dataChannelRef.current = dataChannel;
  }, [dataChannel]);

  // Initialize xterm.js once on mount
  useEffect(() => {
    if (!terminalRef.current) return;

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
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 15,
      lineHeight: 1.2,
      disableStdin: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    
    // Fit immediately, then again after a short delay to account for any flex layout settling
    fitAddon.fit();
    setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        const ch = dataChannelRef.current;
        if (ch && ch.readyState === 'open') {
          ch.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
        }
      }
    }, 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      fitAddon.fit();
      const ch = dataChannelRef.current;
      if (ch && ch.readyState === 'open') {
        ch.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    const handleOrientation = () => setTimeout(handleResize, 200);

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Subscribe to dataChannel messages — re-runs when dataChannel changes
  useEffect(() => {
    if (!dataChannel) return;

    const handleMessage = (e) => {
      try {
        const packet = JSON.parse(e.data);
        if (packet.type === 'stream' || packet.type === 'history') {
          xtermRef.current?.write(packet.data);
        }
      } catch {
        xtermRef.current?.write(e.data);
      }
    };

    dataChannel.addEventListener('message', handleMessage);

    // Send initial resize so CLI knows our dimensions
    if (dataChannel.readyState === 'open' && xtermRef.current) {
      const term = xtermRef.current;
      dataChannel.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }

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
