# Text Presentation Guide

The detailed playbook behind the text presentation rules in `SKILL.md`. Read this when:

- You're about to write more than two sentences alongside a widget.
- You're writing a text-only investigation response longer than 100 words.
- Something in the SKILL.md summary felt under-specified and you want the why.

## The 3am test

Every response in this plugin is read by someone who was just paged. Assume:

- They have not seen the prior conversation. They opened the panel, the artifact is already there.
- They are skimming, not reading. They look at: title → first sentence → bolded number → next steps.
- They have ~10 seconds to decide whether to act, escalate, or dismiss.

If your response only makes sense after they read it twice, you have failed the 3am test. Cut, restructure, or replace prose with a widget.

## Lead with the answer

The first sentence is the most important. It is the only sentence you can assume gets read.

| Bad | Good |
|---|---|
| "I queried CloudWatch metrics for the last 30 minutes and looked at error rate, latency, and throughput…" | "**Checkout-api is in a critical error spike** — 5xx rate is at 4.2%, up from a 0.3% baseline." |
| "There are several possible causes for the latency regression on auth-svc…" | "**Auth-svc p99 jumped from 45ms to 410ms at 14:02 UTC**, coincident with deploy `rev-942`." |
| "Looking at the data, the SLO appears to be at risk." | "**Availability SLO on checkout-api will exhaust its error budget in ~6 hours** at the current burn rate." |

Methodology, when it matters at all, comes after the conclusion — and usually it doesn't matter. The user trusts the toolchain; they want to know what it found.

## Numbers, not adjectives

Vague language is a code smell — it means you skipped a tool call or you're hedging. Specific numbers from MCP data are non-negotiable.

| Vague | Specific |
|---|---|
| "Latency went up significantly." | "p99 latency rose from 180ms to 410ms (+128%) at 14:02 UTC." |
| "A lot of errors." | "142 errors/min on `POST /checkout`, sustained for the last 8 minutes." |
| "Recently." | "At 14:02 UTC (8 minutes ago)." |
| "Some throttling." | "12 ProvisionedThroughputExceededException entries on the `carts` table in the last 5 minutes." |
| "The deploy might be related." | "Deploy `rev-942` rolled out at 13:58 UTC, four minutes before the spike." |
| "p99 is high." | "p99 is **410ms** (baseline 180ms, threshold 300ms)." |

If the data isn't there to be specific, say so explicitly: "I don't have a 24h baseline for this operation — only the current value."

## Timestamps

| Acceptable | Not acceptable |
|---|---|
| `14:02 UTC` | `14:02` (no zone) |
| `2026-04-30 14:02 UTC` | `April 30 at 2pm` |
| `14:02 UTC (8 minutes ago)` | `recently` |
| `1714485720` (only inside a tool argument) | `1714485720` (in user-facing text) |

In an investigation that spans hours, anchor the first timestamp absolutely (`2026-04-30 14:02 UTC`) and use relative offsets for the rest (`+4 min`, `+8 min`). In a report spanning days, use dates (`Mon`, `Wed`) — but spell out which week if there's any ambiguity.

The user's local zone matters for non-incident reports (weekly SLO summaries, postmortems). For live-incident text, UTC always wins — pagers, logs, and CloudWatch all run UTC.

## Service and resource names

Use the user's naming convention. Pull from:

1. The `service-ownership` skill output for the canonical name.
2. The `metadata.service` field on the manifest you're producing.
3. The user's own message (if they wrote `checkout-api` don't switch to `Checkout API`).

Wrap service names, operation names, ARNs, log group names, and trace IDs in backticks. They are identifiers, not English words.

| Yes | No |
|---|---|
| `` `checkout-api` `` | `Checkout API`, `checkout_api`, `the checkout service` |
| `` `POST /checkout` `` | `the checkout endpoint`, `POST checkout` |
| `` `arn:aws:dynamodb:us-east-1:123456789012:table/carts` `` | `the carts table` (only after introducing the ARN once) |
| `` `1-66348f12-5a3b9c0e` `` | `the trace ID` |

For trace IDs, show enough to be unique on first reference (`1-66348f12-5a3b9c0e`), then truncate (`1-66348f12…`) if you reference it again.

