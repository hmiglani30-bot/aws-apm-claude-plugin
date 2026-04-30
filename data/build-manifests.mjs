#!/usr/bin/env node
// Build 5 widget manifests from the live AWS JSON files in data/.
// Each manifest is constructed from the data — no hardcoded values for
// metrics, alarm names, log groups, dashboard widgets, or CloudTrail events.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = __dirname;
const manifestsDir = join(__dirname, "manifests");

const read = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
const write = (name, m) => writeFileSync(join(manifestsDir, name), JSON.stringify(m, null, 2));

// ---------- 1. health.json -> service-health manifest ----------
{
  const h = read("health.json");
  const s = h.summary;
  const dp = (k) => h.metrics[k].Datapoints[0];
  const errPct = s.error_rate_pct;
  const thPct = s.throttle_rate_pct;
  const inv = dp("Invocations").Sum;
  const errs = dp("Errors").Sum;
  const thr = dp("Throttles").Sum;

  const widgets = [
    {
      type: "stat_card", priority: 1,
      data: {
        label: "Error rate",
        value: errPct, unit: "%",
        baseline: 0, baseline_label: "expected",
        status: errPct > 10 ? "unhealthy" : (errPct > 1 ? "degraded" : "healthy"),
        trend: { direction: "up", magnitude: `${errs}/${inv} req`, good_or_bad: "bad" },
      },
    },
    {
      type: "stat_card", priority: 2,
      data: {
        label: "Throttle rate", value: thPct, unit: "%",
        baseline: 0, baseline_label: "expected",
        status: thPct > 5 ? "warning" : "neutral",
        trend: { direction: "up", magnitude: `${thr}/${inv} req`, good_or_bad: "bad" },
      },
    },
    {
      type: "stat_card", priority: 3,
      data: {
        label: "Max duration", value: s.max_duration_ms, unit: "ms",
        baseline: 1000, baseline_label: "p99 alarm",
        status: s.max_duration_ms > 1000 ? "warning" : "healthy",
      },
    },
    {
      type: "stat_card", priority: 4,
      data: {
        label: "Avg duration", value: Math.round(s.avg_duration_ms * 100) / 100, unit: "ms",
        status: "neutral",
      },
    },
    {
      type: "stat_card", priority: 5,
      data: {
        label: "Invocations (24h)", value: inv, unit: "calls",
        status: "neutral",
      },
    },
    {
      type: "table", priority: 6,
      data: {
        label: "Per-metric raw datapoints",
        columns: [
          { key: "metric", label: "Metric", kind: "text" },
          { key: "sum", label: "Sum", kind: "number", align: "right" },
          { key: "avg", label: "Average", kind: "number", align: "right" },
          { key: "max", label: "Max", kind: "number", align: "right" },
          { key: "unit", label: "Unit", kind: "text" },
        ],
        rows: Object.entries(h.metrics).map(([m, v]) => {
          const d = v.Datapoints[0];
          return {
            metric: m,
            sum: d.Sum,
            avg: Math.round(d.Average * 1000) / 1000,
            max: d.Maximum,
            unit: d.Unit,
          };
        }),
        searchable: false, sortable: true,
      },
    },
  ];

  write("health.manifest.json", {
    version: "1.0",
    metadata: {
      title: `Service health — ${h._meta.function_name}`,
      subtitle: `${errs}/${inv} requests errored (${errPct.toFixed(1)}%) in last 24h`,
      severity: errPct > 50 ? "critical" : (errPct > 10 ? "warning" : "info"),
      query_intent: "service-health",
      service: h._meta.function_name,
      region: h._meta.region,
      generated_at: h._meta.pulled_at,
    },
    widgets,
  });
}

