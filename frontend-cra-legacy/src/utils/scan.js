// Statuses are stored uppercased by the scanner, but the seeded historical rows
// are lowercase. Everything compares against the normalized form so a legacy
// scan renders the same as a fresh one instead of polling forever.
export const normStatus = (scan) => (scan?.status || '').toUpperCase();

export const isFinished = (scan) => {
  const s = normStatus(scan);
  return s === 'COMPLETED' || s === 'FAILED';
};
