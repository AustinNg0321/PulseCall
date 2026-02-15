# PulseCall

Proactive AI voice agent that checks in on patients via real-time voice calls — conducting intelligent, personalized conversations and surfacing alerts when something needs human attention.

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

---

## How It Works

```
User speaks → Browser records audio
    → Backend STT (Smallest.ai Lightning) → transcription
    → Backend LLM (GPT-4o-mini via OpenRouter) → AI reply text
    → Backend TTS (Smallest.ai Lightning v3.1) → AI reply audio
    → Browser plays audio → User speaks again …
```

The AI agent follows a structured **6-phase conversation flow** — greeting → symptom assessment → care verification → guidance → new issues → conclusion — guided by the campaign's system prompt and full patient context (surgery history, medications, allergies, previous call logs).

When the call ends, a separate analysis model (Claude 3.5 Sonnet via OpenRouter) processes the transcript and extracts a structured medical summary with pain level, symptoms, PT compliance, medication status, and recommendations.

---

## Key Features

- **Real-time voice calls** — speak naturally via browser microphone; AI responds with synthesized speech
- **Dynamic patient profiles** — each campaign carries structured patient data (surgery, medications, allergies, vitals, call history)
- **Campaign system** — define agent persona, conversation goal, escalation keywords, and patient context
- **Post-call intelligence** — automatic JSON summary with pain level, symptoms, PT compliance, medication status, and recommendations
- **Acoustic triage** — classifies call audio (background noise, critical silence, distress keywords, emotion detection) and decides next action
- **Escalation detection** — flags urgent symptoms (chest pain, blood clots, fever > 38.3 °C) and creates priority alerts with optional Twilio SMS
- **Operator dashboard** — view all campaigns, calls, summaries, sentiment scores, and escalation queue
- **Outbound call scheduling** — APScheduler-based job queue with automatic retries for busy/no-answer calls

---

## Requirements

