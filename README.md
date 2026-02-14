# PulseCall

A platform for deploying proactive AI voice agents that periodically check in on patients, elderly individuals, students, or any defined group — conducting intelligent, personalized conversations and surfacing alerts when something needs human attention.

> **This README reflects the MVP scope** built at the AI Agents Waterloo Voice Hackathon 2026. The MVP demonstrates the core concept — campaign configuration, AI-powered conversation simulation, post-call intelligence, and escalation — without live telephony infrastructure.

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

---

## Table of Contents

- [Motivation](#motivation)
- [MVP Scope](#mvp-scope)
- [How It Works](#how-it-works)
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
- [Roadmap](#roadmap)
- [Team](#team)
- [License](#license)

---

## Motivation

Most AI voice agent deployments are reactive — they wait for a user to initiate contact. PulseCall inverts this: the agent initiates. This matters most in domains where the populations who need help most are also the least likely to reach out unprompted — recently discharged patients, isolated elderly individuals, students in early academic distress, newly arrived immigrants.

Existing solutions (Hippocratic AI, Orbita, Artera) are either narrow in use case, locked behind enterprise contracts, or inaccessible to smaller organizations. PulseCall is the generalized infrastructure layer: define a prompt, a list of people, and a schedule — and it handles proactive outreach at scale.

---

## MVP Scope

The MVP focuses exclusively on proving the core intelligence pipeline works. Telephony (live phone calls), scheduling, and external notifications are post-MVP features.

### ✅ In Scope
- Campaign builder — define agent persona, conversation prompt, recipient info, and escalation keywords
- Simulated call interface — interact with the AI agent via text chat, simulating a real phone conversation
- Claude-powered conversation — adaptive, contextually aware responses driven by the campaign prompt
- Post-conversation processing — automatic summary, sentiment scoring, and flag detection via Anthropic Tool Use
- Escalation detection — if a flag is triggered during the conversation, an alert surfaces on the dashboard
- In-memory data store — no database configuration required; all state held in Python dicts for the duration of the session
- Operator dashboard — view all simulated calls, summaries, sentiment scores, and escalations

### ❌ Out of Scope (Post-MVP)
- Live outbound phone calls (Twilio / Bland.ai / Smallest.ai telephony)
- Automated call scheduling (APScheduler / cron)
- SMS escalation notifications
- CSV recipient bulk upload
- Longitudinal trend analysis across multiple calls
- Persistent database (PostgreSQL / SQLAlchemy)
- Mastra workflow orchestration

---

## How It Works

```
1. Operator creates a campaign
   → Sets agent persona, conversation goal, recipient details, escalation keywords

2. Operator clicks "Simulate Call"
   → A conversation session opens between the operator (acting as recipient) and the AI agent

3. Conversation runs
   → Claude generates responses in real time, guided by the campaign system prompt
   → Conversation history maintained for the duration of the session

4. Operator ends the call
   → Full conversation transcript sent to Claude via Anthropic Tool Use
   → Structured output returned: summary, sentiment score (1–5), detected flags, recommended action

5. Results appear on dashboard
   → If flags detected → escalation alert shown with full context
   → Call record added to campaign history
```

---

## Architecture Overview

```
┌─────────────────────────────────┐
│         Operator Dashboard       │  Next.js + Tailwind
│  Campaign Builder / Call Sim     │
│  Dashboard / Escalation Queue    │
└────────────────┬────────────────┘
                 │ REST API
┌────────────────▼────────────────┐
│         Backend API              │  Python + FastAPI
│                                  │
│  POST /campaigns                 │  Create campaign
│  POST /campaigns/{id}/simulate   │  Start simulated call session
│  POST /conversations/{id}/turn   │  Send a message, get Claude response
│  POST /conversations/{id}/end    │  End call, trigger post-processing
│  GET  /calls                     │  Fetch call history
│  GET  /escalations               │  Fetch escalation queue
└──────────────┬──────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────────┐    ┌───────▼──────────────────────┐
│ In-Memory  │    │     Anthropic Claude           │
│   Store    │    │                               │
│            │    │  1. Conversation responses    │
│ campaigns{}│    │     (claude during sim call)  │
│ calls{}    │    │                               │
│ escalations│    │  2. Post-call processing      │
│            │    │     via Tool Use:             │
└────────────┘    │     - summary                 │
                  │     - sentiment_score         │
                  │     - detected_flags          │
                  │     - recommended_action      │
                  └───────────────────────────────┘
```

---

## Features

### Campaign Builder
- Define agent **name and persona** (e.g., "You are Claire, a warm post-discharge nurse")
- Write a **conversation goal** in plain English (e.g., "Check pain levels, medication adherence, and flag any concerning symptoms")
- Set **recipient details** — name, age, relevant context variables
- Define **escalation keywords** — words or phrases that trigger a priority alert (e.g., "chest pain", "can't breathe", "fell")

### Simulated Call Interface
- Text-based chat UI that simulates a voice call conversation
- Operator types as the recipient; Claude responds as the configured agent
- Real-time response generation — Claude maintains full conversation context throughout the session
- Clear visual distinction between agent and recipient turns
- "End Call" button to terminate the session and trigger post-processing

### Post-Call Intelligence (Anthropic Tool Use)
On call end, the full transcript is sent to Claude with a structured Tool Use schema:

- **Summary** — 2–3 sentence plain English summary of the conversation
- **Sentiment score** — integer 1 (very distressed) to 5 (positive/stable)
- **Detected flags** — list of concerning phrases or topics identified
- **Recommended action** — suggested next step for the human responder

### Escalation System
- If `detected_flags` is non-empty, an escalation record is created automatically
- Priority assigned based on keyword severity: P1 (immediate), P2 (moderate), P3 (informational)
- Escalation queue on dashboard shows: recipient, call timestamp, flags detected, sentiment score, summary, and recommended action
- Escalations can be marked as acknowledged

### Operator Dashboard
- Campaign overview — list of all campaigns with call counts and average sentiment
- Call history per campaign — all simulated calls with status, sentiment badge, and flag tags
- Call detail view — full transcript, structured summary, sentiment score, flags
- Escalation queue — sorted by priority, filterable by status

### In-Memory Data Store
All data is held in Python dictionaries for the session:

```python
# In-memory store — no database configuration required
store = {
    "campaigns": {},    # campaign_id → campaign config
    "recipients": {},   # recipient_id → recipient details
    "calls": {},        # call_id → call record + transcript + summary
    "escalations": {}   # escalation_id → escalation record
}
```

Data is seeded at startup with fictional demo records so the dashboard looks populated from the first second of the demo.

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14 (App Router) | File-based routing, fast iteration |
| Styling | Tailwind CSS | Rapid UI without CSS context-switching |
| Charts | Recharts | Sentiment score visualization |
| Backend | Python 3.11 + FastAPI | Team proficiency; clean async support; auto-generated Swagger docs |
| Data layer | **In-memory Python dicts** | Zero setup; sufficient for MVP demo scope |
| AI Reasoning | Anthropic Claude (`claude-sonnet-4-5-20250929`) | Conversation generation + post-call Tool Use processing |
| HTTP client | httpx | Async HTTP calls to Anthropic API |
| Hosting | Render | Simple deployment with public URL for demo |

---

## Sponsor Integrations

### Anthropic Claude (Tool Use)
**Role:** The entire intelligence layer — both during and after the simulated call.

**During the simulated call:**
Claude generates contextually aware, adaptive responses as the AI agent, guided by the campaign system prompt. It maintains conversation history across turns, asks intelligent follow-up questions, and adjusts its tone based on what the recipient says.

```python
import anthropic

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

def get_agent_response(
    system_prompt: str,
    conversation_history: list[dict]
) -> str:
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=150,  # Keep voice-appropriate response length
        system=system_prompt,
        messages=conversation_history
    )
    return response.content[0].text
```

**After the simulated call (Tool Use):**
Claude processes the full transcript and returns structured data via a defined tool schema — no free-form text parsing required.

```python
def process_transcript(transcript: str) -> dict:
    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1024,
        tools=[{
            "name": "process_call",
            "description": "Extract structured insights from a call transcript",
            "input_schema": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "2-3 sentence summary of the conversation"
                    },
                    "sentiment_score": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "description": "1=very distressed, 5=positive and stable"
                    },
                    "detected_flags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concerning phrases or topics identified"
                    },
                    "recommended_action": {
                        "type": "string",
                        "description": "Suggested next step for the human responder"
                    }
                },
                "required": [
                    "summary",
                    "sentiment_score",
                    "detected_flags",
                    "recommended_action"
                ]
            }
        }],
        tool_choice={"type": "tool", "name": "process_call"},
        messages=[{
            "role": "user",
            "content": f"Process this call transcript:\n\n{transcript}"
        }]
    )
    return response.content[0].input
```

### Smallest.ai
**Role:** Voice synthesis layer — post-MVP.

In the MVP, conversation is text-based. Smallest.ai will be integrated in the next phase to convert Claude's text responses to natural-sounding speech, enabling real voice interaction in the simulated call interface before live telephony is added.

### Render
**Role:** Hosting.

FastAPI backend and Next.js frontend deployed to Render for a stable public URL during the demo. Single-command deployment via Render's GitHub integration.

### Builders Club · Akatos House · Sparkcraft · Mastra
Community and ecosystem sponsors. Mastra's TypeScript workflow engine is on the post-MVP roadmap for campaign scheduling and per-recipient conversation memory management.

---

## Project Structure

```
pulsecall/
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      # Redirects to /setup
│   │   ├── setup/
│   │   │   └── page.tsx                  # Campaign builder form
│   │   ├── dashboard/
│   │   │   ├── page.tsx                  # Campaign list + call history
│   │   │   └── [callId]/page.tsx         # Call detail — transcript + summary
│   │   ├── simulate/
│   │   │   └── [campaignId]/page.tsx     # Simulated call chat interface
│   │   └── escalations/
│   │       └── page.tsx                  # Escalation queue
│   ├── components/
│   │   ├── CampaignForm.tsx              # Campaign builder fields
│   │   ├── ChatInterface.tsx             # Simulated call turn-by-turn UI
│   │   ├── CallSummaryCard.tsx           # Post-call structured output display
│   │   ├── SentimentBadge.tsx            # Colour-coded 1–5 sentiment indicator
│   │   └── EscalationQueue.tsx           # Prioritised escalation list
│   └── lib/
│       └── api.ts                        # Typed API client (fetch wrapper)
│
├── backend/
│   ├── main.py                           # FastAPI app + CORS + router registration
│   ├── store.py                          # In-memory data store + seed data
│   ├── routers/
│   │   ├── campaigns.py                  # POST /campaigns, GET /campaigns
│   │   ├── conversations.py              # POST /simulate, /turn, /end
│   │   ├── calls.py                      # GET /calls, GET /calls/{id}
│   │   └── escalations.py               # GET /escalations, PATCH /acknowledge
│   ├── services/
│   │   ├── claude.py                     # Conversation generation + Tool Use
│   │   └── escalation.py                 # Flag detection + priority assignment
│   ├── schemas/
│   │   ├── campaign.py                   # Pydantic models for request/response
│   │   ├── conversation.py
│   │   └── escalation.py
│   ├── prompts/
│   │   ├── post-discharge.txt            # Default campaign prompt templates
│   │   ├── elder-companion.txt
│   │   ├── student-wellness.txt
│   │   └── post-call-processing.txt      # Tool Use extraction instructions
│   ├── seed.py                           # Loads demo data into in-memory store
│   ├── config.py                         # Settings via pydantic-settings
│   └── requirements.txt
│
├── .env.example
├── LICENSE
└── README.md
```

---

## Setup & Installation

### Prerequisites
- Python >= 3.11
- Node.js >= 18.0.0
- Anthropic API key (Claude access required)

### 1. Clone the Repository

```bash
git clone https://github.com/your-team/pulsecall.git
cd pulsecall
```

### 2. Install Backend Dependencies

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**`requirements.txt`**
```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
anthropic>=0.25.0
httpx>=0.27.0
pydantic>=2.7.0
pydantic-settings>=2.2.0
python-multipart>=0.0.9
```

### 3. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

### 4. Configure Environment Variables

```bash
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Server
PORT=8000
ENV=development
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Running Locally

```bash
# Terminal 1 — FastAPI backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
# API:  http://localhost:8000
# Docs: http://localhost:8000/docs

# Terminal 2 — Next.js frontend
cd frontend
npm run dev
# UI: http://localhost:3000
```

---

## API Reference

Full interactive documentation auto-generated at `http://localhost:8000/docs`.

### Campaigns

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/campaigns` | Create a new campaign |
| `GET` | `/campaigns` | List all campaigns |
| `GET` | `/campaigns/{id}` | Get campaign detail |

### Conversations (Simulated Calls)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/campaigns/{id}/simulate` | Start a simulated call session → returns `conversation_id` |
| `POST` | `/conversations/{id}/turn` | Send recipient message → returns Claude agent response |
| `POST` | `/conversations/{id}/end` | End call → triggers post-processing → returns summary + flags |

### Calls

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/calls` | List all calls with summaries |
| `GET` | `/calls/{id}` | Get full call detail — transcript, summary, sentiment, flags |

### Escalations

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/escalations` | List all escalations sorted by priority |
| `PATCH` | `/escalations/{id}/acknowledge` | Mark escalation as acknowledged |

---

## Prompt Design

Campaign prompts are plain text files in `/backend/prompts/` following this structure:

```
PERSONA
You are [name], a [role]. Your tone is [adjectives].
Keep responses concise — under 3 sentences — as this simulates a voice call.

GOAL
[Primary objective for this call.]

CONVERSATION GUIDE
1. Greet the recipient by name: {{name}}
2. Probe for: [list of topics]
3. If they mention [X], follow up with: [probe questions]
4. Do not: [hard constraints]

ESCALATION TRIGGERS
Flag the conversation if the recipient mentions:
- [trigger 1]
- [trigger 2]
```

The `{{name}}` syntax is resolved at call time by substituting recipient variables before the prompt is sent to Claude.

---

## Roadmap

Features planned for post-hackathon development, in priority order:

**Phase 2 — Voice Layer**
- Integrate Smallest.ai TTS to convert Claude's text responses to speech in the simulated call UI
- Add browser-based microphone input (Web Speech API) so operators can speak instead of type

**Phase 3 — Live Telephony**
- Integrate Bland.ai or Twilio for real outbound PSTN calls
- Replace simulated call interface with real call placement and webhook-based transcript ingestion

**Phase 4 — Scheduling & Persistence**
- Add APScheduler for automated campaign call scheduling
- Migrate in-memory store to PostgreSQL with SQLAlchemy + Alembic
- Add Mastra for workflow orchestration and per-recipient memory across calls

**Phase 5 — Notifications & Analytics**
- SMS escalation alerts via Smallest.ai Messaging
- Longitudinal sentiment trend charts per recipient
- Campaign-level analytics dashboard

---

## Team

Built at the AI Agents Waterloo Voice Hackathon 2026.

| Name | Role |
|---|---|
| [Team Member 1] | Backend & Integrations |
| [Team Member 2] | Frontend & Dashboard |
| [Team Member 3] | AI, Prompts & Demo |

---

## License

MIT License — see [LICENSE](./LICENSE) for details.

Copyright (c) 2026 [Your Team Name]

Attribution required: any use or derivative of this codebase must retain the copyright notice.