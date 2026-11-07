// Reads what install.sh's backup cron left behind: its settings in root's
// crontab and the age of the newest control-plane dump. Plain functions over
// the crontab text and a directory, so backup-status.test.js needs no root.
import fs from "node:fs";
import path from "node:path";

// The cron runs daily at 02:00; 26h leaves room for a slow run before an alert.
export const BACKUP_STALE_MS = 26 * 60 * 60_000;
const CRON_MARKER = "# >>> usim_cms backup (install.sh) >>>";

// install.sh writes BACKUP_DIR/RETENTION_DAYS as plain lines inside its own
// marker block; first match wins, same as its own `grep -m1 '^BACKUP_DIR='`.
export function backupCronSettings(crontab) {
  const text = String(crontab || "");
  const setting = (name) => (text.match(new RegExp(`^${name}=(.+)$`, "m")) || [])[1]?.trim() || "";
  const dir = setting("BACKUP_DIR");
  return {
    installed: text.includes(CRON_MARKER),
    backupDir: dir.startsWith("/") ? dir : "/var/backups/usim_cms",
    retention: /^\d+$/.test(setting("RETENTION_DAYS")) ? setting("RETENTION_DAYS") : "14",
  };
}

// backup.sh writes usim_cms_control_<ts>.dump only when the control-plane
// dump succeeds (a failed one is deleted), so its mtime is the last good run.
// A missing or unreadable directory counts as "no backup".
export function backupFreshness(backupDir, now = Date.now()) {
  let newest = 0;
  let names = [];
  try {
    names = fs.readdirSync(backupDir);
  } catch {
    // no backup directory yet
  }
  for (const name of names) {
    if (!/^usim_cms_control_.+\.dump$/.test(name)) continue;
    try {
      newest = Math.max(newest, fs.statSync(path.join(backupDir, name)).mtimeMs);
    } catch {
      // pruned between readdir and stat
    }
  }
  if (!newest) return { newestAt: null, ageMs: null, stale: true };
  const ageMs = Math.max(0, now - newest);
  return { newestAt: new Date(newest).toISOString(), ageMs, stale: ageMs > BACKUP_STALE_MS };
}
