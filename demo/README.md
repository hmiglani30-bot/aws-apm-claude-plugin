# AWS APM Claude Plugin — Demo Environment

A zero-cost demo stack that exercises every capability of the AWS APM Claude plugin. Deploys a sample "Pet Clinic API" with Lambda, API Gateway, App Signals (ADOT), CloudWatch Alarms, a dashboard, and an SNS topic.

## Prerequisites

- **AWS CLI v2** configured with credentials (`aws sts get-caller-identity` should work)
- **AWS Free Tier account** (or willingness to accept minimal charges beyond free tier)
- **curl** (for the load generator)
- **Region**: defaults to your CLI's configured region. App Signals must be available in your region.

## Deploy (one command)

```bash
aws cloudformation deploy \
  --template-file demo-stack.yaml \
  --stack-name apm-demo \
  --capabilities CAPABILITY_IAM
```

Optional: subscribe an email for alarm notifications:

```bash
aws cloudformation deploy \
  --template-file demo-stack.yaml \
  --stack-name apm-demo \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides AlertEmail=you@example.com
```

Deployment takes about 2-3 minutes.

## Get the API URL

```bash
aws cloudformation describe-stacks \
  --stack-name apm-demo \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

## Generate Load

The load generator sends mixed GET/POST requests for 10 minutes (default):

```bash
chmod +x generate-load.sh

# Default: 10 minutes, 0.3s between requests
./generate-load.sh https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com

# Custom: 20 minutes, 0.5s delay
./generate-load.sh https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com 20 0.5
```

The script prints progress every 30 seconds. You should see ~10% error rate (by design) and variable latency.

## Verify Data Is Flowing

After running the load generator for 2-3 minutes, check these console pages:

1. **CloudWatch Dashboard** — open the URL from stack outputs; you should see invocation, error, and duration graphs populating
2. **X-Ray Traces** — navigate to CloudWatch > X-Ray Traces > Traces; filter by service `pet-clinic-api`
3. **CloudWatch Logs** — check log group `/aws/lambda/pet-clinic-api` for structured JSON entries
4. **App Signals** — navigate to CloudWatch > Application Signals > Services; `pet-clinic-api` should appear after 5-10 minutes
5. **Alarms** — check CloudWatch > Alarms; the error-rate alarm may fire due to the intentional ~10% error rate

Get all console links at once:

```bash
aws cloudformation describe-stacks \
  --stack-name apm-demo \
  --query 'Stacks[0].Outputs' \
  --output table
```

## Plugin Commands to Try (in order)

Once data is flowing (wait at least 5 minutes after starting load), try these plugin commands:

### 1. Basic investigation
```
investigate service pet-clinic-api
```
The plugin pulls metrics, recent errors, and traces to build a health summary.

### 2. Alarm investigation
```
investigate alarm pet-clinic-api-error-rate
```
If the error-rate alarm is firing, the plugin walks through the full alarm investigation workflow.

### 3. Log analysis
```
analyze logs for pet-clinic-api in the last 30 minutes
```
The plugin runs Logs Insights queries against the structured JSON logs.

### 4. Trace analysis
```
show recent traces for pet-clinic-api
```
Pulls X-Ray traces and identifies slow or errored spans.

### 5. Dashboard review
```
describe dashboard pet-clinic-dashboard
```
The plugin reads dashboard widgets and summarizes what each one shows.

### 6. Service map
```
show service map for pet-clinic-api
```
If App Signals is active, shows dependencies and traffic flow.

### 7. SLO creation (if App Signals is active)
```
help me create an SLO for pet-clinic-api
```
Walks through SLO creation with the plugin's guided workflow.

## Tear Down

Remove everything with one command:

```bash
aws cloudformation delete-stack --stack-name apm-demo
```

Verify deletion is complete:

```bash
aws cloudformation wait stack-delete-complete --stack-name apm-demo
echo "Stack deleted successfully"
```

## Cost Warning

Everything in this stack is designed to stay within AWS Free Tier limits:

| Resource | Free Tier Allowance | Demo Usage |
|----------|-------------------|------------|
| Lambda | 1M requests/month, 400K GB-seconds | ~2,000 requests per 10-min run |
| API Gateway (HTTP) | 1M requests/month | Same as Lambda |
| CloudWatch Metrics | 10 custom metrics | Uses only AWS/Lambda namespace (free) |
| CloudWatch Logs | 5 GB ingestion/month | ~1 MB per 10-min run |
| CloudWatch Alarms | 10 alarms free | 3 alarms |
| X-Ray | 100K traces/month | ~2,000 traces per run |
| SNS | 1M publishes free | Only on alarm state changes |
| CloudWatch Dashboard | 3 dashboards free | 1 dashboard |

**If you run the load generator continuously or leave the stack deployed for months**, you will stay within free tier. However, be aware:

- Free tier has a 12-month expiration for new accounts (except the always-free tier items)
- If you have other workloads in the account, combined usage could exceed free tier
- App Signals may have separate pricing beyond free tier — check current pricing
- **Always delete the stack when done** to avoid any unexpected charges

## Architecture

```
                    +-----------------+
                    |   API Gateway   |
  curl requests --> |   (HTTP API)    |
                    +--------+--------+
                             |
                    +--------v--------+
                    |     Lambda      |
                    | pet-clinic-api  |
                    | (Python 3.12)  |
                    | + ADOT Layer    |
                    +---+----+----+---+
                        |    |    |
              +---------+    |    +---------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | CloudWatch |  |   X-Ray     |  | App Signals |
     |   Logs     |  |   Traces    |  |  (via ADOT) |
     +-----+------+  +------+------+  +------+------+
           |                |                |
     +-----v------+  +-----v-------+  +-----v------+
     | Log Insights|  | Trace       |  | Service    |
     | Queries     |  | Analysis    |  | Map + SLOs |
     +-------------+  +-------------+  +------------+

     +------------------+     +------------------+
     | CloudWatch       |     | SNS Topic        |
     | Alarms (3)       +---->| apm-demo-alerts  |
     +------------------+     +------------------+

     +------------------+
     | CloudWatch       |
     | Dashboard        |
     +------------------+
```
