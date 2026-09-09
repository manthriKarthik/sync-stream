import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X } from 'lucide-react';

function MembersPanel({ members, hostId, hostUserId, currentUserId, isHost, socket, roomId }) {
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
    if (!newMessage.trim() || !socket) return;

    socket.emit('chat:send', {
      roomId,
      message: newMessage.trim()
    });
    setNewMessage('');
  };

  const kickMember = (member) => {
    if (!isHost || member.userId === currentUserId) return;
    socket.emit('room:kick', { roomId, memberId: member.id });
  };

  const toggleControl = (member, allowed) => {
    if (!isHost || member.userId === hostUserId) return;
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
                ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
                : 'var(--accent)',
              color: toast.userId === hostUserId ? '#1a1a24' : '#fff'
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
        <div style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
          <h3 style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span>👥</span> Listeners ({members.length})
          </h3>
          <ul style={{ listStyle: 'none', maxHeight: 200, overflowY: 'auto' }}>
            {members.map((member) => {
              const isMemberHost = hostUserId ? member.userId === hostUserId : member.id === hostId;
              return (
                <li
                  key={member.id}
                  className="panel-member"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 8px',
                    borderRadius: 8,
                    marginBottom: 4,
                    background: isMemberHost
                      ? 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,140,0,0.1))'
                      : 'transparent',
                    border: isMemberHost ? '1px solid rgba(255,215,0,0.3)' : '1px solid transparent'
                  }}
                >
                  {/* Avatar */}
                  <div
                    className={isMemberHost ? 'panel-avatar panel-avatar-host' : 'panel-avatar'}
                    style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: isMemberHost
                      ? 'linear-gradient(135deg, #ffd700, #ff8c00)'
                      : 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 600,
                    color: isMemberHost ? '#1a1a24' : '#fff',
                    boxShadow: isMemberHost ? '0 0 12px rgba(255,215,0,0.5)' : 'none',
                    position: 'relative'
                  }}>
                    {member.username?.charAt(0)?.toUpperCase() || '?'}
                    {isMemberHost && (
                      <span style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        fontSize: 12
                      }}>👑</span>
                    )}
                  </div>

                  {/* Name */}
                  <span style={{
                    flex: 1,
                    fontSize: 14,
                    fontWeight: isMemberHost ? 600 : 500,
                    color: isMemberHost ? '#ffd700' : 'var(--text-primary)'
                  }}>
                    {member.username}
                  </span>

                  {/* Host badge */}
                  {isMemberHost && (
                    <span style={{
                      fontSize: 10,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: 'linear-gradient(135deg, #ffd700, #ff8c00)',
                      color: '#1a1a24',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      HOST
                    </span>
                  )}

                  {/* DJ badge: member the host granted playback control (visible to all) */}
                  {!isMemberHost && member.canControl && (
                    <span style={{
                      fontSize: 10,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                      color: '#fff',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      DJ
                    </span>
                  )}

                  {/* Give / Revoke control (host only, not on themselves) */}
                  {isHost && !isMemberHost && (
                    <button
                      onClick={() => toggleControl(member, !member.canControl)}
                      title={member.canControl ? 'Revoke playback control' : 'Give playback control'}
                      style={{
                        background: member.canControl ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.08)',
                        border: member.canControl ? '1px solid rgba(124,58,237,0.5)' : '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        color: member.canControl ? '#a855f7' : 'var(--text-secondary)',
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s'
                      }}
                    >
                      {member.canControl ? 'Revoke' : 'Give control'}
                    </button>
                  )}

                  {/* Kick button (only for host, not on themselves) */}
                  {isHost && !isMemberHost && (
                    <button
                      onClick={() => kickMember(member)}
                      style={{
                        background: 'rgba(239,68,68,0.2)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        color: '#ef4444',
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => {
                        e.target.style.background = '#ef4444';
                        e.target.style.color = '#fff';
                      }}
                      onMouseOut={(e) => {
                        e.target.style.background = 'rgba(239,68,68,0.2)';
                        e.target.style.color = '#ef4444';
                      }}
                    >
                      Kick
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Chat Section */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{
            fontSize: 14,
            fontWeight: 600,
            padding: '16px 20px 12px',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span>💬</span> Live Chat
          </h3>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            {messages.length === 0 ? (
              <p style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                padding: 20
              }}>
                No messages yet. Start the conversation! 🎵
              </p>
            ) : (
              messages.map((msg, i) => {
                const isHostMsg = msg.userId === hostUserId;
                const isOwn = msg.userId === currentUserId;
                return (
                  <div
                    key={i}
                    className={isOwn ? 'chat-msg chat-msg-own' : 'chat-msg'}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 12,
                      background: isHostMsg
                        ? 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,140,0,0.1))'
                        : isOwn
                          ? 'var(--accent-glow)'
                          : 'var(--bg-tertiary)',
                      border: isHostMsg ? '1px solid rgba(255,215,0,0.2)' : 'none',
                      maxWidth: '85%',
                      alignSelf: isOwn ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: isHostMsg ? '#ffd700' : 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      {msg.username}
                      {isHostMsg && <span>👑</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      {msg.message}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={sendMessage}
            style={{
              padding: 16,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 8
            }}
          >
            <input
              type="text"
              className="input"
              placeholder="Type a message..."
              aria-label="Chat message"
              maxLength={2000}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newMessage.trim()}
              style={{ padding: '10px 16px' }}
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
