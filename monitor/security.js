import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";

// The lockfile is the source of truth. These advisories provide a readable
// explanation for the five packages reported in the October 2026 review;
// the registry audit below covers new advisories as they are published.
const tracked = [
  { name: "swiper", fixed: "12.1.2", severity: "critical", scope: "frontend", advisories: ["GHSA-hmx5-qpq5-p643"] },
  { name: "sharp", fixed: "0.35.5", severity: "high", scope: "api / images", advisories: ["GHSA-f88m-g3jw-g9cj", "GHSA-rgj7-g3m4-5g8c", "GHSA-wq5f-xc86-pv6w"] },
  { name: "@fastify/static", fixed: "10.1.2", severity: "high", scope: "api / uploads", advisories: ["GHSA-83w8-p2f5-377r", "GHSA-8pvw-jcv7-9cmj"] },
  { name: "react-router", fixed: "7.18.0", severity: "moderate", scope: "admin", advisories: ["GHSA-wrjc-x8rr-h8h6", "GHSA-337j-9hxr-rhxg"] },
  { name: "esbuild", fixed: "0.25.0", severity: "moderate", scope: "build tooling", advisories: ["GHSA-67mh-4wv8-2f99"] },
];

function compareVersions(left, right) {
  const [aCore, aPrerelease] = left.split("-", 2);
  const [bCore, bPrerelease] = right.split("-", 2);
  const a = aCore.split(".").map(Number);
  const b = bCore.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  if (aPrerelease && !bPrerelease) return -1;
  if (!aPrerelease && bPrerelease) return 1;
  return 0;
}

export function trackedDependencyStatus(repoDir) {
  const lock = fs.readFileSync(path.join(repoDir, "pnpm-lock.yaml"), "utf8");
  return tracked.map((item) => {
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^  ['"]?${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)(?:[^\\n]*):`, "gm");
    const versions = [...lock.matchAll(re)].map((match) => match[1]);
    const vulnerable = versions.some((version) => compareVersions(version, item.fixed) < 0);
    const majorUpgrade = versions.some((version) => compareVersions(version, item.fixed) < 0 &&
      Number(version.split(".")[0]) < Number(item.fixed.split(".")[0]));
    return {
      ...item,
      versions: [...new Set(versions)].sort(compareVersions),
      status: versions.length === 0 ? "unknown" : vulnerable ? "vulnerable" : "patched",
      recommendation: vulnerable ? `Update ${item.name} to at least ${item.fixed}${majorUpgrade ? " with a reviewed package.json major-version change" : ""}; build and stage the release before promotion.` :
        versions.length === 0 ? "Package not found in the lockfile; check the deployed revision." : "No action for this advisory.",
    };
  });
}

function runAudit(repoDir, nodeBin, scope) {
  return new Promise((resolve) => {
    const nodeDir = path.isAbsolute(nodeBin) ? `${path.dirname(nodeBin)}:` : "";
    const env = { ...process.env, PATH: `${nodeDir}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` };
    execFile("pnpm", ["audit", "--json", scope],
      { cwd: repoDir, env, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let report;
        try { report = JSON.parse(stdout); } catch {
          resolve({ status: "unknown", error: (stderr || error?.message || "Audit returned invalid JSON").trim().slice(0, 400) });
          return;
        }
        const summary = report.metadata?.vulnerabilities;
        const raw = report.advisories || report.vulnerabilities;
        if (!summary && !raw) {
          resolve({ status: "unknown", error: "Audit report did not contain a vulnerability summary." });
          return;
        }
        const advisories = Object.values(raw || {}).map((item) => ({
          id: item.github_advisory_id || item.ghsa_id || item.id || "",
          name: item.module_name || item.name || "",
          title: item.title || item.name || "Advisory",
          severity: item.severity || "unknown",
          patched: item.patched_versions || item.range || null,
          url: item.url || "",
        })).slice(0, 40);
        const counts = Object.fromEntries(["critical", "high", "moderate", "low", "info"].map((level) => [
          level, Number(summary?.[level] ?? advisories.filter((item) => item.severity === level).length),
        ]));
        const total = Math.max(Number(summary?.total ?? Object.values(counts).reduce((a, b) => a + b, 0)), advisories.length);
        if (error && total === 0) {
          resolve({ status: "unknown", error: (stderr || error.message).trim().slice(0, 400) });
          return;
        }
        resolve({ status: total ? "attention" : "clear", counts, total, advisories });
      });
  });
}

let cached;
let pending;
export async function getSecurityStatus(repoDir, nodeBin, force = false) {
  if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const trackedPackages = trackedDependencyStatus(repoDir);
    const workspaceConfig = fs.readFileSync(path.join(repoDir, "pnpm-workspace.yaml"), "utf8");
    const ignoredAdvisoriesConfigured = /^\s*(?:ignore|ignoreGhsas):\s*(?:\[|$)/m.test(workspaceConfig);
    const [production, development] = await Promise.all([
      runAudit(repoDir, nodeBin, "--prod"), runAudit(repoDir, nodeBin, "--dev"),
    ]);
    const recommendations = [];
    for (const item of trackedPackages.filter((entry) => entry.status === "vulnerable")) recommendations.push(item.recommendation);
    if (production.status === "attention") recommendations.push("Update vulnerable production packages and repeat the audit and staging checks before deployment.");
    if (development.status === "attention") recommendations.push("Update vulnerable build dependencies before the next release.");
    if (production.status === "unknown" || development.status === "unknown") recommendations.push("Audit could not be verified. Check registry connectivity and retry; deployment remains blocked on audit failure.");
    if (trackedPackages.some((item) => item.status === "unknown")) recommendations.push("Some tracked package versions could not be found in the lockfile; verify the checkout and lockfile format.");
    if (ignoredAdvisoriesConfigured) recommendations.push("Audit ignore rules are configured. Remove them or review every exception before deployment; the strict update gate blocks ignored advisories.");
    if (!recommendations.length) recommendations.push("Known advisories are patched in this lockfile. Continue monitoring for newly published advisories.");
    const level = ignoredAdvisoriesConfigured || trackedPackages.some((item) => item.status === "vulnerable") || production.status === "attention" || development.status === "attention" ? "attention" :
      production.status === "unknown" || development.status === "unknown" || trackedPackages.some((item) => item.status === "unknown") ? "unknown" : "clear";
    const value = { checkedAt: new Date().toISOString(), level, tracked: trackedPackages, production, development, ignoredAdvisoriesConfigured, recommendations };
    cached = { at: Date.now(), value };
    return value;
  })().finally(() => { pending = null; });
  return pending;
}
