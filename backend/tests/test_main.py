import asyncio
import importlib
import sys
import types
from typing import Any

import httpx
import pytest


@pytest.fixture()
def app_ctx(monkeypatch: pytest.MonkeyPatch):
    """Load main.py and patch main.respond to avoid real API calls."""
    calls: list[dict[str, Any]] = []

    def fake_respond(user_message: str, history: list[dict[str, str]], system_prompt: str) -> str:
        calls.append(
            {
                "user_message": user_message,
                "history": [dict(m) for m in history],
                "system_prompt": system_prompt,
            }
        )
        return f"mocked-reply:{user_message}"

    sys.modules.pop("main", None)
    sys.modules.pop("call_claude", None)

    main = importlib.import_module("main")
    monkeypatch.setattr(main, "respond", fake_respond)

    # Reset global in-memory state for test isolation.
    for bucket in main.store.values():
        bucket.clear()
    main.seed_example_data()

    return main, calls


def request(app, method: str, path: str, **kwargs) -> httpx.Response:
    async def _run() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(_run())


def make_campaign_payload(system_prompt: str = "Campaign prompt", keywords: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": "Test Campaign",
        "agent_persona": "Helpful support rep",
        "conversation_goal": "Understand issue and help",
        "system_prompt": system_prompt,
        "escalation_keywords": keywords or ["cancel"],
        "recipients": [
            {"name": "A", "phone": "+1-555-0001", "email": "a@example.com"},
            {"name": "B", "phone": "+1-555-0002", "email": "b@example.com"},
        ],
    }


def test_create_campaign_supports_recipient_list(app_ctx):
    main, _ = app_ctx

    response = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["id"].startswith("cmp_")
    assert isinstance(body["recipients"], list)
    assert len(body["recipients"]) == 2


def test_create_conversation_initializes_required_fields(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    response = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["campaign_id"] == campaign_id
    assert body["status"] == "active"
    assert body["start_time"]
    assert body["end_time"] is None
    assert body["history"] == []


def test_get_response_uses_campaign_system_prompt_and_updates_history(app_ctx):
    main, calls = app_ctx

    create_campaign = request(
        main.app,
        "POST",
        "/campaigns/create",
        json=make_campaign_payload(system_prompt="SYSTEM_PER_CAMPAIGN"),
    )
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "hello there"},
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "mocked-reply:hello there"}

    history = main.store["conversations"][conversation_id]["history"]
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"

    assert calls
    assert calls[-1]["system_prompt"] == "SYSTEM_PER_CAMPAIGN"


def test_end_conversation_sets_inactive_and_end_time(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "I might cancel this"},
    )

    end_response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    assert end_response.status_code == 200
    body = end_response.json()
    assert body["conversation_id"] == conversation_id
    assert "cancel" in body["detected_flags"]

    stored = main.store["conversations"][conversation_id]
    assert stored["status"] == "inactive"
    assert stored["end_time"] is not None


def test_get_response_rejects_wrong_campaign_for_conversation(app_ctx):
    main, _ = app_ctx

    c1 = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    c2 = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_1 = c1.json()["id"]
    campaign_2 = c2.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_1},
    )
    conversation_id = create_conversation.json()["id"]

    response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_2}/{conversation_id}",
        json={"message": "hello"},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "CONVERSATION_CAMPAIGN_MISMATCH"
    assert body["error"]["message"] == "Conversation does not belong to campaign"
    assert body["error"]["resource_id"] == conversation_id


def test_list_conversations_returns_created_conversation(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "hello before ending"},
    )

    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    response = request(main.app, "GET", "/conversations")

    assert response.status_code == 200
    conversations = response.json()
    assert any(c.get("id") == conversation_id for c in conversations)


def test_get_campaigns_returns_list(app_ctx):
    main, _ = app_ctx

    request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    response = request(main.app, "GET", "/campaigns")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 2  # includes seeded demo campaign


def test_get_campaign_by_id_returns_detail(app_ctx):
    main, _ = app_ctx

    created = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = created.json()["id"]

    response = request(main.app, "GET", f"/campaigns/{campaign_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == campaign_id
    assert "recipients" in body


def test_get_campaign_by_id_returns_404_when_missing(app_ctx):
    main, _ = app_ctx

    response = request(main.app, "GET", "/campaigns/cmp_missing_404")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "CAMPAIGN_NOT_FOUND"
    assert body["error"]["message"] == "Campaign not found"
    assert body["error"]["resource_id"] == "cmp_missing_404"


def test_get_campaign_conversations_returns_only_target_campaign(app_ctx):
    main, _ = app_ctx

    c1 = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    c2 = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_1 = c1.json()["id"]
    campaign_2 = c2.json()["id"]

    conv1 = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_1},
    ).json()["id"]
    request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_2},
    )

    response = request(main.app, "GET", f"/campaigns/{campaign_1}/conversations")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["id"] == conv1
    assert body[0]["campaign_id"] == campaign_1


def test_get_campaign_conversations_returns_404_when_campaign_missing(app_ctx):
    main, _ = app_ctx

    response = request(main.app, "GET", "/campaigns/cmp_missing_404/conversations")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "CAMPAIGN_NOT_FOUND"
    assert body["error"]["message"] == "Campaign not found"
    assert body["error"]["resource_id"] == "cmp_missing_404"


def test_get_response_rejects_inactive_conversation_with_409(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "hello"},
    )
    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "second message"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "CONVERSATION_INACTIVE"
    assert body["error"]["resource_id"] == conversation_id


def test_end_conversation_rejects_inactive_with_409(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        json={"message": "hello"},
    )
    request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "CONVERSATION_INACTIVE"
    assert body["error"]["message"] == "Cannot end an inactive conversation"
    assert body["error"]["resource_id"] == conversation_id


def test_end_conversation_rejects_empty_history_with_422(app_ctx):
    main, _ = app_ctx

    create_campaign = request(main.app, "POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = request(
        main.app,
        "POST",
        "/campaigns/conversations/create",
        json={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    response = request(
        main.app,
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "EMPTY_CONVERSATION_HISTORY"
    assert body["error"]["resource_id"] == conversation_id
