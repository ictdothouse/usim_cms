// Prometheus-text-format metrics — hand-rolled (no prom-client) per this
// project's "avoid heavy dependencies" constraint (CLAUDE.md), the same
// reasoning MFA used node:crypto instead of otplib. Third-party architecture
// audit flagged "no request count/error rate/DB pool/cache hit rate metrics"
// as a genuine gap — this closes it.
import { getCacheStats } from "./cache.js";
import { getPoolStats } from "./db/tenant-pool.js";

let requestTotal = 0;
const statusBuckets = new Map<string, number>();
let durationSumSeconds = 0;

export function recordRequest(statusCode: number, elapsedMs: number): void {
  requestTotal++;
  const bucket = `${Math.floor(statusCode / 100)}xx`;
  statusBuckets.set(bucket, (statusBuckets.get(bucket) ?? 0) + 1);
  durationSumSeconds += elapsedMs / 1000;
}

function line(name: string, help: string, type: "counter" | "gauge", body: string): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${body}\n`;
}

export function renderMetrics(): string {
  const cache = getCacheStats();
  const pools = getPoolStats();

  const statusLines =
    Array.from(statusBuckets.entries())
      .map(([bucket, count]) => `ucms_http_requests_total{status="${bucket}"} ${count}`)
      .join("\n") || 'ucms_http_requests_total{status="2xx"} 0';

  return [
    line("ucms_http_requests_total", "Total HTTP requests handled, by status class", "counter", statusLines),
    line(
      "ucms_http_request_duration_seconds_sum",
      "Total time spent handling requests, in seconds",
      "counter",
      `ucms_http_request_duration_seconds_sum ${durationSumSeconds}`,
    ),
    line(
      "ucms_http_requests_handled_total",
      "Total requests seen across every status class (for rate/avg calc)",
      "counter",
      `ucms_http_requests_handled_total ${requestTotal}`,
    ),
    line("ucms_cache_hits_total", "Redis shared-cache hits", "counter", `ucms_cache_hits_total ${cache.hits}`),
    line("ucms_cache_misses_total", "Redis shared-cache misses", "counter", `ucms_cache_misses_total ${cache.misses}`),
    line(
      "ucms_db_pool_connections",
      "Current pg pool connection count",
      "gauge",
      `ucms_db_pool_connections{pool="control",state="total"} ${pools.control.total}\n` +
        `ucms_db_pool_connections{pool="control",state="idle"} ${pools.control.idle}\n` +
        `ucms_db_pool_connections{pool="control",state="waiting"} ${pools.control.waiting}\n` +
        `ucms_db_pool_connections{pool="tenant",state="total"} ${pools.tenants.total}\n` +
        `ucms_db_pool_connections{pool="tenant",state="idle"} ${pools.tenants.idle}\n` +
        `ucms_db_pool_connections{pool="tenant",state="waiting"} ${pools.tenants.waiting}`,
    ),
    line(
      "ucms_tenant_pools_active",
      "Number of tenant DB pools currently open in this process",
      "gauge",
      `ucms_tenant_pools_active ${pools.tenants.poolCount}`,
    ),
  ].join("");
}
