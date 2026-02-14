# PulseCall

A generalized platform for deploying proactive outbound AI voice agents. Operators configure a campaign — a target recipient list, a natural language conversation prompt, a call schedule, and escalation rules — and PulseCall handles the rest: placing calls, conducting adaptive conversations, processing transcripts, and routing alerts.

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

---

## Table of Contents

- [Motivation](#motivation)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Sponsor Integrations](#sponsor-integrations)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [API Reference](#api-reference)
- [Prompt Design](#prompt-design)
- [Team](#team)
- [License](#license)

---

## Motivation

Most AI voice agent deployments are reactive — they wait for a user to initiate contact. PulseCall inverts this: the agent initiates. This matters most in domains where the populations who need help most are also the least likely to reach out unprompted — recently discharged patients, isolated elderly individuals, students in early academic distress, newly arrived immigrants.

Existing solutions in this space (Hippocratic AI, Orbita, Artera) are either narrow in use case, locked behind enterprise contracts, or do not expose the underlying platform for custom deployment. PulseCall is the generalized infrastructure layer: give it a prompt, a list of people, and a schedule, and it handles proactive outreach at scale.

Key design decisions:

- **PSTN-first** — calls go to real phone numbers over the public telephone network, requiring nothing from the recipient beyond a phone
- **Prompt-driven** — the agent's persona, goals, and escalation logic are defined in plain English by the operator, with no code changes required
- **Event-driven post-processing** — every call completion fires a webhook that triggers a structured pipeline: transcription → summarization → sentiment scoring → flag detection → conditional escalation

---

## Architecture Overview

```
┌─────────────────────────────────┐
│         Operator Dashboard       │  Next.js + Tailwind
│   (Campaign Builder / Dashboard) │
└────────────────┬────────────────┘
                 │ REST API
┌────────────────▼────────────────┐
│         Backend API              │  Node.js + Hono
│   /campaigns  /calls  /webhooks  │
└──────┬──────────────────┬───────┘
       │                  │
┌──────▼──────┐    ┌──────▼──────┐
│   Mastra    │    │  PostgreSQL  │  Render
│  Workflows  │    │  (Prisma ORM)│
└──────┬──────┘    └─────────────┘
       │
┌──────▼──────────────────────────┐
│         Smallest.ai              │
│  Outbound call placement         │
│  Real-time STT/TTS               │
│  Call completion webhook         │
└──────┬──────────────────────────┘
       │ Webhook: transcript + metadata
┌──────▼──────────────────────────┐
│     Post-Call Processing         │  Anthropic Claude (Tool Use)
│  Summarization                   │
│  Sentiment scoring (1–5)         │
│  Keyword + semantic flag detect  │
│  Longitudinal trend analysis     │
└──────┬──────────────────────────┘
       │ If flagged
┌──────▼──────────────────────────┐
│     Escalation Pipeline          │
│  Priority classification (P1–P3) │
│  SMS to designated responder     │
│  Dashboard alert with context    │
└─────────────────────────────────┘
```

---

## Features

### Campaign Configuration

- **Recipient management** — single phone number input or CSV bulk upload (`name`, `phone`, `language`, `custom_vars`)
- **Prompt templating** — base system prompt with per-recipient variable injection via `{{variable}}` syntax (e.g., `{{name}}`, `{{procedure}}`, `{{days_since_discharge}}`)
- **Schedule configuration** — call interval (daily / weekly / custom), time window constraints, timezone per recipient
- **Escalation rule definition** — keyword lists, sentiment score thresholds, and semantic trigger descriptions in plain English

### Outbound Call Engine

- Calls placed via Smallest.ai to real PSTN numbers — no app or internet required on recipient side
- System prompt constructed at call time by merging campaign base prompt with recipient-specific variables
- Adaptive, branching conversation — the agent reasons about responses and generates follow-up questions dynamically rather than following a fixed script
- Retry logic — configurable number of retries on no-answer, with configurable retry intervals
- Per-recipient language assignment with auto-detection fallback

### Post-Call Processing Pipeline

Triggered by Smallest.ai call completion webhook:

1. **Transcript ingestion** — raw transcript and call metadata saved to DB
2. **Structured summarization** — Claude extracts key points, stated symptoms or concerns, emotional indicators, and any action items mentioned
3. **Sentiment scoring** — 1 (very distressed) to 5 (positive/stable), based on linguistic and semantic analysis of the full transcript
4. **Flag detection** — both keyword matching and semantic similarity checks against operator-defined escalation triggers
5. **Longitudinal delta** — if prior calls exist for this recipient, Claude computes trend direction (improving / stable / declining) across the last N calls

### Escalation System

- **P1** — immediate risk indicators (e.g., suicidal ideation, chest pain, fall with injury) → instant SMS + dashboard alert + call audio link
- **P2** — moderate concern (e.g., symptom worsening, medication non-adherence) → dashboard alert with structured summary
- **P3** — informational flag (e.g., expressed loneliness, mild confusion) → logged for review, no immediate push notification
- All escalations include: recipient info, call timestamp, full transcript, structured summary, sentiment score, matched flag triggers, and recommended next action

### Operator Dashboard

- Real-time call status polling (configurable interval, default 4s)
- Per-call detail view: transcript, structured summary, sentiment badge, flag tags, audio playback
- Per-recipient longitudinal view: sentiment trend chart (Recharts), call history timeline
- Escalation queue: sorted by priority tier, filterable by campaign, status, and date
- Campaign-level analytics: response rate, average sentiment, most common flagged themes

---

## Tech Stack

| Layer             | Technology                  | Rationale                                                                       |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Frontend          | Next.js 14 (App Router)     | File-based routing, server components, fast Vercel deployment                   |
| Styling           | Tailwind CSS                | Rapid UI development without context-switching to CSS files                     |
| Charts            | Recharts                    | Lightweight, composable, React-native charting                                  |
| Backend           | Node.js + Hono              | Lightweight, TypeScript-native, compatible with Mastra and Smallest.ai SDKs     |
| ORM               | Prisma                      | Type-safe DB queries, schema-as-code, easy migrations                           |
| Database          | PostgreSQL (Render)         | Reliable relational store for structured call records and campaign config       |
| Orchestration     | Mastra                      | TypeScript-native agent workflow engine with memory, RAG, and human-in-the-loop |
| Voice & Telephony | Smallest.ai                 | Sub-100ms latency, PSTN outbound calling, STT/TTS, webhook events               |
| AI Reasoning      | Anthropic Claude 3.5 Sonnet | In-conversation reasoning + post-call structured extraction via Tool Use        |
| Hosting           | Render                      | Unified hosting for backend, DB, and webhook listeners with autoscaling         |
| SMS Alerts        | Smallest.ai Messaging       | Escalation SMS without introducing a second telephony dependency                |

---

## Sponsor Integrations

### Smallest.ai

**Role:** Voice and telephony layer.

Used for two distinct purposes:

1. **Outbound call placement** — a single `POST /v1/calls` request with the recipient phone number, the constructed system prompt, and voice profile config places a real PSTN call within seconds
2. **Call completion webhook** — when the call ends, Smallest.ai fires a `POST` to `/webhooks/call-complete` with the full transcript, call duration, and call ID, triggering the post-processing pipeline

Also handles SMS delivery for escalation notifications, consolidating all outbound communication through a single vendor.

### Mastra

**Role:** Workflow orchestration and agent memory.

- **Scheduling** — workflow steps trigger call placement at configured intervals per recipient
- **Memory** — per-recipient conversation history stored and retrieved across calls, allowing the agent to reference prior check-ins
- **Human-in-the-loop** — P1 escalations pause the Mastra workflow pending responder acknowledgement before the next call fires
- **RAG** — campaign-specific knowledge (e.g., medication lists, discharge instructions) embedded and retrieved at call time to ground responses

### Anthropic Claude (Tool Use)

**Role:** In-conversation reasoning and post-call intelligence.

Invoked at two points:

1. **During the call** (via Smallest.ai's LLM integration) — Claude drives the adaptive conversation, reasoning about recipient responses and generating contextually appropriate follow-up questions
2. **Post-call processing** — Claude called via Anthropic API with Tool Use, using structured tools to return: `call_summary`, `sentiment_score`, `detected_flags`, `recommended_action`, `longitudinal_trend`

### Render

**Role:** Infrastructure and hosting.

- Backend API deployed as a Render Web Service
- PostgreSQL provisioned as a Render managed database
- Webhook endpoint exposed via Render's public URL
- Autoscaling handles call volume spikes during large campaign runs

### Builders Club · Akatos House · Sparkcraft

Community, mentorship, and ecosystem sponsors.

---

## Project Structure

```
pulsecall/
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Redirects to /setup
│   │   ├── setup/
│   │   │   └── page.tsx                # Campaign builder
│   │   ├── dashboard/
│   │   │   ├── page.tsx                # Campaign overview + live call status
│   │   │   └── [callId]/page.tsx       # Individual call detail view
│   │   └── escalations/
│   │       └── page.tsx                # Escalation queue
│   ├── components/
│   │   ├── CampaignForm.tsx
│   │   ├── CallCard.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── SentimentChart.tsx
│   │   └── EscalationQueue.tsx
│   └── lib/
│       └── api.ts                      # Typed API client
│
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Hono app entry point
│   │   ├── routes/
│   │   │   ├── campaigns.ts            # CRUD + call trigger
│   │   │   ├── calls.ts                # Call records + detail
│   │   │   └── escalations.ts          # Escalation queue
│   │   ├── webhooks/
│   │   │   └── smallestai.ts           # Call completion handler
│   │   ├── lib/
│   │   │   ├── smallestai.ts           # Outbound call placement
│   │   │   ├── anthropic.ts            # Post-call processing via Tool Use
│   │   │   ├── mastra.ts               # Workflow + memory
│   │   │   └── sms.ts                  # Escalation SMS dispatch
│   │   └── types/
│   │       └── index.ts
│   └── prisma/
│       ├── schema.prisma
│       └── seed.ts                     # Demo data seeder
│
├── prompts/
│   ├── post-discharge.txt
│   ├── elder-companion.txt
│   ├── student-wellness.txt
│   └── post-call-processing.txt
│
├── .env.example
├── LICENSE
└── README.md
```

---

## Setup & Installation

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- PostgreSQL instance (local or Render managed)
- Smallest.ai account with API key and a provisioned phone number
- Anthropic API key (Claude 3.5 Sonnet access required)
- Mastra CLI: `npm install -g @mastra/cli`

### 1. Clone the Repository

```bash
git clone https://github.com/your-team/pulsecall.git
cd pulsecall
```

### 2. Install Dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

See [Environment Variables](#environment-variables) for the full reference.

### 4. Initialize the Database

```bash
cd backend

# Run migrations
npx prisma migrate dev --name init

# Seed demo data
npx prisma db seed
```

### 5. Configure the Smallest.ai Webhook

In your Smallest.ai dashboard under **Webhooks**, set the call completion URL to:

```
https://<your-backend-url>/webhooks/call-complete
```

For local development, expose your backend with ngrok:

```bash
ngrok http 3001
# Set the generated https URL as the webhook endpoint in Smallest.ai
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/pulsecall

# Smallest.ai
SMALLEST_AI_API_KEY=your_smallest_ai_api_key
SMALLEST_AI_PHONE_NUMBER=+1xxxxxxxxxx
SMALLEST_AI_WEBHOOK_SECRET=your_webhook_secret

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Escalation
ESCALATION_SMS_TO=+1xxxxxxxxxx

# Server
PORT=3001
NODE_ENV=development
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_POLL_INTERVAL_MS=4000
```

---

## Running Locally

```bash
# Terminal 1 — Backend
cd backend && npm run dev
# Listening on http://localhost:3001

# Terminal 2 — Frontend
cd frontend && npm run dev
# Listening on http://localhost:3000

# Terminal 3 — Webhook tunnel (required for Smallest.ai callbacks)
ngrok http 3001
```

---

## API Reference

### Campaigns

| Method | Endpoint                  | Description                             |
| ------ | ------------------------- | --------------------------------------- |
| `POST` | `/campaigns`              | Create a new campaign                   |
| `GET`  | `/campaigns`              | List all campaigns                      |
| `GET`  | `/campaigns/:id`          | Get campaign detail                     |
| `POST` | `/campaigns/:id/call-now` | Manually trigger a call for a recipient |

### Calls

| Method | Endpoint                               | Description                                             |
| ------ | -------------------------------------- | ------------------------------------------------------- |
| `GET`  | `/calls`                               | List all calls (filterable by `campaignId`, `status`)   |
| `GET`  | `/calls/:id`                           | Get call detail — transcript, summary, flags, sentiment |
| `GET`  | `/calls/recipient/:recipientId/trends` | Longitudinal sentiment data for a recipient             |

### Escalations

| Method  | Endpoint                       | Description                             |
| ------- | ------------------------------ | --------------------------------------- |
| `GET`   | `/escalations`                 | List all escalations sorted by priority |
| `PATCH` | `/escalations/:id/acknowledge` | Mark escalation as acknowledged         |

### Webhooks

| Method | Endpoint                  | Description                                                              |
| ------ | ------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/webhooks/call-complete` | Smallest.ai call completion callback — triggers post-processing pipeline |

---

## Prompt Design

All conversation prompts live in `/prompts/` as plain text files and follow this structure:

```
PERSONA
You are [name], a [role] at [organization]. Your tone is [adjectives].

GOAL
Your goal for this call is to [primary objective].

CONVERSATION GUIDE
1. Open with: [greeting using {{name}}]
2. Probe for: [topics to cover]
3. If the patient mentions [X], follow up with: [probe questions]
4. Do not: [hard constraints]

ESCALATION
If the patient mentions any of the following, note it and flag:
- [trigger 1]
- [trigger 2]
```

The post-call processing prompt (`post-call-processing.txt`) instructs Claude to respond exclusively via Tool Use, returning a typed JSON object — eliminating free-form text that would require additional parsing.

---

## Team

Built at the AI Agents Waterloo Voice Hackathon 2026.

| Name            | Role                   |
| --------------- | ---------------------- |
| [Team Member 1] | Backend & Integrations |
| [Team Member 2] | Frontend & Dashboard   |
| [Team Member 3] | AI, Prompts & Demo     |

---

## License

MIT License — see [LICENSE](./LICENSE) for details.

Copyright (c) 2026 [Your Team Name]

Attribution required: any use or derivative of this codebase must retain the original copyright notice.
