#!/usr/bin/env node
// Keep the monitor's listening socket alive while replacing its code. The
// replacement must reach server.listen before the old worker is drained.
import cluster from "node:cluster";
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { clearTimeout, setTimeout } from "node:timers";
import { URL, fileURLToPath } from "node:url";

cluster.setupPrimary({ exec: fileURLToPath(new URL("./server.js", import.meta.url)) });

let active = null;
let starting = false;
let stopping = false;

function currentEnvironment() {
  // install.sh writes simple KEY=value lines to this root-owned file. Read it
  // again for each worker so changing backup/monitor settings needs a rolling
  // reload instead of a service restart. Never log these values.
  const values = {};
  for (const line of fs.readFileSync("/etc/ucms-monitor.env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function startWorker() {
  if (starting || stopping) return;
  starting = true;
  const previous = active;
  let candidate;
  try {
    candidate = cluster.fork(currentEnvironment());
  } catch (error) {
    starting = false;
    console.error("Could not read monitor environment for replacement worker:", error.message);
    if (!previous) process.exit(1);
    return;
  }
  let ready = false;
  const timeout = setTimeout(() => {
    if (!ready) {
      console.error("Replacement monitor did not listen within 30 seconds; retaining the old worker.");
      candidate.kill();
    }
  }, 30_000);

  candidate.once("listening", () => {
    if (stopping) return;
    ready = true;
    clearTimeout(timeout);
    active = candidate;
    starting = false;
    console.log(`Monitor worker ${candidate.process.pid} is ready.`);
    if (previous?.isConnected()) {
      previous.disconnect();
      const drainTimeout = setTimeout(() => {
        if (!previous.isDead()) previous.kill();
      }, 60_000);
      previous.once("exit", () => clearTimeout(drainTimeout));
    }
  });
  candidate.once("exit", (code, signal) => {
    clearTimeout(timeout);
    if (active === candidate) active = null;
    if (!ready) starting = false;
    if (!stopping && !ready) {
      console.error(`Replacement monitor exited before listening (${signal || code}); old worker stays live.`);
      if (!active) setTimeout(startWorker, 1000);
    } else if (!stopping && ready && !active) {
      console.error("Active monitor worker exited; starting a replacement.");
      setTimeout(startWorker, 1000);
    }
  });
}

process.on("SIGUSR2", startWorker);
process.on("SIGTERM", () => {
  stopping = true;
  for (const worker of Object.values(cluster.workers || {})) worker?.kill("SIGTERM");
  process.exit(0);
});
startWorker();
