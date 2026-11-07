import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BACKUP_STALE_MS, backupCronSettings, backupFreshness } from "./backup-status.js";

test("cron settings come from install.sh's marker block", () => {
  const cron = [
    "MAILTO=root",
    "# >>> usim_cms backup (install.sh) >>>",
    "BACKUP_DIR=/mnt/backups",
    "RETENTION_DAYS=30",
    "0 2 * * * /opt/ucms/backup/run.sh >> /var/log/ucms-backup.log 2>&1",
    "# <<< usim_cms backup (install.sh) <<<",
  ].join("\n");
  assert.deepEqual(backupCronSettings(cron), { installed: true, backupDir: "/mnt/backups", retention: "30" });
  assert.deepEqual(backupCronSettings(""), { installed: false, backupDir: "/var/backups/usim_cms", retention: "14" });
});

test("freshness follows the newest control-plane dump only", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ucms-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.now();
  const touch = (name, ageMs) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "");
    fs.utimesSync(file, (now - ageMs) / 1000, (now - ageMs) / 1000);
  };

  assert.equal(backupFreshness(path.join(dir, "missing"), now).stale, true);
  touch("usim_cms_tenant_tenant_a_20261106_020000.dump", 0);
  assert.deepEqual(backupFreshness(dir, now), { newestAt: null, ageMs: null, stale: true });

  touch("usim_cms_control_20261104_020000.dump", 50 * 3600_000);
  assert.equal(backupFreshness(dir, now).stale, true);

  touch("usim_cms_control_20261106_020000.dump", 3 * 3600_000);
  const fresh = backupFreshness(dir, now);
  assert.equal(fresh.stale, false);
  assert.ok(Math.abs(fresh.ageMs - 3 * 3600_000) < 2000);
  assert.ok(BACKUP_STALE_MS > 24 * 3600_000);
});
