# PulseCall

Proactive AI voice agent that checks in on patients via real-time voice calls — conducting intelligent, personalized conversations and surfacing alerts when something needs human attention.

Built at the **AI Agents Waterloo Voice Hackathon 2026**.

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/AustinNg0321/PulseCall.git
cd PulseCall
```

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Set Up API Keys

Copy the example and fill in your keys:

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
SMALLEST_AI_API_KEY=your-key-here
```

| Key | Where to get it | Used for |
|-----|-----------------|----------|
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | LLM (Llama 3.3 70B — free tier) |
| `SMALLEST_AI_API_KEY` | [smallest.ai](https://smallest.ai) | STT (Speech-to-Text) + TTS (Text-to-Speech) |

### 3. Run

```bash
# Terminal 1 — Backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

### 4. Try It

1. Dashboard loads with 3 pre-seeded patient campaigns
2. Click **"Simulate Call"** on any campaign
3. Review the patient profile, then click **"Start AI Check-in"**
4. Grant microphone access → speak naturally → AI responds with voice
5. End the call → view the Medical Summary
6. Check the dashboard for call records and escalations

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
