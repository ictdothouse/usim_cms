// Root-owned, dependency-free credential store for human monitor operators.
// MONITOR_USER/MONITOR_PASSWORD remain a separate, private API credential.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const USERS_FILE = process.env.MONITOR_USERS_FILE || "/etc/ucms-monitor-users.json";
const N = 1 << 17;
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const MAX_USERS = 32;
const MARKER_FILE = `${USERS_FILE}.initialized`;
const DUMMY_USER = { salt: "0".repeat(32), hash: "0".repeat(64) };
let cachedFileKey = "";
let cachedUsers = null;
const authCache = new Map();
let mutationQueue = Promise.resolve();
let activeHashes = 0;
const waitingHashes = [];

function validateUsername(username) {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    throw new Error("Username must be 3–32 letters, numbers, dots, underscores or hyphens.");
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") < 24 ||
      Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Password must be 24–1024 bytes long.");
  }
}

function checkFile() {
  const stat = fs.lstatSync(USERS_FILE);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 ||
      (process.getuid?.() === 0 && stat.uid !== 0)) {
    throw new Error("Monitor user store must be a root-owned regular file with mode 0600.");
  }
  return stat;
}

function validateStore(store) {
  if (store?.version !== 1 || !Array.isArray(store.users) ||
      store.users.length < 1 || store.users.length > MAX_USERS) {
    throw new Error("Invalid monitor user store.");
  }
  const names = new Set();
  for (const user of store.users) {
    validateUsername(user.name);
    if (names.has(user.name) || !/^[a-f0-9]{32}$/.test(user.salt) ||
        !/^[a-f0-9]{64}$/.test(user.hash)) {
      throw new Error("Invalid monitor user record.");
    }
    names.add(user.name);
  }
  return store;
}

function fileKey(stat) {
  return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
}

function readStore() {
  const stat = checkFile();
  const key = fileKey(stat);
  if (key !== cachedFileKey) {
    cachedUsers = validateStore(JSON.parse(fs.readFileSync(USERS_FILE, "utf8")));
    cachedFileKey = key;
    authCache.clear();
  }
  return cachedUsers;
}

function writeStore(store, initial = false) {
  validateStore(store);
  const dir = path.dirname(USERS_FILE);
  const temp = path.join(dir, `.ucms-monitor-users-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(store) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (!initial) checkFile();
    fs.renameSync(temp, USERS_FILE);
    cachedFileKey = "";
    authCache.clear();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function hashSync(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, Buffer.from(salt, "hex"), KEY_LENGTH, SCRYPT_OPTIONS).toString("hex");
  return { salt, hash };
}

function hashAsync(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeHashes++;
      crypto.scrypt(password, Buffer.from(salt, "hex"), KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
        activeHashes--;
        const next = waitingHashes.shift();
        if (next) next();
        if (error) reject(error);
        else resolve({ salt, hash: key.toString("hex") });
      });
    };
    if (activeHashes < 2) run();
    else if (waitingHashes.length < 32) waitingHashes.push(run);
    else reject(Object.assign(new Error("Authentication is busy; retry shortly."), { code: "EBUSY" }));
  });
}

async function matches(user, password) {
  const computed = await hashAsync(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(computed.hash, "hex"), Buffer.from(user.hash, "hex"));
}

export function initializeUsers(username, password) {
  if (!path.isAbsolute(USERS_FILE)) throw new Error("MONITOR_USERS_FILE must be absolute.");
  try {
    readStore();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (fs.existsSync(MARKER_FILE)) throw new Error("Monitor user store disappeared after migration; restore it from backup.");
    validateUsername(username);
    validatePassword(password);
    // First boot migrates the existing browser login. Later changes affect only
    // this file; the private API credential in the env file stays stable.
    writeStore({ version: 1, users: [{ name: username, ...hashSync(password) }] }, true);
    readStore();
  }
  // A missing credential file after migration must never reinstate the old
  // bootstrap password from the machine-credential environment file.
  try {
    const marker = fs.openSync(MARKER_FILE, "wx", 0o600);
    fs.closeSync(marker);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

export async function authenticate(username, password, header) {
  const store = readStore();
  const user = store.users.find((entry) => entry.name === username);
  const digest = crypto.createHash("sha256").update(header).digest("hex");
  if (user && authCache.has(digest)) return authCache.get(digest) === username;
  if (!await matches(user || DUMMY_USER, password) || !user) return false;
  if (authCache.size >= 128) authCache.delete(authCache.keys().next().value);
  authCache.set(digest, username);
  return true;
}

export function listUsers() {
  return readStore().users.map((user) => ({ name: user.name }));
}

function serializeMutation(work) {
  const result = mutationQueue.then(work);
  mutationQueue = result.catch(() => {});
  return result;
}

export function changePassword(username, currentPassword, newPassword) {
  return serializeMutation(async () => {
    validatePassword(newPassword);
    const store = structuredClone(readStore());
    const user = store.users.find((entry) => entry.name === username);
    if (!user || typeof currentPassword !== "string" || !await matches(user, currentPassword)) {
      throw new Error("Current password is incorrect.");
    }
    if (currentPassword === newPassword) throw new Error("Choose a different password.");
    Object.assign(user, await hashAsync(newPassword));
    writeStore(store);
  });
}

export function addUser(actor, currentPassword, username, password) {
  return serializeMutation(async () => {
    validateUsername(username);
    validatePassword(password);
    const store = structuredClone(readStore());
    const operator = store.users.find((entry) => entry.name === actor);
    if (!operator || typeof currentPassword !== "string" || !await matches(operator, currentPassword)) {
      throw new Error("Current password is incorrect.");
    }
    if (store.users.length >= MAX_USERS) throw new Error("Maximum number of users reached.");
    if (store.users.some((entry) => entry.name === username)) throw new Error("Username already exists.");
    store.users.push({ name: username, ...await hashAsync(password) });
    writeStore(store);
  });
}

export function removeUser(actor, currentPassword, username) {
  return serializeMutation(async () => {
    const store = structuredClone(readStore());
    const operator = store.users.find((entry) => entry.name === actor);
    if (!operator || typeof currentPassword !== "string" || !await matches(operator, currentPassword)) {
      throw new Error("Current password is incorrect.");
    }
    if (username === actor) throw new Error("You cannot remove your own account.");
    if (!store.users.some((entry) => entry.name === username)) throw new Error("User not found.");
    if (store.users.length === 1) throw new Error("Cannot remove the last account.");
    store.users = store.users.filter((entry) => entry.name !== username);
    writeStore(store);
  });
}

export function resetUserFromConsole(username, password) {
  validateUsername(username);
  validatePassword(password);
  const store = structuredClone(readStore());
  const user = store.users.find((entry) => entry.name === username);
  if (!user) throw new Error("User not found.");
  Object.assign(user, hashSync(password));
  writeStore(store);
}