- **Python 3.10+** → [python.org/downloads](https://python.org/downloads)
- **Node.js 18+** → [nodejs.org](https://nodejs.org)

---

## Setup & Run

### 1. Clone and install

```bash
git clone https://github.com/AustinNg0321/PulseCall.git
cd PulseCall

# Backend
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Add your API keys

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` — these two keys are **required**:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here    # https://openrouter.ai
SMALLEST_AI_API_KEY=your-key-here             # https://smallest.ai
```

### 3. (Optional) Enable SMS escalation via Twilio

Add these to `backend/.env` if you want real SMS alerts. Without them, escalations still appear on the dashboard — they just won't send a text.

```env
TWILIO_ACCOUNT_SID=your-sid          # https://twilio.com/console
TWILIO_AUTH_TOKEN=your-token
TWILIO_FROM_NUMBER=+1234567890       # Your Twilio phone number
ESCALATION_TO_NUMBER=+1234567890     # Where to send alerts
```

### 4. Start the app (two terminals)

```bash
# Terminal 1 — Backend on :8000
cd backend && source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend on :3000
cd frontend
npm run dev
```

### 5. Use it

Open **http://localhost:3000** — 3 demo patient campaigns are pre-loaded. Click **Simulate Call** on any patient, grant mic access, and start talking.

- SQLite DB auto-creates on first run. No migrations needed.
- Backend API docs: **http://localhost:8000/docs**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router) + Tailwind CSS 4 + Lucide icons |
| **Backend** | Python 3.10 + FastAPI |
| **Voice LLM** | GPT-4o-mini via OpenRouter |
| **Analysis LLM** | Claude 3.5 Sonnet via OpenRouter |
| **STT** | Smallest.ai Lightning |
| **TTS** | Smallest.ai Lightning v3.1 |
| **Database** | SQLite (SQLAlchemy ORM) + in-memory store |
| **Scheduling** | APScheduler (AsyncIO) |
| **SMS** | Twilio (optional) |

---

## Project Structure

```
PulseCall/
├── backend/
│   ├── main.py              # FastAPI app — all endpoints, voice pipeline, seed data
│   ├── claude.py            # OpenRouter LLM integration (chat + post-call analysis)
│   ├── models.py            # Pydantic schemas (webhooks, call states, triage)
│   ├── database.py          # SQLAlchemy models + SQLite session (UserRecord, CallRecord)
│   ├── triage.py            # Acoustic triage logic (noise, silence, distress, emotion)
│   ├── notifier.py          # Twilio SMS escalation
│   ├── scheduler.py         # APScheduler outbound call queue + retries
│   ├── conftest.py          # Pytest fixtures (test client, mocks)
│   ├── tests/               # Backend test suite
│   ├── requirements.txt
│   ├── .env.example
│   └── .env                 # API keys (git-ignored)
│
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx                        # Dashboard — campaigns, calls, escalations
│   │   ├── setup/page.tsx                  # Campaign builder form
│   │   ├── simulate/[campaignId]/page.tsx  # Real-time voice call UI
│   │   ├── calls/[callId]/page.tsx         # Call detail + transcript view
│   │   └── escalations/page.tsx            # Escalation queue
│   ├── src/components/
│   │   ├── Sidebar.tsx                     # Navigation sidebar
│   │   └── SentimentBadge.tsx              # Sentiment score display
│   ├── src/lib/api.ts                      # Typed API client
│   └── package.json
│
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/campaigns/create` | Create a new campaign |
| `GET` | `/campaigns` | List all campaigns |
| `GET` | `/campaigns/{id}` | Get campaign detail |
| `POST` | `/campaigns/conversations/create` | Start a new conversation |
| `POST` | `/campaigns/{cid}/{convId}` | Send a chat turn (text) |
| `POST` | `/campaigns/{cid}/{convId}/end` | End call + get analysis |
| `POST` | `/voice/chat` | LLM response + TTS audio (voice mode) |
| `POST` | `/voice/transcribe` | Audio → text (STT) |
| `POST` | `/voice/summary` | Generate post-call medical summary |
| `GET` | `/calls` | List all call records |
| `GET` | `/calls/{id}` | Get call detail |
| `GET` | `/conversations` | List all conversations |
| `GET` | `/escalations` | List escalation queue |
| `PATCH` | `/escalations/{id}/acknowledge` | Acknowledge an escalation |
| `POST` | `/users` | Create a user (for outbound calls) |
| `GET` | `/users` | List users |
| `POST` | `/calls/outbound` | Trigger manual outbound call |
| `GET` | `/call-history/{userId}` | Get DB-backed call history for a user |
| `POST` | `/webhooks/smallest/post-call` | Smallest.ai post-call webhook |
| `POST` | `/webhooks/smallest/analytics` | Smallest.ai analytics webhook |

Full interactive docs at **http://localhost:8000/docs**.

---

## Testing

### Backend

```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v
```

**Tested behaviors:**

- **test_main.py** — Campaign CRUD, conversation lifecycle, chat turns, end-call processing, conversation listing
- **test_campaigns_and_calls.py** — Seed data, full flow (create → chat → end), escalation creation on keyword detection, acknowledge endpoint
- **test_users_outbound_and_history.py** — User create/list, manual outbound call (success + failure paths), DB-backed call history
- **test_webhooks_and_analytics.py** — Post-call webhook (busy retry, escalation, transcript analysis), analytics webhook idempotency
- **test_voice_endpoints.py** — `/voice/chat` (initial + follow-up), `/voice/transcribe`, `/voice/summary` JSON parsing

### Frontend

```bash
cd frontend
npm test
```

**Tested behaviors:**

- **api.test.ts** — `listCampaigns`, `createCampaign`, `listCalls`/`getCall` id normalization, error handling
- **SentimentBadge.test.tsx** — Score rendering, neutral fallback
- **Sidebar.test.tsx** — Navigation links, active route styling

---

## Team

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

## License

MIT