## Units

Pick one unit per dimension and stick to it across the response:

- **Error rates**: percentages (`4.2%`), not counts unless the count is the actual ask. If both matter, lead with the rate and follow with the count: `4.2% (142 errors/min)`.
- **Latencies**: ms for values <1000, otherwise s. Don't write `1840ms` and `1.8s` in the same paragraph.
- **Throughput**: requests/min for HTTP, ops/sec for DB. Match what CloudWatch / Application Signals reports.
- **Counts**: absolute integers. `142 errors/min`, not `~140` or `several hundred`.
- **Money**: source currency with code, never a symbol alone. `USD 1240`, not `$1240`.
- **Percentages with trends**: report the trend alongside (`+1300% vs 24h baseline`), not just the new value.

## Acknowledge the widget when one is rendered

The widget is in the artifact, not in your training data — write text that knows it's there.

| Yes | No |
|---|---|
| "The trace waterfall above shows `db.cart.read` at 88% of total wall time." | "The slow span was `db.cart.read`." (which span? what trace? where would I see this?) |
| "In the failing-operations table, only `POST /checkout` is in `unhealthy`." | "Only `POST /checkout` is failing." (the user has to go find the table to verify) |
| "The error-rate sparkline shows the spike beginning at the 14:02 mark." | "The error rate spiked." |
| "Two events in the change list — a deploy at 13:50 and a config change at 09:14 — both predate the breach." | "There was a deploy and a config change." (which list? which times?) |

Phrases that work: "above", "below", "in the table", "in the trace waterfall", "in the timeline", "the highlighted row". Don't over-use them — once or twice per response is enough; the reader can see the widget.

## Scan-first formatting

Text-only investigation responses should be scannable in 5 seconds.

- **Bold the single number that drives the response.** One per response, not three.
- **Bullets for ≥3 findings.** Two findings can stay in a sentence.
- **Headers (`Key findings`, `Evidence`, `Next steps`) only when the response is ≥150 words.** A 60-word response with three section headers reads like a memo to nobody.
- **Code voice for identifiers.** Backticks around service names, operation names, ARNs, file paths, env var names.
- **No tables in text-only responses ≤200 words.** A 3-row markdown table is wasted screen for a list of three things.
- **No images, no ASCII charts, no Mermaid in text-only.** If the answer needs a picture, you should have rendered a widget.

## Tone

- Direct. Don't apologize, don't preface, don't editorialize. "I found X" not "I'd say X is the case."
- Confident when the evidence supports it; explicit about uncertainty when it doesn't. "p99 jumped at 14:02" if you measured it. "p99 *appears* to have jumped at 14:02" if you only have a 5-minute resolution and aren't sure.
- No empty politeness. Don't open with "Great question!" or close with "Let me know if you need anything else!".
- No emojis unless the user used them first. Status indicators in widgets are the renderer's job.

## Anti-patterns, with examples

### Restating the question

> ❌ You asked about the error rate on checkout-api. The error rate on checkout-api is currently 4.2%.
>
> ✅ Checkout-api error rate is **4.2%**, up from 0.3% baseline.

### Hedging without evidence

> ❌ The latency regression could be caused by the deploy, a database issue, a network problem, or possibly a memory leak.
>
> ✅ Latency regression on `auth-svc`. The deploy `rev-942` correlates in time but I haven't confirmed the diff. Database, network, and memory haven't been ruled out — the next read I'd run is `/cw-investigate-latency auth-svc 30m` to pull a sampled trace.

The first version is the agent shrugging in markdown. The second is a ranked hypothesis with a stated next action.

### Listing raw data without interpretation

> ❌ Error rate: 4.2%. p99: 410ms. p95: 290ms. p50: 80ms. Throughput: 1240 rpm. Errors/min: 142. Top operation: POST /checkout. Top error: 503.
>
> ✅ Checkout-api error spike: **4.2% error rate** (baseline 0.3%), driven entirely by `POST /checkout` returning 503s — 142 errors/min. p99 at 410ms, p50 unaffected — the slow tail is the failing requests.

The first dumps. The second interprets.

### Same finding in three different words

