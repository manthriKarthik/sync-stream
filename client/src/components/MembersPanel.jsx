import { useState, useEffect, useRef } from 'react';

function MembersPanel({ members, hostId, currentUserId, isHost, socket, roomId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for chat messages
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (msg) => {
      setMessages(prev => [...prev, msg]);
    };

    socket.on('chat:message', handleChatMessage);
    return () => socket.off('chat:message', handleChatMessage);
  }, [socket]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    socket.emit('chat:send', {
      roomId,
      message: newMessage.trim()
    });
    setNewMessage('');
  };

  const kickMember = (memberId) => {
    if (!isHost || memberId === currentUserId) return;
    socket.emit('room:kick', { roomId, memberId });
  };

  return (
    <>
      {/* Toggle button */}
      <button
        className="panel-toggle"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          right: isOpen ? 340 : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1001,
          width: 32,
          height: 80,
          borderRadius: '8px 0 0 8px',
          background: 'var(--accent)',
          border: 'none',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'right 0.3s ease',
          boxShadow: '-2px 0 12px rgba(0,0,0,0.3)'
        }}
      >
        {isOpen ? '›' : '‹'}
      </button>

      {/* Sliding Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? 0 : -340,
          width: 340,
          height: '100vh',
          background: 'var(--bg-secondary)',
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
              const isMemberHost = member.id === hostId;
              return (
                <li
                  key={member.id}
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
                  <div style={{
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

                  {/* Kick button (only for host, not on themselves) */}
                  {isHost && !isMemberHost && (
                    <button
                      onClick={() => kickMember(member.id)}
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
                const isHostMsg = msg.userId === hostId;
                const isOwn = msg.userId === currentUserId;
                return (
                  <div
                    key={i}
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
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              type="submit"
              className="btn btn-primary"
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
