// 52 hybrid-renderer eval cases.
//
// Each case captures a prompt, the manifest the LLM would emit per
// skills/hybrid-renderer/SKILL.md, and the expectations the eval harness
// scores against (correct shell, required widgets, forbidden widgets,
// reasonable widget count).
//
// Manifests are realistic but compact — synthetic data, plausible structure.
// The point is to exercise the renderer's shell-inference, density budget,
// and slot-overflow logic across the kinds of artifacts /cw-* skills produce.

export const CATEGORIES = {
  "error-investigation": "Error investigation",
  "latency-performance": "Latency / performance",
  "slo-service-health": "SLO / service health",
  "cloudtrail-security":  "CloudTrail / security",
  "mixed-complex":        "Mixed / complex",
  "quality-regression":   "HTML quality / a11y / safety",
};

// ---------------------------------------------------------------------------
// Small builders to keep manifests legible.
// ---------------------------------------------------------------------------

const stat = (priority, label, value, unit, opts = {}) => ({
  type: "stat_card",
  priority,
  data: { label, value, unit, ...opts },
});

const spark = (priority, label, points, opts = {}) => ({
  type: "sparkline",
  priority,
  data: { label, points, ...opts },
});

const tl = (priority, label, events) => ({
  type: "timeline",
  priority,
  data: { label, events },
});

const tab = (priority, label, columns, rows, opts = {}) => ({
  type: "table",
  priority,
  data: { label, columns, rows, sortable: true, ...opts },
});

const trace = (priority, traceId, total, spans) => ({
  type: "trace_waterfall",
  priority,
  data: { trace_id: traceId, total_duration_ms: total, spans },
  display_hints: { emphasis: "primary" },
});

const logs = (priority, label, log_group, lines) => ({
  type: "log_viewer",
  priority,
  data: { label, log_group, lines },
});

const changes = (priority, label, events) => ({
  type: "change_event_list",
  priority,
  data: { label, events },
});

// Reusable column shapes
const COL_OP = { key: "op", label: "Operation", kind: "code" };
const COL_ERR = { key: "errors", label: "Errors/min", kind: "number", align: "right" };
const COL_P99 = { key: "p99", label: "p99 (ms)", kind: "number", align: "right" };
const COL_HEALTH = { key: "health", label: "Health", kind: "status" };

// ---------------------------------------------------------------------------
// Cases — 52 prompts, each with manifest + expectations.
// ---------------------------------------------------------------------------

const C = []; // accumulator

