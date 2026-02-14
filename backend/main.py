from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from claude import respond

app = FastAPI(title="PulseCall MVP API", version="0.1.0")


# -----------------------------
# Pydantic models
# -----------------------------
class Recipient(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None


class CampaignCreate(BaseModel):
    name: str
    agent_persona: str
    conversation_goal: str
    system_prompt: str
    escalation_keywords: list[str] = Field(default_factory=list)
    recipients: list[Recipient]


class CampaignOut(CampaignCreate):
    id: str
    created_at: str


class Conversation(BaseModel):
    conversation_id: str
    campaign_id: str
    status: Literal["active", "inactive"]
    start_time: str
    end_time: str | None = None
    history: list[dict[str, str]]


class EndCallOut(BaseModel):
    call_id: str
    conversation_id: str
    campaign_id: str
    status: Literal["ended"]
    summary: str
    sentiment_score: int
    detected_flags: list[str]
    recommended_action: str
    escalation_id: str | None = None


# -----------------------------
# In-memory store
# -----------------------------
store: dict[str, dict[str, Any]] = {
    "campaigns": {},
    "conversations": {},
    "calls": {},
    "escalations": {},
}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()

# to be implemented
def sentiment_from_text(text: str) -> int:
    negative_markers = ("angry", "upset", "cancel", "frustrated", "bad", "hate")
    lowered = text.lower()
    if any(marker in lowered for marker in negative_markers):
        return 2
    if "thank" in lowered or "great" in lowered:
        return 4
    return 3

# to be implemented
def summarize_transcript(transcript: list[dict[str, str]]) -> str:
    if not transcript:
        return "No conversation content captured."
    first_user_msg = next((t["content"] for t in transcript if t["role"] == "user"), "")
    return (
        "Agent and recipient completed a simulated call. "
        f"Recipient's main concern: {first_user_msg[:120]}"
    ).strip()

# to be implemented
def detect_flags(transcript: list[dict[str, str]], keywords: list[str]) -> list[str]:
    if not keywords:
        return []
    joined = " ".join(turn["content"] for turn in transcript).lower()
    return [kw for kw in keywords if kw.lower() in joined]

# okay
def recommended_action_for_flags(flags: list[str]) -> str:
    if not flags:
        return "No escalation required. Follow up in normal workflow."
    return "Escalate to a human operator within 15 minutes."


def seed_example_data() -> None:
    campaign_id = "cmp_demo_001"
    conversation_id = "conv_demo_001"
    call_id = "call_demo_001"
    escalation_id = "esc_demo_001"
    created_at = now_iso()

    campaign = {
        "id": campaign_id,
        "name": "Care Plan Renewal",
        "agent_persona": "Calm healthcare outreach specialist",
        "conversation_goal": "Confirm whether recipient wants help renewing care plan.",
        "system_prompt": "Be concise, empathetic, and clear. Ask one question at a time.",
        "escalation_keywords": ["cancel", "complaint", "lawyer", "fraud"],
        "recipients": [
            {
                "name": "Alex Johnson",
                "phone": "+1-555-0100",
                "email": "alex@example.com",
            }
        ],
        "created_at": created_at,
    }
    store["campaigns"][campaign_id] = campaign

    transcript = [
        {"role": "user", "content": "I want to cancel because this feels confusing."},
        {
            "role": "assistant",
            "content": "I hear you. I can escalate this to a specialist right now.",
        },
    ]
    call = {
        "id": call_id,
        "campaign_id": campaign_id,
        "conversation_id": conversation_id,
        "status": "ended",
        "started_at": created_at,
        "ended_at": now_iso(),
        "transcript": transcript,
        "summary": "Recipient expressed confusion and asked to cancel. Agent offered specialist escalation.",
        "sentiment_score": 2,
        "detected_flags": ["cancel"],
        "recommended_action": "Escalate to a human operator within 15 minutes.",
        "escalation_id": escalation_id,
    }
    store["calls"][call_id] = call

    escalation = {
        "id": escalation_id,
        "call_id": call_id,
        "campaign_id": campaign_id,
        "priority": "high",
        "status": "open",
        "reason": "Detected escalation keywords: cancel",
        "detected_flags": ["cancel"],
        "created_at": now_iso(),
        "acknowledged_at": None,
    }
    store["escalations"][escalation_id] = escalation


seed_example_data()

def get_campaign(campaign_id: str):
    campaign = store["campaigns"].get(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign

def get_conversation(conversation_id: str): 
    conversation = store["conversations"].get(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation

def get_client_text(history: list[dict[str, str]]) -> str:
    return " ".join(d["content"] for d in history if d["role"] == "user")

# -----------------------------
# Routes
# -----------------------------

# okay
@app.get("/")
def read_root() -> dict[str, str]:
    return {"service": "PulseCall MVP API", "status": "ok"}

# okay
@app.post("/campaigns/create", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate) -> CampaignOut:
    campaign_id = f"cmp_{uuid4().hex[:10]}"
    campaign = {
        "id": campaign_id,
        **payload.model_dump(),
        "created_at": now_iso(),
    }
    store["campaigns"][campaign_id] = campaign
    return CampaignOut(**campaign)

# use Conversation model
@app.post("/campaigns/conversations/create")
def create_conversation(campaign_id: str):
    conversation_id = str(uuid4())
    started_at = now_iso()

    store["conversations"][conversation_id] = {
        "id": conversation_id,
        "campaign_id": campaign_id,
        "status": "active",
        "start_time": started_at,
        "end_time": None,
        "started_at": started_at,
        "ended_at": None,
        "history": [],
    }
    return store["conversations"][conversation_id]

@app.post("/campaigns/{campaign_id}/{conversation_id}")
def get_response(campaign_id: str, conversation_id: str, message: str):
    conversation = get_conversation(conversation_id)
    if conversation["campaign_id"] != campaign_id:
        raise HTTPException(status_code=400, detail="Conversation does not belong to campaign")
    if conversation["status"] != "active":
        raise HTTPException(status_code=400, detail="Conversation is inactive")

    campaign = store["campaigns"].get(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    history = conversation["history"]

    try:
        history.append({
            "role": "user",
            "content": message
        })

        response = respond(
            user_message=message,
            history=history,
            system_prompt=campaign["system_prompt"],
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Claude response generation failed unexpectedly")
    
    # Add Claude response to the history
    history.append({
        "role": "assistant",
        "content": response
    })

    store["conversations"][conversation_id]["history"] = history
    return response    

"""
class EndCallOut(BaseModel):
    call_id: str
    conversation_id: str
    campaign_id: str
    status: Literal["ended"]
    summary: str
    sentiment_score: int
    detected_flags: list[str]
    recommended_action: str
    escalation_id: str | None = None
"""

@app.post("/campaigns/{campaign_id}/{conversation_id}/end", response_model=EndCallOut)
def end_call(campaign_id: str, conversation_id: str) -> EndCallOut:
    conversation = get_conversation(conversation_id)
    if conversation["campaign_id"] != campaign_id:
        raise HTTPException(status_code=400, detail="Conversation does not belong to campaign")
    if conversation["status"] != "active":
        raise HTTPException(status_code=400, detail="Conversation already ended")

    ended_at = now_iso()
    conversation["status"] = "inactive"
    conversation["end_time"] = ended_at
    conversation["ended_at"] = ended_at
    campaign = store["campaigns"][conversation["campaign_id"]]
    history = conversation["history"]

    summary = summarize_transcript(history)
    full_text = get_client_text(history)

    # To be implemented later
    sentiment_score = sentiment_from_text(full_text)
    detected_flags = detect_flags(history, campaign["escalation_keywords"])
    recommended_action = recommended_action_for_flags(detected_flags)

    call_id = f"call_{uuid4().hex[:10]}"
    escalation_id: str | None = None

    if detected_flags:
        escalation_id = f"esc_{uuid4().hex[:10]}"
        escalation = {
            "id": escalation_id,
            "call_id": call_id,
            "campaign_id": campaign["id"],
            "priority": "high" if sentiment_score <= 2 else "medium",
            "status": "open",
            "reason": f"Detected escalation keywords: {', '.join(detected_flags)}",
            "detected_flags": detected_flags,
            "created_at": now_iso(),
            "acknowledged_at": None,
        }
        store["escalations"][escalation_id] = escalation

    call = {
        "call_id": call_id,
        "conversation_id": conversation_id,
        "campaign_id": campaign["id"],
        "status": "ended",
        "started_at": conversation["started_at"],
        "ended_at": conversation["ended_at"],
        "transcript": history,
        "summary": summary,
        "sentiment_score": sentiment_score,
        "detected_flags": detected_flags,
        "recommended_action": recommended_action,
        "escalation_id": escalation_id,
    }
    store["calls"][call_id] = call

    return EndCallOut(**call)


@app.get("/conversations")
def list_conversations() -> list[dict[str, Any]]:
    calls = list(store["conversations"].values())
    calls.sort(key=lambda c: c.get("ended_at", ""), reverse=True)
    return calls


@app.get("/escalations")
def list_escalations() -> list[dict[str, Any]]:
    priority_order = {"high": 0, "medium": 1, "low": 2}
    escalations = list(store["escalations"].values())
    escalations.sort(
        key=lambda e: (
            priority_order.get(e.get("priority", "low"), 3),
            e.get("created_at", ""),
        )
    )
    return escalations
