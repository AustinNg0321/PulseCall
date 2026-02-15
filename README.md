# PulseCall

Proactive AI voice agent that checks in on patients via real-time voice calls — conducting intelligent, personalized conversations and surfacing alerts when something needs human attention.

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

---

## Requirements

- Python 3.10+ → [python.org/downloads](https://www.python.org/downloads/)
- Node.js 18+ → [nodejs.org](https://nodejs.org/)

---

## Setup & Run

**1. Clone and install everything:**

```bash
git clone https://github.com/AustinNg0321/PulseCall.git
cd PulseCall

# Backend
cd backend
python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
# Windows: python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

**2. Add your API keys:**

```bash
cd ../backend
cp .env.example .env
```

Edit `backend/.env` — these two keys are **required**:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here    # Get from https://openrouter.ai (free tier)
SMALLEST_AI_API_KEY=your-key-here             # Get from https://smallest.ai
```

**3. (Optional) Enable SMS escalation via Twilio:**

Add these to `backend/.env` if you want real SMS alerts. Without them, escalations still show on the dashboard — they just won't send a text.

```env
TWILIO_ACCOUNT_SID=your-sid          # https://twilio.com/console
TWILIO_AUTH_TOKEN=your-token
TWILIO_FROM_NUMBER=+1234567890       # Your Twilio phone number
ESCALATION_TO_NUMBER=+1234567890     # Where to send alerts
```

**4. Start the app (two terminals):**

```bash
# Terminal 1 — Backend on :8000
cd backend && source venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend on :3000
cd frontend
npm run dev
```

**5. Open http://localhost:3000** — 3 demo patient campaigns are pre-loaded. Click **Simulate Call** on any one, grant mic access, and start talking.

> DB is SQLite and auto-creates on first run. No migrations needed.
> Backend API docs available at http://localhost:8000/docs.

### 5. Test It

Backend:

Run
```bash
# activate virtual environment
cd backend
pip install pytest
python -m pytest tests/ -v
```

Frontend:

Run
```bash
# activate virtual environment
cd frontend
npm install --save-dev jest
npm install --save-dev typescript ts-node
npm test
```

Backend tested behaviors

- backend/tests/test_main.py
    - Campaign creation works with recipient list.
    - Conversation creation initializes required fields.
    - Sending a turn appends user/assistant history.
    - Conversation-to-campaign mismatch returns 400.
    - Ending a call marks conversation inactive and sets end timestamp.
    - Conversation listing includes created conversations.
- backend/tests/test_campaigns_and_calls.py
    - Seed campaigns are returned from /campaigns.
    - Full flow: create campaign -> create conversation -> send message -> end call.
    - Escalation is created when keywords are detected on end-call processing.
    - Escalation acknowledge endpoint updates status + acknowledgment timestamp.
- backend/tests/test_users_outbound_and_history.py
    - User create/list endpoints work.
    - Manual outbound call endpoint success path (call_placed + smallest_call_id).
    - Manual outbound failure path sets DB state to BUSY_RETRY.
    - Call history endpoint returns DB-backed records for a user.
- backend/tests/test_webhooks_and_analytics.py
    - Post-call webhook busy status schedules retry.
    - Post-call webhook escalation path triggers SMS hook + in-memory escalation entry.
    - Post-call transcript-analysis path stores completion and escalates on detected flags.
    - Analytics webhook returns already_processed for completed calls.
- backend/tests/test_voice_endpoints.py
    - /voice/chat initial success path (LLM + TTS mocked).
    - /voice/chat requires transcription for non-initial turns.
    - /voice/transcribe success path (STT mocked).
    - /voice/summary parses JSON from model response.

———

Frontend tested behaviors

- frontend/src/lib/api.test.ts
    - listCampaigns sends proper GET request and parses response.
    - createCampaign sends POST with body.
    - listCalls/getCall normalize id -> call_id.
    - Error path surfaces backend detail when response is non-OK.
- frontend/src/components/SentimentBadge.test.tsx
    - Correct label/score rendering for known sentiment score.
    - Fallback to neutral for unknown score.
- frontend/src/components/Sidebar.test.tsx
    - Sidebar renders expected navigation links.
    - Active route styling toggles based on mocked pathname.

---

## How It Works

```
User speaks → Browser records audio
    → Backend STT (Smallest.ai) → transcription
    → Backend LLM (Llama 3.3 70B via OpenRouter) → AI reply text
    → Backend TTS (Smallest.ai) → AI reply audio
    → Browser plays audio → User speaks again...
```

The AI agent follows a structured 6-step conversation flow (greeting → pain check → medication → PT exercises → concerns → closing) guided by the campaign's system prompt and patient context.

---

## Key Features

- **Real-time voice calls** — speak naturally via browser microphone, AI responds with synthesized speech
- **Dynamic patient profiles** — each campaign has structured patient data (surgery, medications, allergies, call history)
- **Campaign system** — define agent persona, conversation goal, escalation keywords, and patient context
- **Post-call intelligence** — automatic summary with pain level, symptoms, PT compliance, medication status, and recommendations
- **Escalation detection** — flags urgent symptoms (chest pain, bleeding, fever >101.5°F) and creates priority alerts
- **Operator dashboard** — view all calls, summaries, sentiment scores, and escalation queue

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (App Router) + Tailwind CSS |
| Backend | Python + FastAPI |
| LLM | Llama 3.3 70B via OpenRouter (free) |
| STT | Smallest.ai Lightning |
| TTS | Smallest.ai Lightning v3.1 |
| Data | In-memory (seeded with 3 demo patients) |

---

## Project Structure

```
pulsecall/
├── backend/
│   ├── main.py              # FastAPI app, all endpoints, voice pipeline
│   ├── claude.py             # Claude integration (post-call processing)
│   ├── models.py             # Pydantic schemas
│   ├── triage.py             # Escalation detection
│   ├── notifier.py           # Notification logic
│   ├── scheduler.py          # Call scheduling
│   ├── requirements.txt
│   └── .env                  # API keys (not committed)
│
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx          # Redirects to dashboard
│   │   ├── setup/page.tsx    # Campaign builder form
│   │   ├── dashboard/        # Campaign list + call history
│   │   ├── simulate/[campaignId]/page.tsx  # Voice call UI
│   │   └── escalations/      # Escalation queue
│   └── src/lib/api.ts        # Typed API client
│
├── backend/.env.example      # Copy to backend/.env and fill in keys
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/campaigns/create` | Create a new campaign |
| `GET` | `/campaigns` | List all campaigns |
| `GET` | `/campaigns/{id}` | Get campaign detail |
| `POST` | `/voice/chat` | LLM response + TTS audio |
| `POST` | `/voice/transcribe` | Audio → text (STT) |
| `POST` | `/voice/summary` | Generate post-call medical summary |
| `GET` | `/calls` | List all call records |
| `GET` | `/escalations` | List escalation queue |

Full interactive docs at `http://localhost:8000/docs`.

---

## Team

Built at the AI Agents Waterloo Voice Hackathon 2026.

---

## License

MIT
