#!/usr/bin/env node
// Emergency recovery from the VPS console. Password never appears in argv.
import crypto from "node:crypto";
import { listUsers, resetUserFromConsole } from "./users.js";

if (process.getuid?.() !== 0) {
  console.error("Run this command as root on the VPS.");
  process.exit(1);
}
const [command, username] = process.argv.slice(2);
if (command !== "reset" || !username || process.argv.length !== 4) {
  console.error("Usage: sudo bash scripts/monitor-users.sh reset <username>");
  process.exit(2);
}
try {
  // An existing user store is mandatory; recovery must not silently restore
  // the old bootstrap credential if its file is missing or damaged.
  if (!listUsers().some((user) => user.name === username)) throw new Error("User not found.");
  const password = crypto.randomBytes(32).toString("hex");
  resetUserFromConsole(username, password);
  console.log(`Password reset for ${username}. Copy this one-time password now:\n${password}`);
} catch (error) {
  console.error(`Could not reset monitor user: ${error.message}`);
  process.exit(1);
}
