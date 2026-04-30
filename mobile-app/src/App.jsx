import { useRemoteSession } from './hooks/useRemoteSession';
import { useWebRTC } from './hooks/useWebRTC';
import XTermTerminal from './components/XTermTerminal';

export default function App() {
  const { sessionId, encryptionKey, isWebRTCSession, isDisconnected } = useRemoteSession();
  
  const { isWebRTCConnected, dataChannel } = useWebRTC(sessionId, encryptionKey, isWebRTCSession);

  if (!sessionId) {
    return (
      <div className="no-session">
        <div className="no-session-card">
          <h1 className="no-session-title">Invalid Session</h1>
          <p className="no-session-desc">Please open this app from the Telegram Bot.</p>
        </div>
      </div>
    );
  }

  if (isDisconnected) {
    return (
      <div className="no-session">
        <div className="no-session-card">
          <h1 className="no-session-title">Session Ended</h1>
          <p className="no-session-desc">The terminal session has ended. You can close this window.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-telegram">
      {!isWebRTCConnected ? (
        <div className="connecting-state">
          <div className="spinner" />
          <p>🔌 Connecting to your terminal...</p>
        </div>
      ) : (
        <div className="terminal-container">
          <XTermTerminal dataChannel={dataChannel} onPrompt={() => {}} />
        </div>
      )}
    </div>
  );
}
