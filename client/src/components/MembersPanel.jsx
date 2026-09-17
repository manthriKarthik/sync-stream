import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Volume2, VolumeX } from 'lucide-react';

// Deterministic, attractive avatar gradient per listener (stable across renders).
// Curated palette tuned for the dark aurora theme — vivid but not harsh.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #7c6cff, #5b8def)', // violet → blue
  'linear-gradient(135deg, #22d3ee, #3b82f6)', // cyan → blue
  'linear-gradient(135deg, #fb7185, #e24aa0)', // rose → pink
  'linear-gradient(135deg, #34d399, #0ea5a5)', // emerald → teal
  'linear-gradient(135deg, #fbbf24, #fb7185)', // amber → coral
  'linear-gradient(135deg, #e879f9, #9333ea)', // fuchsia → purple
  'linear-gradient(135deg, #38bdf8, #2dd4bf)', // sky → teal
  'linear-gradient(135deg, #fb923c, #f43f5e)'  // orange → rose
];
function avatarGradient(key = '') {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function MembersPanel({ members, hostId, hostUserId, currentUserId, isHost, socket, roomId, connected }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null); // latest incoming message for the pop-up
  const chatEndRef = useRef(null);
  const audioCtxRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const toastTimerRef = useRef(null);
  isOpenRef.current = isOpen;

  // Play a soft two-note "ding" using the Web Audio API (no asset file needed).
  const playChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const notes = [880, 1174.66]; // A5 -> D6, a gentle rising chime
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.09;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.02); // light volume
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch (_) { /* audio not available */ }
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clear unread count when the panel is opened
  useEffect(() => {
    if (isOpen) setUnread(0);
  }, [isOpen]);

  // Listen for chat messages
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (msg) => {
      setMessages(prev => [...prev, msg]);

      // Only notify for messages from other people
      if (msg.userId !== currentUserId) {
        playChime();
        // Show the pop-up (and bump unread) when the panel is closed
        if (!isOpenRef.current) {
          setUnread(prev => prev + 1);
          setToast(msg);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setToast(null), 4500);
        }
      }
    };

    socket.on('chat:message', handleChatMessage);
    return () => socket.off('chat:message', handleChatMessage);
  }, [socket, currentUserId, playChime]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  useEffect(() => {
    const handleKey = event => { if (event.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !connected || !socket?.connected) return;

    socket.emit('chat:send', {
      roomId,
      message: newMessage.trim()
    });
    setNewMessage('');
  };

  const kickMember = (member) => {
    if (!isHost || !connected || !socket?.connected || member.userId === currentUserId) return;
    socket.emit('room:kick', { roomId, memberId: member.id });
  };

  const toggleControl = (member, allowed) => {
    if (!isHost || !connected || !socket?.connected || member.userId === hostUserId) return;
    socket.emit('room:set-control', { roomId, memberId: member.id, allowed });
  };

  return (
    <>
      {/* Chat pop-up notification (shown when a message arrives and panel is closed) */}
      {toast && (
        <div
          className="chat-toast"
          onClick={() => { setIsOpen(true); setToast(null); }}
        >
          <div
            className="chat-toast-avatar"
            style={{
              background: toast.userId === hostUserId
                ? 'linear-gradient(135deg, #ffffff, #c4cde0)'
                : 'var(--accent)',
              color: toast.userId === hostUserId ? '#14161f' : '#fff'
            }}
          >
            {toast.username?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="chat-toast-name">
              {toast.username}
              {toast.userId === hostUserId && <span>👑</span>}
            </div>
            <div className="chat-toast-text">{toast.message}</div>
          </div>
          <span className="chat-toast-icon">💬</span>
        </div>
      )}

      {/* Toggle button */}
      <button
        className="panel-toggle"
        aria-label={isOpen ? 'Close listeners and chat' : 'Open listeners and chat'}
        title={isOpen ? 'Close listeners and chat' : 'Open listeners and chat'}
        aria-expanded={isOpen}
        aria-controls="listeners-panel"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          right: isOpen ? 'min(340px, calc(100vw - 48px))' : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1001,
          width: 32,
          height: 80,
          borderRadius: '8px 0 0 8px',
          background: 'var(--accent)',
          border: 'none',
          color: '#13231a',
          fontSize: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'right 0.3s ease',
          boxShadow: '-2px 0 12px rgba(0,0,0,0.3)'
        }}
      >
        {isOpen ? <X size={18} /> : <MessageCircle size={18} />}
        {!isOpen && unread > 0 && (
          <span className="panel-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {/* Sliding Panel */}
      <div
        id="listeners-panel"
        className="listeners-panel"
        aria-label="Listeners and chat"
        inert={isOpen ? undefined : ''}
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? 0 : -340,
          width: 'min(340px, calc(100vw - 48px))',
          height: '100dvh',
          visibility: isOpen ? 'visible' : 'hidden',
          background: 'rgba(12, 12, 18, 0.72)',
          backdropFilter: 'blur(26px)',
          WebkitBackdropFilter: 'blur(26px)',
          borderLeft: '1px solid var(--border)',
          zIndex: 1000,
          transition: 'right 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isOpen ? '-4px 0 24px rgba(0,0,0,0.4)' : 'none'
        }}
      >
        {/* Members Section */}
        <div className="panel-section panel-members">
          <div className="panel-section-head">
            <span className="panel-section-title">Listeners</span>
            <span className="panel-live-count" title="People currently listening">
              <span className="listener-dot" />
              {members.filter(m => !m.muted).length}/{members.length} live
            </span>
          </div>
          <ul className="member-list">
            {members.map((member) => {
              const isMemberHost = hostUserId ? member.userId === hostUserId : member.id === hostId;
              const isMe = member.userId === currentUserId;
              const initial = member.username?.charAt(0)?.toUpperCase() || '?';
              return (
                <li
                  key={member.id}
                  className={`member-row${isMemberHost ? ' is-host' : ''}${member.muted ? ' is-muted' : ''}`}
                >
                  <div className={`member-avatar-wrap${isMemberHost ? ' is-host' : ''}`}>
                    <div
                      className="member-avatar"
                      style={isMemberHost ? undefined : { background: avatarGradient(member.userId || member.id), color: '#fff' }}
                    >
                      {initial}
                    </div>
                    <span className={`member-presence${member.muted ? ' muted' : ''}`} />
                  </div>

                  <div className="member-info">
                    <span className="member-name">{member.username}</span>
                    <span className={`member-status${member.muted ? ' muted' : ''}`}>
                      {member.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      {member.muted ? 'Muted' : 'Listening'}
                    </span>
                  </div>

                  <div className="member-trailing">
                    <div className="member-tags">
                      {isMe && <span className="chip chip-you">You</span>}
                      {isMemberHost && <span className="chip chip-host">Host</span>}
                      {!isMemberHost && member.canControl && <span className="chip chip-dj">DJ</span>}
                    </div>
                    {isHost && !isMemberHost && (
                      <div className="member-actions">
                        <button
                          className={`member-btn${member.canControl ? ' active' : ''}`}
                          onClick={() => toggleControl(member, !member.canControl)}
                          disabled={!connected}
                          title={member.canControl ? 'Revoke playback control' : 'Give playback control'}
                        >
                          {member.canControl ? 'Revoke' : 'Make DJ'}
                        </button>
                        <button
                          className="member-btn member-btn-danger"
                          onClick={() => kickMember(member)}
                          disabled={!connected}
                          title="Remove from room"
                        >
                          Kick
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Chat Section */}
        <div className="panel-section panel-chat">
          <div className="panel-section-head">
            <span className="panel-section-title">Live Chat</span>
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <span className="chat-empty-icon">💬</span>
                <p>No messages yet.<br />Start the conversation!</p>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isHostMsg = msg.userId === hostUserId;
                const isOwn = msg.userId === currentUserId;
                const time = msg.timestamp
                  ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <div
                    key={i}
                    className={`chat-msg${isOwn ? ' chat-msg-own' : ''}${isHostMsg && !isOwn ? ' chat-msg-host' : ''}`}
                  >
                    {!isOwn && (
                      <div className="chat-msg-name">
                        {msg.username}
                        {isHostMsg && <span>👑</span>}
                      </div>
                    )}
                    <div className="chat-msg-text">{msg.message}</div>
                    {time && <span className="chat-msg-time">{time}</span>}
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={sendMessage}
            className="chat-input-bar"
          >
            <input
              type="text"
              className="input chat-input"
              placeholder="Type a message..."
              aria-label="Chat message"
              maxLength={2000}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary chat-send"
              disabled={!connected || !newMessage.trim()}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default MembersPanel;
