// Relative time for the "2h ago" style timestamps the dashboard uses. The API
// returns created_at as ISO-8601 UTC (naive, so treat it as UTC explicitly).
export const relativeTime = (iso) => {
  if (!iso) return 'never';
  const then = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'yesterday';
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString();
};