// ---------- 2. alarms.json -> alarm-inventory manifest ----------
{
  const a = read("alarms.json");
  const alarms = a.alarms;

  const stateCount = (st) => alarms.filter((x) => x.StateValue === st).length;
  const widgets = [
    {
      type: "stat_card", priority: 1,
      data: {
        label: "Total alarms", value: alarms.length, unit: "alarms",
        status: stateCount("ALARM") > 0 ? "unhealthy" : "healthy",
      },
    },
    {
      type: "stat_card", priority: 2,
      data: {
        label: "In ALARM", value: stateCount("ALARM"),
        status: stateCount("ALARM") > 0 ? "unhealthy" : "healthy",
      },
    },
    {
      type: "stat_card", priority: 3,
      data: {
        label: "OK", value: stateCount("OK"), status: "healthy",
      },
    },
    {
      type: "table", priority: 4,
      data: {
        label: `CloudWatch alarms matching '${a._meta.filter}'`,
        columns: [
          { key: "name", label: "Alarm", kind: "code" },
          { key: "state", label: "State", kind: "status" },
          { key: "metric", label: "Metric", kind: "text" },
          { key: "stat", label: "Stat", kind: "text" },
          { key: "op", label: "Op", kind: "text" },
          { key: "thr", label: "Threshold", kind: "number", align: "right" },
          { key: "period", label: "Period (s)", kind: "number", align: "right" },
        ],
        rows: alarms.map((al) => ({
          name: al.AlarmName,
          state: al.StateValue === "OK" ? "ok" : (al.StateValue === "ALARM" ? "error" : "warning"),
          metric: `${al.Namespace}/${al.MetricName}`,
          stat: al.Statistic || al.ExtendedStatistic || "?",
          op: al.ComparisonOperator,
          thr: al.Threshold,
          period: al.Period,
        })),
        searchable: true, sortable: true,
      },
    },
    {
      type: "timeline", priority: 5,
      data: {
        label: "Last state transitions",
        events: alarms.map((al) => ({
          timestamp: al.StateTransitionedTimestamp,
          title: `${al.AlarmName} → ${al.StateValue}`,
          severity: al.StateValue === "OK" ? "success" : (al.StateValue === "ALARM" ? "critical" : "warning"),
          description: al.StateReason.slice(0, 200),
        })),
      },
    },
  ];

  write("alarms.manifest.json", {
    version: "1.0",
    metadata: {
      title: `Alarms — ${a._meta.region}`,
      subtitle: `${alarms.length} matched · ${stateCount("ALARM")} firing`,
      severity: stateCount("ALARM") > 0 ? "critical" : "info",
      query_intent: "alarm-inventory",
      region: a._meta.region,
      generated_at: a._meta.pulled_at,
    },
    widgets,
  });
}

// ---------- 3. dashboard.json -> dashboard-summary manifest ----------
{
  const d = read("dashboard.json");
  const dashWidgets = d.DashboardBody.widgets;
  const metricWidgets = dashWidgets.filter((w) => w.type === "metric");

  // One stat_card per metric widget (as a placeholder showing what the dash exposes).
  const cards = metricWidgets.map((mw, i) => {
    const ms = mw.properties.metrics;
    const first = Array.isArray(ms[0]) ? ms[0] : null;
    const ns = first && typeof first[0] === "string" ? first[0] : "expression";
    const metric = first && typeof first[1] === "string" ? first[1] : "computed";
    return {
      type: "stat_card", priority: i + 2,
      data: {
        label: mw.properties.title,
        value: `${ns}/${metric}`,
        unit: `${mw.width}×${mw.height}`,
        baseline_label: `period=${mw.properties.period}s`,
        status: "neutral",
      },
    };
  });

  const widgets = [
    {
      type: "stat_card", priority: 1,
      data: {
        label: "Dashboard size",
        value: d.DashboardSize, unit: "bytes",
        baseline_label: d.DashboardName,
        status: "neutral",
      },
    },
    ...cards,
    {
      type: "table", priority: 100,
      data: {
        label: "Dashboard widgets layout",
        columns: [
          { key: "type", label: "Type", kind: "code" },
          { key: "title", label: "Title", kind: "text" },
          { key: "x", label: "x", kind: "number", align: "right" },
          { key: "y", label: "y", kind: "number", align: "right" },
          { key: "w", label: "w", kind: "number", align: "right" },
          { key: "h", label: "h", kind: "number", align: "right" },
        ],
        rows: dashWidgets.map((w) => ({
          type: w.type,
          title: w.properties.title || (w.properties.markdown ? w.properties.markdown.split("\n")[0] : ""),
          x: w.x, y: w.y, w: w.width, h: w.height,
        })),
        searchable: true, sortable: true,
      },
    },
  ];

  write("dashboard.manifest.json", {
    version: "1.0",
    metadata: {
      title: `Dashboard: ${d.DashboardName}`,
      subtitle: `${dashWidgets.length} widgets (${metricWidgets.length} metric, ${dashWidgets.length - metricWidgets.length} text)`,
      severity: "info",
      query_intent: "dashboard-summary",
      region: d._meta.region,
      generated_at: d._meta.pulled_at,
    },
    widgets,
  });
}

