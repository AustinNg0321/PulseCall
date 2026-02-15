from __future__ import annotations

from typing import Any


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


def test_create_campaign_supports_recipient_list(api_request):
    response = api_request("POST", "/campaigns/create", json=make_campaign_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["id"].startswith("cmp_")
    assert isinstance(body["recipients"], list)
    assert len(body["recipients"]) == 2


def test_create_conversation_initializes_required_fields(api_request):
    create_campaign = api_request("POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    response = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["campaign_id"] == campaign_id
    assert body["status"] == "active"
    assert body["start_time"]
    assert body["end_time"] is None
    assert body["history"] == []


def test_get_response_updates_history(app_ctx, api_request):
    create_campaign = api_request(
        "POST",
        "/campaigns/create",
        json=make_campaign_payload(system_prompt="SYSTEM_PER_CAMPAIGN"),
    )
    campaign_id = create_campaign.json()["id"]

    create_conversation = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    response = api_request(
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        params={"message": "hello there"},
    )

    assert response.status_code == 200
    assert response.json() == "mocked-reply:hello there"

    history = app_ctx.store["conversations"][conversation_id]["history"]
    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"


def test_end_call_sets_inactive_and_end_time(app_ctx, api_request):
    create_campaign = api_request("POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    api_request(
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        params={"message": "I might cancel this"},
    )

    end_response = api_request(
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}/end",
    )

    assert end_response.status_code == 200
    body = end_response.json()
    assert body["conversation_id"] == conversation_id
    assert "cancel" in body["detected_flags"]

    stored = app_ctx.store["conversations"][conversation_id]
    assert stored["status"] == "inactive"
    assert stored["end_time"] is not None


def test_get_response_rejects_wrong_campaign_for_conversation(api_request):
    c1 = api_request("POST", "/campaigns/create", json=make_campaign_payload())
    c2 = api_request("POST", "/campaigns/create", json=make_campaign_payload())
    campaign_1 = c1.json()["id"]
    campaign_2 = c2.json()["id"]

    create_conversation = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_1},
    )
    conversation_id = create_conversation.json()["id"]

    response = api_request(
        "POST",
        f"/campaigns/{campaign_2}/{conversation_id}",
        params={"message": "hello"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Conversation does not belong to campaign"


def test_list_conversations_returns_created_conversation(api_request):
    create_campaign = api_request("POST", "/campaigns/create", json=make_campaign_payload())
    campaign_id = create_campaign.json()["id"]

    create_conversation = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_id},
    )
    conversation_id = create_conversation.json()["id"]

    response = api_request("GET", "/conversations")

    assert response.status_code == 200
    conversations = response.json()
    assert any(c.get("id") == conversation_id for c in conversations)
