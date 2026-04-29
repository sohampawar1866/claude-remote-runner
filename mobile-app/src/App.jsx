import { useRemoteSession } from './hooks/useRemoteSession';
import { useWebRTC } from './hooks/useWebRTC';
import PromptList from './components/PromptList';
import ChatInput from './components/ChatInput';
import XTermTerminal from './components/XTermTerminal';

/* ─── Icons ───────────────────────────────────────────────────── */

function TerminalIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  );
}

/* ─── No Session Screen ───────────────────────────────────────── */
function NoSessionScreen() {
  return (
    <div className="no-session">
      <div className="no-session-card">
        <div className="no-session-icon">
          <img src="/logo.png" alt="Remote Runner" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        </div>
        <h1 className="no-session-title">No Active Session</h1>
        <p className="no-session-desc">
          Open a secure session from your terminal to get started.
        </p>

        <div className="no-session-step">
          <div className="step-num">1</div>
          <div className="step-text">
            Run <span className="code-pill">remote-claude</span> in your terminal
          </div>
        </div>

        <div className="no-session-step">
          <div className="step-num">2</div>
          <div className="step-text">
            Scan the QR code printed in your terminal to connect instantly
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main App ────────────────────────────────────────────────── */
import { useState, useCallback } from 'react';

export default function App() {
  const { sessionId, encryptionKey, isWebRTCSession, ntfyTopic, prompts, isDisconnected, isSending, sendRemoteResponse, disconnect } = useRemoteSession();
  
  const { isWebRTCConnected, dataChannel, sendWebRTCMessage } = useWebRTC(sessionId, encryptionKey, isWebRTCSession);
  
  // Auto-switch to live view when WebRTC connects.
  // Fall back to polling (Prompts) when disconnected.
  const showLiveView = isWebRTCConnected;
  
  const handleSend = useCallback((text) => {
    if (isWebRTCConnected) {
      sendWebRTCMessage(JSON.stringify({ type: 'input', data: text + '\r' }));
      return true;
    }
    return sendRemoteResponse(text);
  }, [isWebRTCConnected, sendWebRTCMessage, sendRemoteResponse]);

  if (!sessionId) {
    return <NoSessionScreen />;
  }

  const hasPrompts = prompts.length > 0;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">
            <img src="/logo.png" alt="Remote Runner" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
          </div>
          <div>
            <div className="header-title">Remote Runner</div>
            <div className="header-status">
              <div className={`status-dot ${isDisconnected ? 'offline' : (isWebRTCConnected ? 'webrtc' : '')}`} />
              <span className="status-label">
                {isDisconnected ? 'Session ended' : (isWebRTCConnected ? 'P2P Connected (Live)' : 'E2E Encrypted · Polling')}
              </span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {ntfyTopic && !isDisconnected && (
            <a className="ntfy-btn" href={`ntfy://ntfy.sh/${ntfyTopic}`} title="Enable push notifications">
              🔔 Alerts
            </a>
          )}
          {isDisconnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
              <StopIcon />
            </div>
          )}
          {!isDisconnected && (
            <button className="disconnect-btn" onClick={disconnect} title="Disconnect session">
              ✕
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="content-area">
        {/* Waiting / empty state */}
        {!hasPrompts && !isDisconnected && !showLiveView && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <TerminalIcon size={30} />
            </div>
            <div>
              <div className="empty-state-title">Waiting for Claude…</div>
              <p className="empty-state-sub">
                When Claude pauses for your input, the prompt will appear here instantly.
              </p>
            </div>
            <div className="spinner" />
          </div>
        )}

        {/* Live Terminal View */}
        {showLiveView && (
          <XTermTerminal dataChannel={dataChannel} />
        )}

        {/* Prompt Cards (Polling Fallback) */}
        {!showLiveView && <PromptList prompts={prompts} />}

        {/* Disconnected Banner */}
        {isDisconnected && (
          <div className="disconnected-banner">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            The terminal session has ended. You can close this window.
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        isSending={isSending && !isWebRTCConnected}
        disabled={isDisconnected}
      />
    </div>
  );
}
