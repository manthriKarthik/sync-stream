function Members({ members, hostId }) {
  return (
    <div>
      <h3>Listeners ({members.length})</h3>
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.id} className="member-item">
            <div className="member-avatar">
              {member.username?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <span className="member-name">{member.username}</span>
            {member.id === hostId && (
              <span className="member-badge">HOST</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Members;