// ---------- Category 1: Error investigation ----------
C.push({
  id: "err-01",
  category: "error-investigation",
  prompt: "Why is my API returning 500 errors?",
  expected: {
    shell: "investigation",
    mustIncludeAny: ["stat_card", "sparkline"],
    mustIncludeAny2: ["log_viewer", "table"],
    forbidden: ["trace_waterfall"],
    widgetCount: [3, 8],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "API 500 errors — current rate and likely causes",
      severity: "critical",
      query_intent: "error-spike-triage",
      service: "api",
      region: "us-east-1",
    },
    widgets: [
      stat(1, "5xx rate", 4.6, "%", { baseline: 0.4, baseline_label: "24h ago", trend: { direction: "up", magnitude: "+1050%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [0.4, 0.4, 0.6, 1.1, 2.5, 3.8, 4.6] }),
      stat(2, "Failed requests / min", 312, "", { status: "unhealthy", trend: { direction: "up", magnitude: "+820%", good_or_bad: "bad" } }),
      tab(3, "Top failing operations", [COL_OP, COL_ERR, COL_P99, COL_HEALTH], [
        { op: "POST /orders", errors: 162, p99: 940, health: "unhealthy" },
        { op: "GET /users/:id", errors: 98, p99: 410, health: "warning" },
        { op: "POST /auth/login", errors: 52, p99: 290, health: "warning" },
      ]),
      logs(4, "Recent error log lines", "/aws/ecs/api", [
        { timestamp: "14:08:02.123", severity: "error", message: "java.lang.NullPointerException at OrderService.createOrder(OrderService.java:142)" },
        { timestamp: "14:08:03.450", severity: "error", message: "DownstreamTimeout: payment-svc /charge after 5000ms" },
        { timestamp: "14:08:05.890", severity: "warn",  message: "Circuit breaker OPEN for payment-svc" },
      ]),
      changes(5, "Recent changes (24h)", [
        { timestamp: "13:50 UTC", title: "Deploy api:rev-204 rolled to prod", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "err-02",
  category: "error-investigation",
  prompt: "Investigate high error rate on payment-service",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["log_viewer", "table"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Error rate investigation — payment-service",
      severity: "critical",
      query_intent: "error-spike-triage",
      service: "payment-service",
      region: "us-east-1",
      environment: "prod",
    },
    widgets: [
      stat(1, "Error rate", 6.8, "%", { baseline: 0.5, baseline_label: "7d avg", trend: { direction: "up", magnitude: "+1260%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [0.5, 0.6, 0.6, 1.5, 3.2, 5.1, 6.8] }),
      stat(2, "p99 latency", 1840, "ms", { baseline: 320, status: "degraded", trend: { direction: "up", magnitude: "+475%", good_or_bad: "bad" } }),
      tab(3, "Failing operations", [COL_OP, COL_ERR, COL_P99, COL_HEALTH], [
        { op: "POST /charge", errors: 89, p99: 2100, health: "unhealthy" },
        { op: "POST /refund", errors: 34, p99: 1420, health: "unhealthy" },
        { op: "GET /transactions", errors: 12, p99: 610, health: "warning" },
      ]),
      logs(4, "payment-service error log", "/aws/ecs/payment-service", [
        { timestamp: "14:02:11", severity: "error", message: "Stripe API call failed: rate_limit_exceeded" },
        { timestamp: "14:02:14", severity: "error", message: "DynamoDB ProvisionedThroughputExceededException on table=transactions" },
      ]),
      tl(5, "Incident timeline", [
        { timestamp: "13:55 UTC", title: "Promo campaign launched (3× expected traffic)", severity: "info" },
        { timestamp: "14:00 UTC", title: "Error rate exceeded 1%", severity: "warning" },
        { timestamp: "14:02 UTC", title: "Stripe rate-limit hit",  severity: "critical" },
      ]),
    ],
  },
});

C.push({
  id: "err-03",
  category: "error-investigation",
  prompt: "What's causing the spike in 5xx errors since 2pm?",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["log_viewer", "table", "change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "5xx spike since 14:00 — likely cause",
      severity: "critical",
      query_intent: "error-spike-triage",
      service: "api",
    },
    widgets: [
      stat(1, "5xx rate (1h)", 3.4, "%", { baseline: 0.2, baseline_label: "before 14:00", trend: { direction: "up", magnitude: "+1600%", good_or_bad: "bad" }, status: "unhealthy" }),
      spark(2, "5xx rate (last 3h)", [0.2, 0.2, 0.3, 0.2, 0.3, 1.1, 2.4, 3.1, 3.4], { unit: "%", color: "red", current: 3.4 }),
      changes(3, "Recent changes (since 13:00)", [
        { timestamp: "13:55 UTC", title: "Config change — feature_flag.new_checkout=true", kind: "config", principal: "platform-admin" },
        { timestamp: "13:58 UTC", title: "ECS service api updated to rev-204", kind: "deploy", principal: "deploy-bot" },
      ]),
      tab(4, "Top failing endpoints", [COL_OP, COL_ERR, { key: "since", label: "First seen", kind: "text" }], [
        { op: "POST /checkout", errors: 142, since: "14:01" },
        { op: "POST /cart/add", errors: 41, since: "14:02" },
      ]),
    ],
  },
});

C.push({
  id: "err-04",
  category: "error-investigation",
  prompt: "Debug: order-service throwing NullPointerException",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustInclude: ["log_viewer"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "order-service — NullPointerException investigation",
      severity: "critical",
      query_intent: "error-spike-triage",
      service: "order-service",
    },
    widgets: [
      stat(1, "NPE rate", 1.8, "%", { baseline: 0, status: "unhealthy", trend: { direction: "up", magnitude: "+∞", good_or_bad: "bad" } }),
      stat(2, "Affected requests/min", 47, "", { status: "degraded" }),
      logs(3, "Top NullPointerException stack traces", "/aws/ecs/order-service", [
        { timestamp: "14:08:02", severity: "error", message: "java.lang.NullPointerException: Cannot invoke 'String.length()' because 'shippingAddress.zipCode' is null at OrderValidator.validate(OrderValidator.java:88)" },
        { timestamp: "14:08:09", severity: "error", message: "java.lang.NullPointerException: Cannot invoke 'String.length()' because 'shippingAddress.zipCode' is null at OrderValidator.validate(OrderValidator.java:88)" },
        { timestamp: "14:08:14", severity: "error", message: "java.lang.NullPointerException: Cannot invoke 'String.length()' because 'shippingAddress.zipCode' is null at OrderValidator.validate(OrderValidator.java:88)" },
      ]),
      tab(4, "Affected request shapes", [
        { key: "endpoint", label: "Endpoint", kind: "code" },
        { key: "count", label: "Count", kind: "number", align: "right" },
        { key: "first_seen", label: "First seen", kind: "text" },
      ], [
        { endpoint: "POST /orders (no zipCode)", count: 142, first_seen: "13:58 UTC" },
        { endpoint: "POST /orders (intl address)", count: 38, first_seen: "14:01 UTC" },
      ]),
      changes(5, "Recent changes", [
        { timestamp: "13:50 UTC", title: "Deploy order-service:rev-88 — added intl shipping support", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "err-05",
  category: "error-investigation",
  prompt: "Error rate jumped from 0.1% to 5% in the last hour",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["log_viewer", "table", "change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Error rate jump 0.1% → 5% — cause analysis",
      severity: "critical",
      query_intent: "error-spike-triage",
    },
    widgets: [
      stat(1, "Error rate now", 5.0, "%", { baseline: 0.1, baseline_label: "1h ago", trend: { direction: "up", magnitude: "+4900%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [0.1, 0.1, 0.2, 1.0, 2.5, 4.0, 5.0] }),
      spark(2, "Error rate (1h sliding)", [0.1, 0.1, 0.1, 0.2, 0.4, 1.0, 1.8, 2.5, 3.6, 4.4, 5.0], { unit: "%", color: "red", current: 5.0 }),
      tab(3, "Hypotheses ranked by evidence", [
        { key: "h", label: "Hypothesis", kind: "text" },
        { key: "conf", label: "Confidence", kind: "status" },
        { key: "ev", label: "Evidence", kind: "text" },
      ], [
        { h: "Recent deploy regression", conf: "warning", ev: "rev-204 shipped at 13:50 — 8min before spike" },
        { h: "Downstream rate limit", conf: "warning", ev: "Stripe 429s observed in logs" },
        { h: "Traffic surge", conf: "healthy", ev: "RPS within 10% of baseline" },
      ]),
      changes(4, "Recent changes (last 90 min)", [
        { timestamp: "13:50 UTC", title: "ECS service api → rev-204", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "err-06",
  category: "error-investigation",
  prompt: "Multiple services showing increased error rates",
  expected: { shell: ["investigation", "dashboard"], mustIncludeAny: ["stat_card"], mustIncludeAny2: ["table"], forbidden: ["trace_waterfall"], widgetCount: [3, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Multi-service error rate elevation",
      severity: "warning",
      query_intent: "multi-service-error-survey",
    },
    widgets: [
      stat(1, "Services degraded", 4, "of 12", { status: "degraded", trend: { direction: "up", magnitude: "+3 vs 1h ago", good_or_bad: "bad" } }),
      stat(2, "Total error rate", 2.1, "%", { baseline: 0.3, status: "degraded" }),
      stat(3, "Worst service", "checkout-api", "", { status: "unhealthy" }),
      tab(4, "Per-service error rate", [
        { key: "svc", label: "Service", kind: "code" },
        { key: "err", label: "Error rate", kind: "number", align: "right" },
        { key: "delta", label: "Δ vs baseline", kind: "text" },
        COL_HEALTH,
      ], [
        { svc: "checkout-api", err: 4.6, delta: "+1050%", health: "unhealthy" },
        { svc: "payment-service", err: 3.1, delta: "+520%", health: "unhealthy" },
        { svc: "order-service", err: 1.8, delta: "+260%", health: "warning" },
        { svc: "user-service", err: 0.9, delta: "+180%", health: "warning" },
      ]),
      changes(5, "Shared infra changes", [
        { timestamp: "13:30 UTC", title: "RDS aurora-prod minor version upgrade", kind: "infra", principal: "platform-admin" },
      ]),
    ],
  },
});

C.push({
  id: "err-07",
  category: "error-investigation",
  prompt: "Lambda function timing out on cold starts",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "log_viewer"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Lambda cold-start timeouts — image-resize-fn",
      severity: "warning",
      query_intent: "lambda-cold-start-timeout",
      service: "image-resize-fn",
    },
    widgets: [
      stat(1, "Cold-start timeout rate", 12, "%", { baseline: 1, baseline_label: "7d avg", trend: { direction: "up", magnitude: "+1100%", good_or_bad: "bad" }, status: "unhealthy" }),
      stat(2, "Cold-start p99 init duration", 8200, "ms", { baseline: 2400, status: "degraded" }),
      stat(3, "Configured timeout", 10, "s", { status: "neutral" }),
      tab(4, "Cold-starts by region", [
        { key: "region", label: "Region", kind: "text" },
        { key: "rate", label: "CS timeout %", kind: "number", align: "right" },
        { key: "p99", label: "Init p99 (ms)", kind: "number", align: "right" },
      ], [
        { region: "us-east-1", rate: 14, p99: 8400 },
        { region: "eu-west-1", rate: 9, p99: 6800 },
      ]),
      logs(5, "Init phase log sample", "/aws/lambda/image-resize-fn", [
        { timestamp: "14:00:01.123", severity: "info", message: "INIT_START Runtime Version: nodejs20.v18" },
        { timestamp: "14:00:09.890", severity: "error", message: "Task timed out after 10.00 seconds (in INIT phase)" },
      ]),
    ],
  },
});

C.push({
  id: "err-08",
  category: "error-investigation",
  prompt: "DynamoDB throttling errors in checkout flow",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "log_viewer"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "DynamoDB throttling — checkout-api carts table",
      severity: "critical",
      query_intent: "dynamodb-throttle",
      service: "checkout-api",
    },
    widgets: [
      stat(1, "Throttled requests/min", 240, "", { baseline: 0, status: "unhealthy", trend: { direction: "up", magnitude: "+∞", good_or_bad: "bad" } }),
      stat(2, "Provisioned RCU", 200, "", { status: "neutral" }),
      stat(3, "Consumed RCU peak", 480, "", { status: "unhealthy", trend: { direction: "up", magnitude: "+140% vs baseline", good_or_bad: "bad" } }),
      tab(4, "Throttling by operation", [
        { key: "op", label: "DynamoDB op", kind: "code" },
        { key: "throttles", label: "Throttles/min", kind: "number", align: "right" },
        { key: "rcu", label: "Consumed RCU", kind: "number", align: "right" },
      ], [
        { op: "Query carts pk=user#*", throttles: 180, rcu: 320 },
        { op: "GetItem carts", throttles: 60, rcu: 160 },
      ]),
      logs(5, "Throttle exception sample", "/aws/ecs/checkout-api", [
        { timestamp: "14:08:02", severity: "error", message: "DynamoDB ProvisionedThroughputExceededException on table=carts" },
      ]),
    ],
  },
});

C.push({
  id: "err-09",
  category: "error-investigation",
  prompt: "API Gateway returning 403 forbidden intermittently",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "log_viewer", "change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "API Gateway 403s — intermittent",
      severity: "warning",
      query_intent: "api-gw-auth-failures",
      service: "api-gateway",
    },
    widgets: [
      stat(1, "403 rate", 1.2, "%", { baseline: 0.05, baseline_label: "7d avg", trend: { direction: "up", magnitude: "+2300%", good_or_bad: "bad" }, status: "degraded" }),
      stat(2, "Affected requests/min", 36, "", { status: "degraded" }),
      tab(3, "403s by usage plan / API key", [
        { key: "key", label: "API key (last 4)", kind: "code" },
        { key: "plan", label: "Usage plan", kind: "text" },
        { key: "n", label: "403s/min", kind: "number", align: "right" },
      ], [
        { key: "…a3f1", plan: "partner-tier", n: 24 },
        { key: "…b7d2", plan: "enterprise", n: 8 },
      ]),
      logs(4, "API GW execution log sample", "API-Gateway-Execution-Logs_xyz/prod", [
        { timestamp: "14:02:11", severity: "error", message: "Forbidden: Authorizer returned no policy (token validation failed)" },
      ]),
      changes(5, "Recent IAM/auth changes", [
        { timestamp: "Yesterday 18:40 UTC", title: "Authorizer Lambda updated — new JWKS endpoint", kind: "config", principal: "platform-admin" },
      ]),
    ],
  },
});

C.push({
  id: "err-10",
  category: "error-investigation",
  prompt: "ECS task keeps crashing with OOM killer",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "log_viewer", "timeline"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "ECS task OOM — recommendations-svc",
      severity: "critical",
      query_intent: "ecs-oom-restart",
      service: "recommendations-svc",
    },
    widgets: [
      stat(1, "OOM kills (1h)", 14, "", { baseline: 0, status: "unhealthy", trend: { direction: "up", magnitude: "+∞", good_or_bad: "bad" } }),
      stat(2, "Memory limit", 1024, "MB", { status: "neutral" }),
      stat(3, "Avg memory at kill", 1018, "MB", { status: "unhealthy" }),
      spark(4, "Container memory (last hour)", [410, 490, 580, 720, 880, 1018, 1024], { unit: "MB", color: "red", current: 1024 }),
      tl(5, "OOM events in last hour", [
        { timestamp: "14:02 UTC", title: "Task arn:…/abc123 OOM-killed", severity: "critical" },
        { timestamp: "14:18 UTC", title: "Task arn:…/def456 OOM-killed", severity: "critical" },
        { timestamp: "14:34 UTC", title: "Task arn:…/ghi789 OOM-killed", severity: "critical" },
      ]),
    ],
  },
});

// ---------- Category 2: Latency / performance ----------
C.push({
  id: "lat-01",
  category: "latency-performance",
  prompt: "Why is my API slow?",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "API latency investigation",
      severity: "warning",
      query_intent: "latency-regression",
      service: "api",
    },
    widgets: [
      stat(1, "p99 latency", 1240, "ms", { baseline: 220, baseline_label: "7d avg", trend: { direction: "up", magnitude: "+463%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [220, 240, 280, 410, 720, 980, 1240] }),
      stat(2, "p50 latency", 380, "ms", { baseline: 90, status: "degraded" }),
      spark(3, "p99 (last 6h)", [220, 240, 260, 410, 720, 980, 1100, 1240], { unit: "ms", color: "orange", current: 1240 }),
      tab(4, "Slowest endpoints", [COL_OP, { key: "p99", label: "p99 (ms)", kind: "number", align: "right" }, { key: "delta", label: "Δ vs 7d", kind: "text" }, COL_HEALTH], [
        { op: "POST /checkout", p99: 2100, delta: "+520%", health: "unhealthy" },
        { op: "GET /search", p99: 880, delta: "+200%", health: "warning" },
      ]),
      changes(5, "Recent changes", [
        { timestamp: "12:30 UTC", title: "RDS aurora-prod scaled to db.r6g.large", kind: "infra", principal: "platform-admin" },
      ]),
    ],
  },
});

C.push({
  id: "lat-02",
  category: "latency-performance",
  prompt: "P99 latency increased from 200ms to 2s on user-service",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "trace_waterfall", "change_event_list"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "user-service p99 200ms → 2s",
      severity: "critical",
      query_intent: "latency-regression",
      service: "user-service",
    },
    widgets: [
      stat(1, "p99 latency", 2010, "ms", { baseline: 200, baseline_label: "7d avg", trend: { direction: "up", magnitude: "+905%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [200, 220, 280, 540, 1100, 1700, 2010] }),
      stat(2, "p50 latency", 410, "ms", { baseline: 60, trend: { direction: "up", magnitude: "+583%", good_or_bad: "bad" }, status: "degraded" }),
      tab(3, "Self-time by downstream", [
        { key: "dep", label: "Downstream", kind: "code" },
        { key: "self", label: "Self-time (ms)", kind: "number", align: "right" },
        { key: "share", label: "Share of p99", kind: "text" },
      ], [
        { dep: "rds.users.read", self: 1620, share: "81%" },
        { dep: "redis.cache.get", self: 220, share: "11%" },
        { dep: "dynamodb.profile.get", self: 130, share: "6%" },
      ]),
      changes(4, "Recent changes", [
        { timestamp: "1d ago", title: "users RDS instance class change", kind: "infra", principal: "platform-admin" },
      ]),
    ],
  },
});

C.push({
  id: "lat-03",
  category: "latency-performance",
  prompt: "Trace analysis: slow checkout flow",
  expected: { shell: "single-focus", mustInclude: ["trace_waterfall"], widgetCount: [1, 4] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Slow trace — POST /checkout (1.84s)",
      severity: "warning",
      query_intent: "latency-regression-trace",
      service: "checkout-api",
    },
    widgets: [
      stat(1, "Total duration", 1840, "ms", { baseline: 220, baseline_label: "p99 7d", status: "unhealthy", trend: { direction: "up", magnitude: "+736%", good_or_bad: "bad" } }),
      trace(2, "1-66348f12-5a3b9c0e", 1840, [
        { name: "POST /checkout", service: "checkout-api", start_ms: 0,    duration_ms: 1840, depth: 0, status: "error", self_time_ms: 30 },
        { name: "auth.verify",    service: "auth-svc",     start_ms: 12,   duration_ms: 38,   depth: 1, status: "ok" },
        { name: "db.cart.read",   service: "cart-db",      start_ms: 60,   duration_ms: 1620, depth: 1, status: "throttled" },
        { name: "ddb.query",      service: "cart-db",      start_ms: 80,   duration_ms: 1590, depth: 2, status: "throttled" },
        { name: "payment.charge", service: "payment-svc",  start_ms: 1700, duration_ms: 130,  depth: 1, status: "ok" },
      ]),
    ],
  },
});

C.push({
  id: "lat-04",
  category: "latency-performance",
  prompt: "Which downstream dependency is causing latency?",
  expected: { shell: "investigation", mustInclude: ["table"], mustIncludeAny: ["stat_card", "sparkline"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Latency by downstream dependency",
      severity: "warning",
      query_intent: "latency-regression-deps",
      service: "checkout-api",
    },
    widgets: [
      stat(1, "Service p99", 1240, "ms", { baseline: 220, status: "unhealthy" }),
      tab(2, "Downstream contribution to p99", [
        { key: "dep", label: "Dependency", kind: "code" },
        { key: "calls", label: "Calls / req", kind: "number", align: "right" },
        { key: "self", label: "Self-time (ms)", kind: "number", align: "right" },
        { key: "share", label: "Share of p99", kind: "text" },
        COL_HEALTH,
      ], [
        { dep: "cart-db (DynamoDB)", calls: 1.0, self: 980, share: "79%", health: "unhealthy" },
        { dep: "payment-svc",       calls: 1.0, self: 130, share: "10%", health: "warning" },
        { dep: "auth-svc",          calls: 1.0, self: 38,  share: "3%",  health: "healthy" },
        { dep: "fraud-svc",         calls: 0.4, self: 22,  share: "2%",  health: "healthy" },
      ]),
      spark(3, "cart-db p99 (last 24h)", [180, 200, 240, 320, 580, 820, 980], { unit: "ms", color: "red", current: 980 }),
    ],
  },
});

C.push({
  id: "lat-05",
  category: "latency-performance",
  prompt: "Compare latency before and after deployment",
  // All-density-1 widget mix routes to dashboard per the engine's heuristic;
  // an investigation render is also acceptable for this prompt shape.
  expected: { shell: ["investigation", "dashboard"], mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["change_event_list", "timeline", "table"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Latency: pre-deploy vs post-deploy",
      severity: "warning",
      query_intent: "latency-deploy-correlation",
      service: "api",
    },
    widgets: [
      stat(1, "p99 pre-deploy", 220, "ms", { status: "healthy" }),
      stat(2, "p99 post-deploy", 940, "ms", { trend: { direction: "up", magnitude: "+327%", good_or_bad: "bad" }, status: "unhealthy" }),
      stat(3, "p50 post-deploy", 320, "ms", { baseline: 80, trend: { direction: "up", magnitude: "+300%", good_or_bad: "bad" }, status: "degraded" }),
      spark(4, "p99 around deploy (T±30min)", [220, 230, 220, 240, 220, 580, 720, 880, 940, 920, 940], { unit: "ms", color: "orange", current: 940 }),
      changes(5, "Deploys in window", [
        { timestamp: "13:50 UTC", title: "ECS service api → rev-204 (added intl shipping)", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "lat-06",
  category: "latency-performance",
  prompt: "Database query taking 30 seconds",
  expected: { shell: ["investigation", "single-focus"], mustIncludeAny: ["stat_card"], mustIncludeAny2: ["log_viewer", "table", "trace_waterfall"], widgetCount: [2, 6] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "30s RDS query — orders.list_recent",
      severity: "critical",
      query_intent: "slow-db-query",
      service: "order-service",
    },
    widgets: [
      stat(1, "Slowest query duration", 30200, "ms", { baseline: 180, status: "unhealthy", trend: { direction: "up", magnitude: "+16678%", good_or_bad: "bad" } }),
      stat(2, "Query count > 5s", 84, "", { baseline: 0, status: "unhealthy" }),
      tab(3, "Top slow queries", [
        { key: "q", label: "Query (digest)", kind: "code" },
        { key: "p99", label: "p99 (ms)", kind: "number", align: "right" },
        { key: "calls", label: "Calls/min", kind: "number", align: "right" },
      ], [
        { q: "SELECT … FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", p99: 30200, calls: 8 },
        { q: "SELECT … FROM order_items JOIN orders ON …", p99: 18400, calls: 12 },
      ]),
      logs(4, "Slow query log", "/aws/rds/aurora-prod/slowquery", [
        { timestamp: "14:08:02", severity: "warn", message: "# Time: 30.21s  Lock_time: 0.00s Rows_examined: 4_812_004 SELECT … FROM orders WHERE user_id = 12 ORDER BY created_at DESC" },
      ]),
    ],
  },
});

C.push({
  id: "lat-07",
  category: "latency-performance",
  prompt: "Cold start latency on Lambda functions",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustInclude: ["table"], forbidden: ["trace_waterfall"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Lambda cold-start latency overview",
      severity: "warning",
      query_intent: "lambda-cold-start",
    },
    widgets: [
      stat(1, "Cold-start rate (1h)", 8.4, "%", { baseline: 6.0, status: "neutral" }),
      stat(2, "Init p99 (worst fn)", 6800, "ms", { baseline: 2200, status: "degraded" }),
      stat(3, "Functions with regression", 4, "of 31", { status: "warning" }),
      tab(4, "Worst cold-start by function", [
        { key: "fn", label: "Function", kind: "code" },
        { key: "init_p99", label: "Init p99 (ms)", kind: "number", align: "right" },
        { key: "rate", label: "CS rate", kind: "number", align: "right" },
        { key: "runtime", label: "Runtime", kind: "text" },
      ], [
        { fn: "image-resize-fn", init_p99: 6800, rate: 12.0, runtime: "nodejs20.x" },
        { fn: "report-export-fn", init_p99: 4900, rate: 18.0, runtime: "python3.12" },
        { fn: "auth-verify-fn", init_p99: 2400, rate: 4.0, runtime: "nodejs20.x" },
      ]),
      spark(5, "Worst-fn init p99 (24h)", [2200, 2400, 2300, 3400, 5600, 6500, 6800], { unit: "ms", color: "orange", current: 6800 }),
    ],
  },
});

C.push({
  id: "lat-08",
  category: "latency-performance",
  prompt: "Cross-region latency between us-east-1 and eu-west-1",
  expected: { shell: "investigation", mustInclude: ["table"], mustIncludeAny: ["stat_card", "sparkline"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "us-east-1 ↔ eu-west-1 cross-region latency",
      severity: "info",
      query_intent: "cross-region-latency",
    },
    widgets: [
      stat(1, "Cross-region p99", 142, "ms", { baseline: 90, status: "warning", trend: { direction: "up", magnitude: "+58%", good_or_bad: "bad" } }),
      stat(2, "Cross-region p50", 88, "ms", { baseline: 78, status: "neutral" }),
      tab(3, "Latency by route", [
        { key: "src", label: "From", kind: "text" },
        { key: "dst", label: "To", kind: "text" },
        { key: "p50", label: "p50 (ms)", kind: "number", align: "right" },
        { key: "p99", label: "p99 (ms)", kind: "number", align: "right" },
      ], [
        { src: "us-east-1 (api)", dst: "eu-west-1 (rds replica)", p50: 88, p99: 142 },
        { src: "eu-west-1 (api)", dst: "us-east-1 (kinesis)",     p50: 92, p99: 156 },
      ]),
      spark(4, "Cross-region p99 (24h)", [88, 90, 95, 110, 130, 140, 142], { unit: "ms", color: "orange", current: 142 }),
    ],
  },
});

C.push({
  id: "lat-09",
  category: "latency-performance",
  prompt: "API response time degraded after scaling event",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["change_event_list", "timeline", "table"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "p99 regression after ECS scale-in",
      severity: "warning",
      query_intent: "scaling-correlated-latency",
      service: "api",
    },
    widgets: [
      stat(1, "p99 now", 920, "ms", { baseline: 220, status: "unhealthy", trend: { direction: "up", magnitude: "+318%", good_or_bad: "bad" } }),
      stat(2, "Active task count", 4, "", { baseline: 12, status: "warning", trend: { direction: "down", magnitude: "-66%", good_or_bad: "bad" } }),
      stat(3, "CPU utilization (avg)", 89, "%", { baseline: 30, status: "unhealthy" }),
      changes(4, "Scaling events (last 1h)", [
        { timestamp: "13:40 UTC", title: "Scale-in target capacity 12 → 4 (predictive)", kind: "infra", principal: "scaling-policy:cpu-target-30" },
      ]),
      tl(5, "Timeline", [
        { timestamp: "13:40 UTC", title: "Scale-in to 4 tasks", severity: "info" },
        { timestamp: "13:42 UTC", title: "p99 crossed 500ms", severity: "warning" },
        { timestamp: "13:55 UTC", title: "p99 crossed 900ms", severity: "critical" },
      ]),
    ],
  },
});

C.push({
  id: "lat-10",
  category: "latency-performance",
  prompt: "Identify bottleneck in microservice chain",
  expected: { shell: ["single-focus", "investigation"], mustInclude: ["trace_waterfall"], widgetCount: [1, 5] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Microservice chain bottleneck — checkout flow",
      severity: "warning",
      query_intent: "latency-regression-trace",
    },
    widgets: [
      stat(1, "Total chain duration", 2200, "ms", { baseline: 240, status: "unhealthy" }),
      trace(2, "1-67aa12f-mc-chain", 2200, [
        { name: "POST /checkout", service: "edge-api",       start_ms: 0,    duration_ms: 2200, depth: 0, status: "ok" },
        { name: "auth.verify",    service: "auth-svc",       start_ms: 5,    duration_ms: 60,   depth: 1, status: "ok" },
        { name: "cart.read",      service: "cart-svc",       start_ms: 70,   duration_ms: 90,   depth: 1, status: "ok" },
        { name: "fraud.score",    service: "fraud-svc",      start_ms: 165,  duration_ms: 1700, depth: 1, status: "ok" },
        { name: "ml.inference",   service: "fraud-ml-fn",    start_ms: 200,  duration_ms: 1640, depth: 2, status: "ok" },
        { name: "payment.charge", service: "payment-svc",    start_ms: 1870, duration_ms: 320,  depth: 1, status: "ok" },
      ]),
    ],
  },
});

// ---------- Category 3: SLO / service health ----------
C.push({
  id: "slo-01",
  category: "slo-service-health",
  prompt: "Show me SLO compliance for all services",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [3, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "SLO compliance — all services",
      severity: "warning",
      query_intent: "slo-compliance-report",
      subtitle: "12 services · 22 SLOs · last 7 days",
    },
    widgets: [
      stat(1, "SLOs in breach", 4, "of 22", { status: "unhealthy" }),
      stat(2, "Burning fast", 2, "services", { status: "degraded" }),
      stat(3, "Healthy", 18, "of 22", { status: "healthy", sparkline: [16, 17, 18, 18, 19, 18, 18] }),
      stat(4, "Avg budget remaining", 58, "%", { trend: { direction: "down", magnitude: "-12 pts", good_or_bad: "bad" } }),
      changes(5, "Largest burns this week", [
        { timestamp: "Mon", title: "checkout-api availability — 22% burn", kind: "other" },
        { timestamp: "Wed", title: "auth-svc latency — 14% burn", kind: "other" },
      ]),
      changes(6, "Recent SLO config changes", [
        { timestamp: "Tue", title: "p99 target tightened on cart-svc", kind: "config", principal: "platform-team" },
      ]),
    ],
  },
});

C.push({
  id: "slo-02",
  category: "slo-service-health",
  prompt: "Which SLOs are at risk of breaching?",
  expected: { shell: ["dashboard", "investigation"], mustInclude: ["table"], mustIncludeAny: ["stat_card"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "SLOs at risk of breach",
      severity: "warning",
      query_intent: "slo-at-risk",
    },
    widgets: [
      stat(1, "At-risk SLOs", 5, "of 22", { status: "degraded" }),
      stat(2, "Worst burn rate", 6.2, "× target", { status: "unhealthy" }),
      tab(3, "At-risk SLOs", [
        { key: "svc", label: "Service", kind: "code" },
        { key: "slo", label: "SLO", kind: "text" },
        { key: "br", label: "Burn × target", kind: "number", align: "right" },
        { key: "remain", label: "Budget left", kind: "text" },
        COL_HEALTH,
      ], [
        { svc: "checkout-api", slo: "availability 99.9%", br: 6.2, remain: "8%", health: "unhealthy" },
        { svc: "auth-svc", slo: "p99 < 200ms", br: 3.4, remain: "32%", health: "warning" },
        { svc: "cart-svc", slo: "availability 99.5%", br: 2.1, remain: "44%", health: "warning" },
      ]),
    ],
  },
});

C.push({
  id: "slo-03",
  category: "slo-service-health",
  prompt: "Error budget status for payment-service",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "payment-service error budget — 30d window",
      severity: "warning",
      query_intent: "slo-error-budget",
      service: "payment-service",
    },
    widgets: [
      stat(1, "Budget remaining", 18, "%", { baseline: 100, baseline_label: "30d window start", status: "degraded", trend: { direction: "down", magnitude: "-22 pts vs last week", good_or_bad: "bad" } }),
      stat(2, "Burn rate", 4.6, "× target", { status: "unhealthy" }),
      stat(3, "Days until exhaustion (at current burn)", 1.4, "days", { status: "unhealthy" }),
      spark(4, "Budget remaining (30d)", [100, 95, 88, 78, 64, 48, 30, 18], { unit: "%", color: "red", current: 18 }),
      tl(5, "Largest burn events", [
        { timestamp: "T-6d", title: "Stripe API outage — 8% burn", severity: "critical" },
        { timestamp: "T-2d", title: "rev-198 deploy regression — 14% burn", severity: "warning" },
      ]),
    ],
  },
});

C.push({
  id: "slo-04",
  category: "slo-service-health",
  prompt: "Service health overview for production",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [4, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Production health overview",
      severity: "info",
      query_intent: "service-overview",
      subtitle: "12 services · last 1h",
    },
    widgets: [
      stat(1, "Healthy services", 9, "of 12", { status: "healthy" }),
      stat(2, "Degraded", 2, "of 12", { status: "degraded" }),
      stat(3, "Unhealthy", 1, "of 12", { status: "unhealthy" }),
      stat(4, "Active alarms", 4, "", { status: "warning" }),
      stat(5, "Avg p99", 320, "ms", { baseline: 290, status: "neutral" }),
      stat(6, "Avg error rate", 0.6, "%", { baseline: 0.3, status: "warning" }),
    ],
  },
});

C.push({
  id: "slo-05",
  category: "slo-service-health",
  prompt: "SLO breach on availability target for auth-service",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["timeline", "change_event_list", "table"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "auth-service availability SLO breach",
      severity: "critical",
      query_intent: "slo-breach",
      service: "auth-service",
    },
    widgets: [
      stat(1, "Availability (1h)", 99.42, "%", { baseline: 99.95, baseline_label: "SLO target 99.9%", status: "unhealthy" }),
      stat(2, "Budget remaining", 8, "%", { trend: { direction: "down", magnitude: "-18 pts", good_or_bad: "bad" }, status: "unhealthy" }),
      stat(3, "Burn rate (5m)", 14.2, "× target", { status: "unhealthy" }),
      tl(4, "Breach milestones", [
        { timestamp: "13:55 UTC", title: "Burn rate crossed 4× target", severity: "warning" },
        { timestamp: "14:02 UTC", title: "Budget at 50%", severity: "warning" },
        { timestamp: "14:08 UTC", title: "Budget at 25% — fast burn alarm fired", severity: "critical" },
      ]),
      tab(5, "Top failing operations", [COL_OP, COL_ERR, COL_HEALTH], [
        { op: "POST /auth/login", errors: 142, health: "unhealthy" },
        { op: "POST /auth/refresh", errors: 24, health: "warning" },
      ]),
      changes(6, "Recent changes", [
        { timestamp: "13:50 UTC", title: "Authorizer Lambda updated", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "slo-06",
  category: "slo-service-health",
  prompt: "Monthly SLO compliance report",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [4, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Monthly SLO compliance",
      severity: "info",
      query_intent: "slo-compliance-monthly",
      subtitle: "April 2026 · 12 services · 22 SLOs",
    },
    widgets: [
      stat(1, "SLOs met", 19, "of 22", { status: "healthy" }),
      stat(2, "SLOs breached", 3, "of 22", { status: "unhealthy" }),
      stat(3, "Avg budget consumed", 42, "%", { status: "neutral", sparkline: [38, 40, 42, 44, 42, 41, 42] }),
      stat(4, "Worst service", "checkout-api", "", { status: "unhealthy" }),
      changes(5, "Top burn events this month", [
        { timestamp: "Apr 04", title: "Stripe outage — checkout-api 22% burn", kind: "other" },
        { timestamp: "Apr 12", title: "auth-svc rev-178 regression — 14% burn", kind: "other" },
        { timestamp: "Apr 19", title: "RDS failover — order-service 9% burn", kind: "other" },
      ]),
    ],
  },
});

C.push({
  id: "slo-07",
  category: "slo-service-health",
  prompt: "Which services have the worst error rates?",
  expected: { shell: ["dashboard", "investigation"], mustInclude: ["table"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Services ranked by error rate",
      severity: "warning",
      query_intent: "service-error-ranking",
    },
    widgets: [
      stat(1, "Median error rate", 0.4, "%", { status: "neutral" }),
      stat(2, "Worst service error rate", 4.6, "%", { status: "unhealthy" }),
      tab(3, "Services by error rate (1h)", [
        { key: "svc", label: "Service", kind: "code" },
        { key: "err", label: "Error rate %", kind: "number", align: "right" },
        { key: "rps", label: "RPS", kind: "number", align: "right" },
        COL_HEALTH,
      ], [
        { svc: "checkout-api", err: 4.6, rps: 220, health: "unhealthy" },
        { svc: "payment-service", err: 3.1, rps: 140, health: "unhealthy" },
        { svc: "order-service", err: 1.8, rps: 410, health: "warning" },
        { svc: "user-service", err: 0.6, rps: 920, health: "healthy" },
        { svc: "search-svc", err: 0.2, rps: 1240, health: "healthy" },
      ]),
    ],
  },
});

C.push({
  id: "slo-08",
  category: "slo-service-health",
  prompt: "Dashboard: current state of all production services",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [4, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Production services — live state",
      severity: "info",
      query_intent: "service-overview",
      subtitle: "12 services · last 5m",
    },
    widgets: [
      stat(1, "Healthy", 9, "of 12", { status: "healthy" }),
      stat(2, "Degraded", 2, "of 12", { status: "degraded" }),
      stat(3, "Unhealthy", 1, "of 12", { status: "unhealthy" }),
      stat(4, "Total RPS", 4820, "", { status: "neutral", sparkline: [4400, 4600, 4700, 4820, 4750, 4820, 4820] }),
      stat(5, "Avg p99 (across svcs)", 320, "ms", { status: "warning" }),
      stat(6, "Active alarms", 3, "", { status: "warning" }),
    ],
  },
});

C.push({
  id: "slo-09",
  category: "slo-service-health",
  prompt: "How much error budget do we have left this quarter?",
  expected: { shell: ["single-focus", "investigation"], mustIncludeAny: ["stat_card", "sparkline"], widgetCount: [1, 5] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Quarterly error budget remaining",
      severity: "info",
      query_intent: "error-budget-quarterly",
      subtitle: "Q2 2026 · day 28 of 91",
    },
    widgets: [
      stat(1, "Budget remaining", 71, "%", { baseline: 100, status: "healthy", trend: { direction: "down", magnitude: "-29 pts", good_or_bad: "neutral" } }),
      spark(2, "Daily budget consumed (Q2)", [0, 0.4, 0.8, 1.1, 1.6, 2.4, 3.1, 4.0, 5.2, 6.4, 7.8, 9.0, 10.6, 12.4, 14.1, 15.8, 17.6, 19.4, 21.0, 22.6, 23.8, 24.9, 25.8, 26.5, 27.2, 27.8, 28.4, 29.0], { unit: "%", color: "blue", current: 29.0 }),
    ],
  },
});

C.push({
  id: "slo-10",
  category: "slo-service-health",
  prompt: "Service health card for order-processing",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Service health — order-processing",
      severity: "warning",
      query_intent: "service-health-card",
      service: "order-processing",
    },
    widgets: [
      stat(1, "Rate (RPS)", 412, "", { baseline: 380, status: "healthy", sparkline: [380, 385, 390, 400, 412, 415, 412] }),
      stat(2, "Errors %", 1.4, "%", { baseline: 0.3, status: "degraded" }),
      stat(3, "p99 latency", 720, "ms", { baseline: 280, status: "degraded" }),
      tab(4, "Top dependencies", [
        { key: "dep", label: "Dependency", kind: "code" },
        { key: "p99", label: "p99 (ms)", kind: "number", align: "right" },
        COL_HEALTH,
      ], [
        { dep: "orders-db", p99: 410, health: "warning" },
        { dep: "kafka.order-events", p99: 24, health: "healthy" },
      ]),
      changes(5, "Recent deploys", [
        { timestamp: "1d ago", title: "rev-77 deployed", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

// ---------- Category 4: CloudTrail / security ----------
C.push({
  id: "ct-01",
  category: "cloudtrail-security",
  prompt: "Who modified the IAM policy yesterday?",
  expected: { shell: "investigation", mustInclude: ["change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [1, 6] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "IAM policy modifications — yesterday",
      severity: "warning",
      query_intent: "cloudtrail-iam-changes",
    },
    widgets: [
      stat(1, "IAM events (24h)", 8, "", { baseline: 1, status: "warning", trend: { direction: "up", magnitude: "+700%", good_or_bad: "bad" } }),
      changes(2, "IAM policy modifications (24h)", [
        { timestamp: "Yesterday 09:14 UTC", title: "AttachRolePolicy on prod-deploy", kind: "iam", principal: "alice@corp.com (root)", resource: "arn:aws:iam::…:role/prod-deploy" },
        { timestamp: "Yesterday 11:32 UTC", title: "PutRolePolicy on data-eng-readonly", kind: "iam", principal: "bob@corp.com",       resource: "arn:aws:iam::…:role/data-eng-readonly" },
        { timestamp: "Yesterday 14:08 UTC", title: "DeleteRolePolicy on legacy-app", kind: "iam", principal: "alice@corp.com",         resource: "arn:aws:iam::…:role/legacy-app" },
      ]),
      tab(3, "Top principals", [
        { key: "p", label: "Principal", kind: "code" },
        { key: "n", label: "Events", kind: "number", align: "right" },
      ], [
        { p: "alice@corp.com", n: 4 },
        { p: "bob@corp.com", n: 2 },
        { p: "deploy-bot",   n: 2 },
      ]),
    ],
  },
});

C.push({
  id: "ct-02",
  category: "cloudtrail-security",
  prompt: "Show me CloudTrail events for the last 24 hours",
  expected: { shell: ["investigation", "dashboard"], mustInclude: ["change_event_list"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [1, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "CloudTrail events — last 24h",
      severity: "info",
      query_intent: "cloudtrail-survey",
    },
    widgets: [
      stat(1, "Total events", 1842, "", { status: "neutral" }),
      stat(2, "Write events", 312, "", { status: "neutral" }),
      stat(3, "Failed (errorCode)", 41, "", { status: "warning" }),
      changes(4, "Notable events (24h)", [
        { timestamp: "08:14 UTC", title: "ECS UpdateService on prod cluster", kind: "deploy", principal: "deploy-bot" },
        { timestamp: "09:14 UTC", title: "AttachRolePolicy on prod-deploy", kind: "iam",   principal: "alice@corp.com" },
        { timestamp: "12:30 UTC", title: "RDS ModifyDBInstance on aurora-prod", kind: "infra", principal: "platform-admin" },
        { timestamp: "14:02 UTC", title: "S3 PutBucketPolicy on logs-archive", kind: "config", principal: "data-eng-bot" },
      ]),
    ],
  },
});

C.push({
  id: "ct-03",
  category: "cloudtrail-security",
  prompt: "Security audit: unauthorized access attempts",
  expected: { shell: "investigation", mustIncludeAny: ["table", "change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Unauthorized access attempts (24h)",
      severity: "warning",
      query_intent: "security-audit-unauthorized",
    },
    widgets: [
      stat(1, "Denied API calls", 142, "", { baseline: 12, status: "warning", trend: { direction: "up", magnitude: "+1083%", good_or_bad: "bad" } }),
      stat(2, "Unique principals", 6, "", { status: "warning" }),
      tab(3, "Top denied actions", [
        { key: "action", label: "Action", kind: "code" },
        { key: "n", label: "Denied count", kind: "number", align: "right" },
        { key: "principals", label: "Principals", kind: "text" },
      ], [
        { action: "iam:GetAccountAuthorizationDetails", n: 84, principals: "intern-readonly, x-svc-bot" },
        { action: "secretsmanager:GetSecretValue", n: 28, principals: "legacy-app-role" },
        { action: "kms:Decrypt", n: 14, principals: "data-eng-readonly" },
      ]),
      changes(4, "Notable denied events", [
        { timestamp: "13:14 UTC", title: "iam:GetAccountAuthorizationDetails (denied)", kind: "iam", principal: "intern-readonly" },
      ]),
    ],
  },
});

C.push({
  id: "ct-04",
  category: "cloudtrail-security",
  prompt: "Track all S3 bucket policy changes this week",
  expected: { shell: ["investigation", "dashboard"], mustInclude: ["change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [1, 6] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "S3 bucket policy changes (7d)",
      severity: "info",
      query_intent: "cloudtrail-s3-policy-changes",
    },
    widgets: [
      stat(1, "PutBucketPolicy events", 6, "", { status: "neutral" }),
      stat(2, "DeleteBucketPolicy events", 1, "", { status: "warning" }),
      changes(3, "S3 policy events (7d)", [
        { timestamp: "Mon 09:30", title: "PutBucketPolicy on logs-archive", kind: "config", principal: "data-eng-bot", resource: "arn:aws:s3:::logs-archive" },
        { timestamp: "Tue 14:20", title: "DeleteBucketPolicy on legacy-uploads", kind: "config", principal: "platform-admin", resource: "arn:aws:s3:::legacy-uploads" },
        { timestamp: "Thu 11:08", title: "PutBucketPolicy on user-uploads (added cross-account principal)", kind: "config", principal: "alice@corp.com", resource: "arn:aws:s3:::user-uploads" },
      ]),
    ],
  },
});

C.push({
  id: "ct-05",
  category: "cloudtrail-security",
  prompt: "Who deleted the production database?",
  expected: { shell: ["investigation", "single-focus", "dashboard"], mustInclude: ["change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [1, 5] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "RDS DeleteDBInstance — investigation",
      severity: "critical",
      query_intent: "cloudtrail-rds-delete",
    },
    widgets: [
      stat(1, "Time of delete", "14:08 UTC", "", { status: "unhealthy" }),
      stat(2, "Principal", "ops-runbook-bot", "", { status: "warning" }),
      changes(3, "Deletion + surrounding events", [
        { timestamp: "14:00 UTC", title: "ModifyDBInstance: DeletionProtection=false", kind: "config", principal: "alice@corp.com",      resource: "arn:aws:rds:…:db:aurora-prod" },
        { timestamp: "14:08 UTC", title: "DeleteDBInstance on aurora-prod (skipFinalSnapshot=true)", kind: "infra", principal: "ops-runbook-bot", resource: "arn:aws:rds:…:db:aurora-prod" },
        { timestamp: "14:08 UTC", title: "Snapshot DeleteDBSnapshot aurora-prod-final-2026", kind: "infra", principal: "ops-runbook-bot" },
      ]),
    ],
  },
});

C.push({
  id: "ct-06",
  category: "cloudtrail-security",
  prompt: "IAM role assumption events for admin role",
  expected: { shell: "investigation", mustIncludeAny: ["table", "change_event_list"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "AssumeRole events — admin role (24h)",
      severity: "warning",
      query_intent: "cloudtrail-assume-role",
    },
    widgets: [
      stat(1, "AssumeRole events", 84, "", { baseline: 22, status: "warning", trend: { direction: "up", magnitude: "+282%", good_or_bad: "bad" } }),
      stat(2, "Unique principals", 5, "", { status: "neutral" }),
      tab(3, "AssumeRole by principal", [
        { key: "p", label: "Principal", kind: "code" },
        { key: "n", label: "Events", kind: "number", align: "right" },
        { key: "first", label: "First", kind: "text" },
        { key: "last", label: "Last", kind: "text" },
      ], [
        { p: "alice@corp.com", n: 32, first: "08:02", last: "16:40" },
        { p: "ops-runbook-bot", n: 28, first: "01:00", last: "23:00" },
        { p: "deploy-bot", n: 22, first: "08:14", last: "20:18" },
      ]),
      changes(4, "Most recent AssumeRole events", [
        { timestamp: "16:40 UTC", title: "AssumeRole admin (sourceIp=10.0.4.7)", kind: "iam", principal: "alice@corp.com" },
      ]),
    ],
  },
});

C.push({
  id: "ct-07",
  category: "cloudtrail-security",
  prompt: "API calls from unknown IP addresses",
  expected: { shell: "investigation", mustInclude: ["table"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "API calls from unrecognized source IPs (24h)",
      severity: "warning",
      query_intent: "cloudtrail-unknown-ip",
    },
    widgets: [
      stat(1, "Calls from unknown IPs", 62, "", { baseline: 0, status: "warning" }),
      stat(2, "Unique IPs", 4, "", { status: "warning" }),
      tab(3, "Calls by source IP", [
        { key: "ip", label: "Source IP", kind: "code" },
        { key: "calls", label: "Calls", kind: "number", align: "right" },
        { key: "principals", label: "Principals", kind: "text" },
        { key: "actions", label: "Top action", kind: "text" },
      ], [
        { ip: "203.0.113.42", calls: 28, principals: "alice@corp.com", actions: "iam:ListUsers" },
        { ip: "198.51.100.18", calls: 22, principals: "deploy-bot", actions: "ecs:UpdateService" },
        { ip: "203.0.113.99", calls: 12, principals: "alice@corp.com", actions: "secretsmanager:GetSecretValue" },
      ]),
      changes(4, "Notable events from unknown IPs", [
        { timestamp: "13:40 UTC", title: "secretsmanager:GetSecretValue from 203.0.113.99", kind: "iam", principal: "alice@corp.com" },
      ]),
    ],
  },
});

C.push({
  id: "ct-08",
  category: "cloudtrail-security",
  prompt: "Configuration changes that could affect availability",
  expected: { shell: "investigation", mustIncludeAny: ["change_event_list", "table"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Availability-impacting config changes (24h)",
      severity: "warning",
      query_intent: "cloudtrail-availability-changes",
    },
    widgets: [
      stat(1, "Risky changes", 6, "", { status: "warning" }),
      stat(2, "Distinct services touched", 4, "", { status: "neutral" }),
      changes(3, "Availability-impacting events", [
        { timestamp: "08:14 UTC", title: "ALB ModifyTargetGroup health check threshold 3 → 1", kind: "config", principal: "platform-admin", resource: "arn:aws:elasticloadbalancing:…:tg/api-prod" },
        { timestamp: "10:42 UTC", title: "ASG UpdateAutoScalingGroup min 4 → 2", kind: "infra", principal: "platform-admin", resource: "arn:aws:autoscaling:…:autoScalingGroupName/api-prod" },
        { timestamp: "13:50 UTC", title: "ECS UpdateService desiredCount 12 → 4", kind: "infra", principal: "scaling-policy:cpu-target-30", resource: "arn:aws:ecs:…:service/api" },
        { timestamp: "14:00 UTC", title: "RDS ModifyDBInstance: DeletionProtection=false", kind: "config", principal: "alice@corp.com" },
      ]),
      tab(4, "Changes by kind", [
        { key: "kind", label: "Kind", kind: "text" },
        { key: "n", label: "Count", kind: "number", align: "right" },
      ], [
        { kind: "infra", n: 3 },
        { kind: "config", n: 3 },
      ]),
    ],
  },
});

C.push({
  id: "ct-09",
  category: "cloudtrail-security",
  prompt: "Audit trail for KMS key usage",
  expected: { shell: "investigation", mustIncludeAny: ["change_event_list", "table"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "KMS key usage audit (24h)",
      severity: "info",
      query_intent: "cloudtrail-kms-audit",
    },
    widgets: [
      stat(1, "Decrypt operations", 14820, "", { status: "neutral" }),
      stat(2, "Distinct keys used", 8, "", { status: "neutral" }),
      stat(3, "Failed Decrypt", 14, "", { status: "warning" }),
      tab(4, "KMS usage by key", [
        { key: "key", label: "Key alias", kind: "code" },
        { key: "decrypts", label: "Decrypt", kind: "number", align: "right" },
        { key: "fails", label: "Fails", kind: "number", align: "right" },
      ], [
        { key: "alias/prod-app",     decrypts: 9420, fails: 4 },
        { key: "alias/secrets-svc",  decrypts: 4810, fails: 8 },
        { key: "alias/data-encr",    decrypts: 590,  fails: 2 },
      ]),
      changes(5, "Recent KMS events", [
        { timestamp: "14:08 UTC", title: "kms:Decrypt failed (AccessDenied) by data-eng-readonly", kind: "iam", principal: "data-eng-readonly" },
      ]),
    ],
  },
});

C.push({
  id: "ct-10",
  category: "cloudtrail-security",
  prompt: "CloudTrail events around the time of the incident",
  expected: { shell: "investigation", mustIncludeAny: ["change_event_list", "timeline"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "CloudTrail events around incident — 13:30 to 14:30 UTC",
      severity: "warning",
      query_intent: "cloudtrail-incident-window",
    },
    widgets: [
      stat(1, "Events in window", 124, "", { status: "neutral" }),
      stat(2, "Write events", 28, "", { status: "warning" }),
      tl(3, "Incident timeline", [
        { timestamp: "13:50 UTC", title: "ECS UpdateService api → rev-204", severity: "info" },
        { timestamp: "13:58 UTC", title: "Error rate exceeded 1% — fast burn alarm", severity: "warning" },
        { timestamp: "14:08 UTC", title: "Burn rate crossed 14× target", severity: "critical" },
      ]),
      changes(4, "All write events in window", [
        { timestamp: "13:42 UTC", title: "ALB ModifyListener (cert rotation)", kind: "config", principal: "platform-admin" },
        { timestamp: "13:50 UTC", title: "ECS UpdateService api → rev-204", kind: "deploy", principal: "deploy-bot", resource: "arn:aws:ecs:…:service/api" },
        { timestamp: "14:00 UTC", title: "RDS ModifyDBClusterParameterGroup", kind: "config", principal: "platform-admin" },
        { timestamp: "14:05 UTC", title: "ECS UpdateService api desiredCount 12 → 8", kind: "infra", principal: "scaling-policy" },
      ]),
    ],
  },
});

// ---------- Category 5: Mixed / complex (12 prompts) ----------
C.push({
  id: "mix-01",
  category: "mixed-complex",
  prompt: "Something's wrong with the checkout flow",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "log_viewer"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Checkout flow — current health snapshot",
      severity: "warning",
      query_intent: "ad-hoc-investigation",
      service: "checkout-api",
    },
    widgets: [
      stat(1, "Error rate", 3.2, "%", { baseline: 0.4, status: "unhealthy" }),
      stat(2, "p99 latency", 1240, "ms", { baseline: 240, status: "degraded" }),
      stat(3, "Conversion (proxy)", 78, "%", { baseline: 92, status: "warning" }),
      tab(4, "Failing operations", [COL_OP, COL_ERR, COL_P99, COL_HEALTH], [
        { op: "POST /checkout", errors: 142, p99: 2100, health: "unhealthy" },
        { op: "GET /cart", errors: 6, p99: 220, health: "warning" },
      ]),
      changes(5, "Recent changes", [
        { timestamp: "13:50 UTC", title: "Deploy checkout-api:rev-942", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "mix-02",
  category: "mixed-complex",
  prompt: "Help me understand what happened during last night's outage",
  expected: { shell: "investigation", mustIncludeAny: ["timeline"], mustIncludeAny2: ["change_event_list", "stat_card", "sparkline", "log_viewer"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Outage retrospective — 03:14–03:48 UTC",
      severity: "critical",
      query_intent: "post-incident-summary",
    },
    widgets: [
      stat(1, "Outage duration", 34, "min", { status: "unhealthy" }),
      stat(2, "Peak error rate", 28.4, "%", { baseline: 0.3, status: "unhealthy" }),
      stat(3, "Affected requests", 142000, "", { status: "unhealthy" }),
      tl(4, "Timeline", [
        { timestamp: "03:14 UTC", title: "RDS aurora-prod failover began", severity: "warning" },
        { timestamp: "03:17 UTC", title: "Error rate crossed 5%",           severity: "critical" },
        { timestamp: "03:22 UTC", title: "PagerDuty paged on-call",         severity: "critical" },
        { timestamp: "03:38 UTC", title: "RDS reader promoted, app reconnected", severity: "info" },
        { timestamp: "03:48 UTC", title: "Error rate back below 0.5% — recovery", severity: "success" },
      ]),
      changes(5, "Triggering changes", [
        { timestamp: "03:14 UTC", title: "RDS automatic failover (writer instance hardware fault)", kind: "infra", principal: "rds.amazonaws.com" },
      ]),
    ],
  },
});

C.push({
  id: "mix-03",
  category: "mixed-complex",
  prompt: "Is my service healthy after the deployment?",
  expected: { shell: ["investigation", "dashboard"], mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["change_event_list", "timeline", "table"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Post-deploy health check",
      severity: "info",
      query_intent: "post-deploy-health",
    },
    widgets: [
      stat(1, "Error rate", 0.4, "%", { baseline: 0.3, status: "healthy" }),
      stat(2, "p99 latency", 240, "ms", { baseline: 220, status: "healthy" }),
      stat(3, "RPS", 412, "", { baseline: 380, status: "healthy" }),
      changes(4, "Recent deploy", [
        { timestamp: "30 min ago", title: "ECS service api → rev-205", kind: "deploy", principal: "deploy-bot" },
      ]),
      spark(5, "Error rate (post-deploy 30min)", [0.3, 0.4, 0.4, 0.5, 0.4, 0.4, 0.4], { unit: "%", color: "green", current: 0.4 }),
    ],
  },
});

C.push({
  id: "mix-04",
  category: "mixed-complex",
  prompt: "Root cause analysis: payment failures",
  expected: { shell: "investigation", mustIncludeAny: ["stat_card"], mustIncludeAny2: ["table", "log_viewer", "change_event_list"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "RCA: payment failures",
      severity: "critical",
      query_intent: "rca-payment",
      service: "payment-service",
    },
    widgets: [
      stat(1, "Failure rate", 6.8, "%", { baseline: 0.5, status: "unhealthy" }),
      stat(2, "Failed payments (1h)", 412, "", { baseline: 30, status: "unhealthy" }),
      tab(3, "Hypotheses ranked", [
        { key: "h", label: "Hypothesis", kind: "text" },
        { key: "conf", label: "Confidence", kind: "status" },
        { key: "ev", label: "Evidence", kind: "text" },
      ], [
        { h: "Stripe rate limit (top cause)", conf: "unhealthy", ev: "60% of failures = HTTP 429 from Stripe" },
        { h: "Promo campaign 3× traffic",     conf: "warning",   ev: "RPS 3.1× baseline" },
        { h: "Recent deploy",                 conf: "healthy",   ev: "Last deploy 8h ago, rates were normal pre-promo" },
      ]),
      logs(4, "Failure log sample", "/aws/ecs/payment-service", [
        { timestamp: "14:02:11", severity: "error", message: "Stripe API call failed: rate_limit_exceeded (HTTP 429)" },
      ]),
      changes(5, "Recent changes", [
        { timestamp: "13:55 UTC", title: "Promo campaign launched", kind: "config", principal: "marketing-bot" },
      ]),
    ],
  },
});

C.push({
  id: "mix-05",
  category: "mixed-complex",
  prompt: "Compare service health before and after the release",
  expected: { shell: ["investigation", "dashboard"], mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["change_event_list", "table"], widgetCount: [3, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Health: pre-release vs post-release",
      severity: "info",
      query_intent: "release-health-comparison",
    },
    widgets: [
      stat(1, "Error rate Δ", "+0.1pp", "", { baseline: "0.3% → 0.4%", status: "neutral" }),
      stat(2, "p99 Δ", "+8ms", "", { baseline: "232ms → 240ms", status: "healthy" }),
      stat(3, "RPS Δ", "+8%", "", { baseline: "380 → 412", status: "healthy" }),
      spark(4, "p99 around release (T±60min)", [220, 230, 220, 240, 235, 240, 245, 240, 240, 240, 238], { unit: "ms", color: "green", current: 240 }),
      changes(5, "Release", [
        { timestamp: "T0 = 13:50 UTC", title: "ECS service api → rev-205", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "mix-06",
  category: "mixed-complex",
  prompt: "What changed in the last hour that could explain the errors?",
  expected: { shell: "investigation", mustInclude: ["change_event_list"], mustIncludeAny: ["stat_card", "sparkline"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Change correlation — last 1h",
      severity: "warning",
      query_intent: "change-correlation",
    },
    widgets: [
      stat(1, "Error rate now", 3.4, "%", { baseline: 0.2, status: "unhealthy" }),
      stat(2, "Changes in window", 7, "", { status: "warning" }),
      changes(3, "All changes (last 1h)", [
        { timestamp: "13:42 UTC", title: "ALB ModifyListener cert rotation", kind: "config", principal: "platform-admin" },
        { timestamp: "13:50 UTC", title: "ECS api → rev-204", kind: "deploy", principal: "deploy-bot" },
        { timestamp: "13:55 UTC", title: "Feature flag new_checkout=true", kind: "config", principal: "platform-admin" },
        { timestamp: "14:00 UTC", title: "RDS ModifyDBClusterParameterGroup", kind: "config", principal: "platform-admin" },
      ]),
      tab(4, "Change vs error correlation", [
        { key: "change", label: "Change", kind: "text" },
        { key: "lag", label: "Lag → 1st error", kind: "text" },
        { key: "score", label: "Correlation", kind: "status" },
      ], [
        { change: "ECS api → rev-204",         lag: "8 min", score: "warning" },
        { change: "Feature flag new_checkout", lag: "3 min", score: "unhealthy" },
        { change: "ALB cert rotation",         lag: "no error rise", score: "healthy" },
      ]),
    ],
  },
});

C.push({
  id: "mix-07",
  category: "mixed-complex",
  prompt: "Full investigation: why did the page load time double?",
  expected: { shell: ["investigation", "single-focus"], mustIncludeAny: ["stat_card", "sparkline"], mustIncludeAny2: ["table", "trace_waterfall", "change_event_list"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Page load time doubled — full investigation",
      severity: "warning",
      query_intent: "latency-regression",
    },
    widgets: [
      stat(1, "Page load p99", 4200, "ms", { baseline: 2100, trend: { direction: "up", magnitude: "+100%", good_or_bad: "bad" }, status: "unhealthy", sparkline: [2100, 2200, 2400, 3100, 3800, 4100, 4200] }),
      stat(2, "TTFB p99", 1820, "ms", { baseline: 320, status: "unhealthy" }),
      tab(3, "Where time is going (waterfall summary)", [
        { key: "phase", label: "Phase", kind: "text" },
        { key: "p99", label: "p99 (ms)", kind: "number", align: "right" },
        { key: "pct", label: "% of total", kind: "text" },
      ], [
        { phase: "API call /home", p99: 1820, pct: "43%" },
        { phase: "JS bundle eval", p99: 980, pct: "23%" },
        { phase: "Image (LCP)", p99: 720, pct: "17%" },
        { phase: "Other", p99: 680, pct: "17%" },
      ]),
      changes(4, "Recent releases", [
        { timestamp: "1d ago", title: "Frontend bundle rev-512 — added analytics SDK", kind: "deploy", principal: "deploy-bot" },
      ]),
    ],
  },
});

C.push({
  id: "mix-08",
  category: "mixed-complex",
  prompt: "Correlate the CloudTrail changes with the error spike",
  expected: { shell: "investigation", mustInclude: ["change_event_list"], mustIncludeAny: ["stat_card", "sparkline", "timeline"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "CloudTrail ↔ error spike correlation",
      severity: "warning",
      query_intent: "cloudtrail-error-correlation",
    },
    widgets: [
      stat(1, "Error rate now", 4.2, "%", { baseline: 0.3, status: "unhealthy" }),
      spark(2, "Error rate (3h)", [0.3, 0.3, 0.3, 0.4, 0.6, 1.2, 2.1, 3.1, 3.8, 4.2], { unit: "%", color: "red", current: 4.2 }),
      tl(3, "Error spike vs change events", [
        { timestamp: "13:50 UTC", title: "ECS UpdateService rev-204", severity: "info" },
        { timestamp: "13:55 UTC", title: "Feature flag new_checkout=true", severity: "info" },
        { timestamp: "13:58 UTC", title: "Error rate >1% (first elevation)", severity: "warning" },
        { timestamp: "14:08 UTC", title: "Error rate 4.2% — peak", severity: "critical" },
      ]),
      changes(4, "Write events in correlation window", [
        { timestamp: "13:50 UTC", title: "ECS UpdateService api rev-204", kind: "deploy", principal: "deploy-bot" },
        { timestamp: "13:55 UTC", title: "Feature flag toggled", kind: "config", principal: "platform-admin" },
      ]),
    ],
  },
});

C.push({
  id: "mix-09",
  category: "mixed-complex",
  prompt: "Give me the big picture on production health",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [4, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Production — big picture",
      severity: "info",
      query_intent: "service-overview",
    },
    widgets: [
      stat(1, "Healthy", 9, "of 12", { status: "healthy" }),
      stat(2, "Degraded", 2, "of 12", { status: "degraded" }),
      stat(3, "Unhealthy", 1, "of 12", { status: "unhealthy" }),
      stat(4, "SLOs in breach", 4, "of 22", { status: "warning" }),
      stat(5, "Total RPS", 4820, "", { status: "neutral" }),
      stat(6, "Active alarms", 3, "", { status: "warning" }),
    ],
  },
});

C.push({
  id: "mix-10",
  category: "mixed-complex",
  prompt: "Triage: multiple alarms firing simultaneously",
  expected: { shell: ["investigation", "dashboard"], mustInclude: ["table"], forbidden: ["trace_waterfall"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Multi-alarm triage",
      severity: "critical",
      query_intent: "multi-alarm-triage",
    },
    widgets: [
      stat(1, "Active alarms", 7, "", { status: "unhealthy" }),
      stat(2, "First fired", "13:58 UTC", "", { status: "warning" }),
      tab(3, "Active alarms (sorted by first-fired)", [
        { key: "alarm", label: "Alarm", kind: "text" },
        { key: "fired", label: "Fired at", kind: "text" },
        { key: "svc", label: "Service", kind: "code" },
        COL_HEALTH,
      ], [
        { alarm: "api-error-rate-fast-burn", fired: "13:58 UTC", svc: "api", health: "unhealthy" },
        { alarm: "checkout-p99-3sigma",       fired: "14:01 UTC", svc: "checkout-api", health: "unhealthy" },
        { alarm: "rds-cpu-90",                fired: "14:03 UTC", svc: "aurora-prod", health: "warning" },
        { alarm: "ecs-task-restarts",         fired: "14:05 UTC", svc: "recommendations-svc", health: "warning" },
      ]),
      changes(4, "Likely common trigger", [
        { timestamp: "13:50 UTC", title: "RDS ModifyDBInstance — failover", kind: "infra", principal: "rds.amazonaws.com" },
      ]),
    ],
  },
});

C.push({
  id: "mix-11",
  category: "mixed-complex",
  prompt: "Post-incident review: summarize what happened",
  expected: { shell: "investigation", mustInclude: ["timeline"], mustIncludeAny: ["stat_card", "sparkline", "change_event_list"], widgetCount: [2, 8] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Post-incident review — INC-2026-04-27-001",
      severity: "warning",
      query_intent: "post-incident-summary",
    },
    widgets: [
      stat(1, "Duration", 34, "min", { status: "unhealthy" }),
      stat(2, "Peak error rate", 28.4, "%", { status: "unhealthy" }),
      stat(3, "Customers impacted (est.)", 14200, "", { status: "unhealthy" }),
      tl(4, "Incident timeline", [
        { timestamp: "03:14 UTC", title: "RDS aurora-prod failover started", severity: "warning" },
        { timestamp: "03:17 UTC", title: "Error rate crossed 5%", severity: "critical" },
        { timestamp: "03:22 UTC", title: "On-call paged", severity: "critical" },
        { timestamp: "03:38 UTC", title: "Reader promoted, app reconnected", severity: "info" },
        { timestamp: "03:48 UTC", title: "Recovery — error rate < 0.5%", severity: "success" },
      ]),
      changes(5, "Trigger / contributing factors", [
        { timestamp: "03:14 UTC", title: "RDS automatic failover", kind: "infra", principal: "rds.amazonaws.com" },
      ]),
    ],
  },
});

C.push({
  id: "mix-12",
  category: "mixed-complex",
  prompt: "Proactive check: anything concerning in the metrics?",
  expected: { shell: "dashboard", mustInclude: ["stat_card"], forbidden: ["trace_waterfall", "log_viewer"], widgetCount: [3, 10] },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Proactive metrics scan",
      severity: "info",
      query_intent: "proactive-anomaly-scan",
    },
    widgets: [
      stat(1, "Anomalies detected", 3, "", { status: "warning" }),
      stat(2, "Healthy services", 9, "of 12", { status: "healthy" }),
      stat(3, "Worst trending", "checkout-api p99", "", { status: "warning" }),
      stat(4, "Burn rate (max)", 1.4, "× target", { status: "neutral" }),
      changes(5, "Top concerning trends", [
        { timestamp: "now", title: "checkout-api p99 trending up (+38% in 6h)", kind: "other" },
        { timestamp: "now", title: "DynamoDB carts table consumed RCU climbing", kind: "other" },
        { timestamp: "now", title: "ECS recommendations-svc memory utilization rising", kind: "other" },
      ]),
    ],
  },
});

// ---------- Category 6: HTML quality / a11y / safety regression ----------
//
// These cases are constructed specifically to exercise rendering paths that
// the original 52 prompts didn't pin down: status-cell mapping for every
// known severity, sortable-header accessibility, link safety, trace-bar
// containment when start_ms is at the edge of total_duration_ms, and
// HTML-escaping of attacker-shaped strings. They share the existing six
// score dimensions plus html_quality.

C.push({
  id: "qa-01",
  category: "quality-regression",
  prompt: "[regression] Mixed status cells incl. degraded must color-code correctly",
  expected: {
    shell: ["investigation", "single-focus"],
    mustInclude: ["table"],
    widgetCount: [2, 6],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Service health — mixed statuses",
      severity: "warning",
      query_intent: "service-overview",
      service: "platform",
      region: "us-east-1",
    },
    widgets: [
      stat(1, "Services tracked", 5, "", { status: "neutral" }),
      tab(2, "Service health", [
        { key: "svc", label: "Service", kind: "code" },
        COL_HEALTH,
      ], [
        { svc: "api",             health: "healthy" },
        { svc: "checkout-api",    health: "degraded" },   // bug case: must map to warn, not neutral
        { svc: "payment-service", health: "warning" },
        { svc: "order-service",   health: "unhealthy" },
        { svc: "search-svc",      health: "ok" },
      ]),
    ],
  },
});

C.push({
  id: "qa-02",
  category: "quality-regression",
  prompt: "[regression] Sortable table must announce sort state and be keyboard-focusable",
  expected: {
    shell: ["investigation", "single-focus"],
    mustInclude: ["table"],
    widgetCount: [2, 6],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Top operations by error rate",
      severity: "warning",
      query_intent: "operations-leaderboard",
      service: "api",
    },
    widgets: [
      stat(1, "Total errors / min", 412, "", { status: "unhealthy" }),
      tab(2, "Operations (sortable)", [
        COL_OP, COL_ERR, COL_P99, COL_HEALTH,
      ], [
        { op: "POST /orders",  errors: 162, p99: 940, health: "unhealthy" },
        { op: "GET /users/:id", errors: 98, p99: 410, health: "warning"   },
        { op: "POST /login",    errors: 52, p99: 290, health: "warning"   },
      ], { searchable: true, sortable: true }),
    ],
  },
});

C.push({
  id: "qa-03",
  category: "quality-regression",
  prompt: "[regression] Trace span at the edge of total duration must not overflow the track",
  expected: {
    shell: "single-focus",
    mustInclude: ["trace_waterfall"],
    widgetCount: [2, 4],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Edge-case trace — late span",
      severity: "info",
      query_intent: "latency-investigation",
      service: "api",
    },
    widgets: [
      stat(1, "Total duration", 100, "ms", { status: "neutral" }),
      trace(2, "trace-edge-001", 100, [
        { name: "GET /api/edge",        service: "api",          start_ms: 0,   duration_ms: 100, depth: 0, status: "ok" },
        // Span anchored at the very end of the window — naive math puts the
        // bar past 100% if widthPct is min-clamped without re-bounding
        // against the right edge of the track.
        { name: "afterthought metric",  service: "metrics-svc",  start_ms: 100, duration_ms: 0,   depth: 1, status: "ok" },
        // Span that runs past the reported total_duration_ms (clock skew
        // between services can produce this in real traces).
        { name: "downstream straggler", service: "billing",      start_ms: 80,  duration_ms: 80,  depth: 1, status: "error" },
      ]),
    ],
  },
});

C.push({
  id: "qa-04",
  category: "quality-regression",
  prompt: "[regression] HTML-shaped strings in titles and log lines must be escaped",
  expected: {
    shell: ["investigation", "single-focus"],
    mustInclude: ["log_viewer"],
    mustIncludeAny: ["stat_card", "sparkline"],
    widgetCount: [2, 6],
  },
  manifest: {
    version: "1.0",
    metadata: {
      // The skill never produces HTML in these fields, but log lines and
      // exception messages routinely contain "<" / ">" / quotes coming from
      // user input or stack traces. The renderer must escape, not interpret.
      title: "XSS regression — <script>alert('x')</script>",
      subtitle: "user input <img src=x onerror=alert(1)> in title path",
      severity: "warning",
      query_intent: "xss-regression",
      service: "search-svc",
    },
    widgets: [
      stat(1, "Suspicious <events>", 3, "</span>", { status: "warning" }),
      logs(2, "<b>Recent</b> errors", "/aws/ecs/<svc>", [
        { timestamp: "12:00:01", severity: "error", message: "java.lang.RuntimeException: bad input <script>alert(1)</script>" },
        { timestamp: "12:00:02", severity: "warn",  message: "javascript:alert('still escaped') in user-supplied URL" },
        { timestamp: "12:00:03", severity: "error", message: "exception thrown: <img src=x onerror=alert(2)>" },
      ]),
    ],
  },
});

C.push({
  id: "qa-05",
  category: "quality-regression",
  prompt: "[regression] All target=_blank links must carry rel=noreferrer noopener",
  expected: {
    shell: "investigation",
    mustIncludeAny: ["timeline", "change_event_list", "table"],
    widgetCount: [2, 6],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Link safety — every link surface",
      severity: "info",
      query_intent: "link-safety-regression",
      service: "platform",
    },
    widgets: [
      tl(1, "Timeline with links", [
        { timestamp: "12:00 UTC", title: "Deploy started",  severity: "info",    link: "https://console.aws.amazon.com/ecs/home" },
        { timestamp: "12:05 UTC", title: "Alarm fired",     severity: "warning", link: "https://console.aws.amazon.com/cloudwatch/home" },
      ]),
      tab(2, "Operations with deep-link column", [
        { key: "op",   label: "Operation", kind: "code" },
        { key: "logs", label: "Logs",      kind: "link" },
      ], [
        { op: "POST /orders", logs: { href: "https://console.aws.amazon.com/cloudwatch/home?logs=orders", label: "open" } },
        { op: "GET /users",   logs: "https://console.aws.amazon.com/cloudwatch/home?logs=users" },
      ]),
      changes(3, "Recent changes with CloudTrail links", [
        { timestamp: "11:55 UTC", title: "ECS UpdateService", kind: "deploy", link: "https://console.aws.amazon.com/cloudtrail/home?event=evt-001" },
      ]),
    ],
  },
});

C.push({
  id: "qa-06",
  category: "quality-regression",
  prompt: "[regression] Artifact root must expose an accessible name for landmark navigation",
  expected: {
    shell: ["investigation", "single-focus", "dashboard"],
    mustIncludeAny: ["stat_card", "sparkline", "table"],
    widgetCount: [1, 4],
  },
  manifest: {
    version: "1.0",
    metadata: {
      title: "Accessible-name regression",
      severity: "info",
      query_intent: "a11y-landmark-regression",
    },
    widgets: [
      stat(1, "Lonely metric", 42, "ok"),
    ],
  },
});

// Sanity check
const EXPECTED_CASES = 58;
if (C.length !== EXPECTED_CASES) {
  throw new Error(`Expected ${EXPECTED_CASES} cases, got ${C.length}`);
}

export const CASES = C;