> ❌ Latency is high. The response time has increased significantly. p99 has spiked. The service is slow.
>
> ✅ p99 jumped from 180ms to 410ms (+128%) at 14:02 UTC.

### Methodology before conclusion

> ❌ I queried CloudWatch metrics for `AWS/ApplicationSignals` namespace, filtered by service=`checkout-api`, aggregated p99 over the last 30 minutes, then compared against the 24h prior window…
>
> ✅ p99 on `checkout-api` is **410ms**, up from a 24h baseline of 180ms.

If methodology matters (the data was missing, the window was non-standard, you sampled), put it in a parenthetical or a one-line note at the bottom — not at the top.

### Phantom widgets

> ❌ See the dependency graph below for the full picture.
>
> (no dependency graph was rendered)

Only reference what's actually in the manifest. If the renderer overflowed a widget into the drawer, flag it: "two more rows in the 'Show 3 more' drawer."

### Companion text that just narrates the picture

When a widget is shown:

> ❌ The table shows POST /checkout has 142 errors/min and p99 of 980ms, marked unhealthy. GET /cart has 6 errors/min and p99 of 220ms, marked warning.
>
> ✅ Only `POST /checkout` is in critical (142 errors/min, p99 980ms); the `GET /cart` row is showing the same throttling pattern downstream but well under thresholds.

The first version restates the table cell-by-cell. The second adds the *causal link* (downstream throttling) the table can't show.

## Coherence — concrete examples

### Same scope

Widget: a table with five services, all in `unhealthy`.

> ❌ "Two services are degraded: checkout-api and auth-svc."
> (Five rows in the table — the text contradicts the artifact.)
>
> ✅ "All five services are in `unhealthy` — the table sorts them by error budget remaining; `checkout-api` is the closest to exhaustion."

### Same numbers

Widget says `p99 = 410ms`.

> ❌ "p99 is around 400ms."
> ❌ "p99 is over 400ms."
> ✅ "p99 is **410ms**."

If you want a rounded number for readability, round in *both* places — text and widget label — or in neither.

### Same time window

Widget legend: "Last 1h".

> ❌ "Over the last 30 minutes, error rate has been climbing…"
> ✅ "Over the last hour, error rate has been climbing — the spike begins ~30 minutes in (visible in the sparkline)."

### Same severity

Manifest `metadata.severity = "critical"`.

> ❌ "Things are looking a bit elevated on checkout-api."
> ✅ "Checkout-api is in a critical state."

The shell will render with a red top-bar; your prose contradicting it is a coherence bug, not a stylistic choice.

## Length budget — practical heuristics

If you find yourself needing more words than the budget allows:

- **Widget+text > 150 words** → the widget isn't carrying its weight, OR you're hedging. Cut to 3 sentences. If you genuinely need more prose, drop the widget and write a text-only response instead.
- **Lookup > 100 words** → it's not a lookup, it's an investigation. Restructure to investigation form.
- **Investigation > 400 words** → you have either too many findings (cap at 4 bullets) or too much evidence (cite, don't quote). Move detail into a widget.

The budgets are derived from cognitive load at 3am, not arbitrary aesthetics. A response over budget is a response that won't be read all the way through.

## Special cases

### When the answer is "I don't know yet"

Be explicit. Don't pad with what you do know to fill space.

> ✅ "I can't say yet — the deploy correlation is suggestive but I haven't confirmed `rev-942`'s diff. Next read: pull the deploy diff or run `/cw-investigate-errors checkout-api 1h` for a wider window."

### When the answer is "everything's fine"

Still lead with it. Brief is good — silent is not.

> ✅ "Checkout-api is healthy. Error rate 0.28% (baseline 0.3%), p99 175ms (baseline 180ms), no alarms firing, no deploys in the last 4 hours."

### When the data quality is poor

Say so before the answer, not after.

> ✅ "Caveat: I only have 5-minute resolution on this metric — the spike timing is approximate to ±2.5 min. With that in mind: error rate stepped up around 14:00 UTC."

### When you're producing the artifact for a downstream skill

Skills like `incident-memory` and `copy-to-incident` consume your output verbatim. Apply the same rules — leading with the answer matters more, not less, when a downstream consumer is going to truncate.
