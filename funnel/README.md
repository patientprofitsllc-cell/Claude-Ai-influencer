# Patient Creations funnel

A working website and lead intake server based on the supplied funnel package. Leads are saved to SQLite immediately. External automation is optional and off until configured.

## Run

Requires Node.js 24 or later. There are no external packages or build step.

```sh
cd /workspace/Claude-Ai-influencer/funnel
npm start
```

The default server listens on port 3000. Open the local server in a browser when running on your own machine. `npm run dev` restarts on server edits. Copy `.env.example` to `.env` if you need configuration. Preserve existing configuration when updating.

## Included

- Two-step form with client and server validation, optional contact consent, retry-safe submission IDs and a honeypot.
- Revenue at least $5,000/month **and** budget “yes”: a walkthrough scheduling link.
- Lower revenue or budget “no”: immediate checklist and planner downloads.
- Persistent lead records, a private CSV export and a durable optional automation queue.
- Industry paths: `/grow-detailing`, `/grow-home-services`, `/grow-wellness`, `/grow-professional-services`, `/grow-other`.
- Local privacy notice and truthful confirmation states. A saved request is not a booked appointment.

The supplied calendar URL is `https://cal.com/patientcreations/15min`. It is configurable with `CALENDAR_URL`; calendar availability and ownership have not been independently verified. No appointment is created by this application.

## Review saved leads

```sh
npm run leads:export
```

The export command prints the filename, not lead details. CSVs go to ignored `exports/`. Database files are in ignored `data/`, or `DATA_DIR`. Back up the database on your host. Treat exports as private customer data. There is no unauthenticated public lead-list endpoint.

## Connect follow-up later

Leave both webhook variables empty to save leads without sending them anywhere. To activate delivery, set `AUTOMATION_WEBHOOK_URL` to your HTTPS receiver and `AUTOMATION_WEBHOOK_SECRET` to a random secret of at least 24 characters in your host’s secret settings. Do not commit secrets.

The receiver must verify the HMAC-SHA256 signature of the exact request body from `X-Webhook-Signature` and deduplicate events using `event_id` / `Idempotency-Key`. Successful 2xx responses mark an event delivered. Failed requests retry with backoff, up to eight attempts. The queue is checked every 30 seconds, including records saved before integration was configured. Review those older records and contact preferences before enabling delivery; setting variables activates delivery of pending records.

Routing actions:

| Action | When | Receiver behavior |
| --- | --- | --- |
| `execute_outbound_prescreen` | Qualified and phone consent checked | Use an authorized call/SMS integration and honor opt-outs. |
| `manual_review` | Qualified without phone consent | Review the inquiry; do not initiate automated calls/texts. |
| `send_resource_email_sequence` | Resources route and email consent checked | Send the approved sequence with an unsubscribe mechanism. |
| `resources_only` | Resources route without email consent | Store for request handling; do not enroll in marketing. |

Payloads include request ID, timestamp, prospect fields, consent version/text and routing instructions. The AVA prompt in `ava-prompt.md` is a template for the eventual receiver, not a running AI agent. Configure suppression/unsubscribe handling in the connected provider. A target within 120 seconds depends on that provider and is not guaranteed by this queue.

## Deploy

This needs a Node server and persistent disk. GitHub Pages alone cannot run the intake API. A Dockerfile is provided:

```sh
docker build -t patient-creations-funnel .
docker run --name patient-funnel -p 3000:3000 -v patient-funnel-data:/app/data patient-creations-funnel
```

Serve it behind HTTPS. Configure the actual contact/privacy details and calendar before customer launch. If a trusted reverse proxy overwrites `X-Forwarded-For`, set `TRUST_PROXY=1`; otherwise leave it off. Rate limiting is per-process; use one instance with this SQLite deployment. For horizontal scaling, use shared database/queue/rate-limit infrastructure. GitHub upload does not deploy a public site or configure the domain.

## Validation

`npm test` exercises real HTTP submissions, qualification, consent routing, idempotency, validation, signed webhook delivery/retries and private-file protection. Browser checks cover both form paths and mobile layout.