// ---------- 4. logs.json -> log-query-result manifest ----------
{
  const l = read("logs.json");
  const stats = l.statistics;
  const widgets = [
    {
      type: "stat_card", priority: 1,
      data: {
        label: "Records matched", value: stats.recordsMatched,
        baseline: stats.recordsScanned, baseline_label: "scanned",
        status: stats.recordsMatched === 0 ? "warning" : "neutral",
      },
    },
    {
      type: "stat_card", priority: 2,
      data: {
        label: "Records scanned", value: stats.recordsScanned, unit: "records",
        status: "neutral",
      },
    },
    {
      type: "stat_card", priority: 3,
      data: {
        label: "Bytes scanned", value: stats.bytesScanned, unit: "B",
        status: "neutral",
      },
    },
    {
      type: "log_viewer", priority: 4,
      data: {
        label: "Matching log lines",
        log_group: l._meta.log_group,
        lines: l.results.map((r) => ({
          timestamp: r["@timestamp"] || "",
          message: r["@message"] || JSON.stringify(r),
          severity: "error",
        })),
      },
    },
    {
      type: "timeline", priority: 5,
      data: {
        label: "Query metadata",
        events: [
          { timestamp: l._meta.window_start, title: "Window start", severity: "info" },
          { timestamp: l._meta.window_end, title: "Window end", severity: "info" },
          { timestamp: l._meta.pulled_at, title: `Status: ${l.status} · matched=${stats.recordsMatched}`, severity: stats.recordsMatched > 0 ? "warning" : "success" },
        ],
      },
    },
  ];

  write("logs.manifest.json", {
    version: "1.0",
    metadata: {
      title: `Log Insights query — ${l._meta.log_group}`,
      subtitle: l.interpretation.slice(0, 280),
      severity: stats.recordsMatched > 0 ? "warning" : "info",
      query_intent: "log-query-result",
      region: l._meta.region,
      generated_at: l._meta.pulled_at,
    },
    widgets,
  });
}

// ---------- 5. trail.json -> cloudtrail-view manifest ----------
{
  const t = read("trail.json");
  const events = t.events;
  const counts = t._meta.event_counts_by_name;

  const classify = (name) => {
    if (/^(CreateFunction|UpdateFunctionCode|CreateDeployment|UpdateService|UpdateStack)/.test(name)) return "deploy";
    if (/^(Put|Update|Modify)/.test(name) && !/Permission/.test(name)) return "config";
    if (/AssumeRole|CreateAccessKey|AttachRolePolicy|^Add.*Permission/.test(name)) return "iam";
    if (/^(Create|Delete|Reboot)/.test(name)) return "infra";
    return "other";
  };

  const sorted = [...events].sort((a, b) => new Date(a.EventTime) - new Date(b.EventTime));
  const writeEvents = sorted.filter((e) => e.EventName !== "AssumeRole");

  const widgets = [
    {
      type: "stat_card", priority: 1,
      data: {
        label: "Events (24h)", value: events.length,
        baseline_label: `resource=${t._meta.attribute_value}`,
        status: "neutral",
      },
    },
    ...Object.entries(counts).map(([name, n], i) => ({
      type: "stat_card", priority: 2 + i,
      data: {
        label: name, value: n, unit: "events",
        status: classify(name) === "iam" ? "warning" : "neutral",
      },
    })),
    {
      type: "change_event_list", priority: 10,
      data: {
        label: "Write/config events (chronological)",
        events: writeEvents.map((e) => ({
          timestamp: e.EventTime,
          title: e.EventName,
          principal: e.CloudTrailEvent?.userIdentity?.arn
            || e.CloudTrailEvent?.userIdentity?.invokedBy
            || e.CloudTrailEvent?.userIdentity?.type
            || "unknown",
          resource: (e.Resources && e.Resources[0] && e.Resources[0].ResourceName) || "",
          kind: classify(e.EventName),
        })),
      },
    },
    {
      type: "table", priority: 11,
      data: {
        label: `All ${events.length} events`,
        columns: [
          { key: "time", label: "Time", kind: "text" },
          { key: "name", label: "Event", kind: "code" },
          { key: "src", label: "Source", kind: "text" },
          { key: "kind", label: "Kind", kind: "text" },
          { key: "ro", label: "ReadOnly", kind: "text" },
        ],
        rows: events.map((e) => ({
          time: e.EventTime,
          name: e.EventName,
          src: e.EventSource,
          kind: classify(e.EventName),
          ro: String(e.ReadOnly),
        })),
        searchable: true, sortable: true,
      },
    },
    {
      type: "timeline", priority: 12,
      data: {
        label: "First and last events",
        events: [
          { timestamp: sorted[0].EventTime, title: `First: ${sorted[0].EventName}`, severity: "info" },
          { timestamp: sorted[sorted.length - 1].EventTime, title: `Last: ${sorted[sorted.length - 1].EventName}`, severity: "info" },
        ],
      },
    },
  ];

  write("trail.manifest.json", {
    version: "1.0",
    metadata: {
      title: `CloudTrail — ${t._meta.attribute_value}`,
      subtitle: `${events.length} events (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")})`,
      severity: "info",
      query_intent: "cloudtrail-view",
      region: t._meta.region,
      generated_at: t._meta.pulled_at,
    },
    widgets,
  });
}

console.log("Manifests written.");
