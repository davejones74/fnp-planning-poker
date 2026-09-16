/** Format a duration in milliseconds as HH:MM:SS (hours may exceed two digits). */
export function formatElapsed(sinceIso: string, nowMs: number = Date.now()): string {
  let ms = nowMs - new Date(sinceIso).getTime();
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}