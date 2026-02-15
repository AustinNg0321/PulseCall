from __future__ import annotations


def test_seeded_campaigns_are_listed(app_ctx, api_request):
    response = api_request("GET", "/campaigns")
    assert response.status_code == 200
    campaigns = response.json()
    assert len(campaigns) >= 3


def test_create_campaign_conversation_and_end_with_escalation(app_ctx, api_request):
    create_campaign = api_request(
        "POST",
        "/campaigns/create",
        json={
            "name": "Test Campaign",
            "agent_persona": "Agent",
            "conversation_goal": "Check recovery",
            "system_prompt": "Be concise",
            "escalation_keywords": ["chest pain", "bleeding"],
            "recipients": [{"name": "Pat", "phone": "+1-555-0100"}],
        },
    )
    assert create_campaign.status_code == 200
    campaign_id = create_campaign.json()["id"]

    create_conversation = api_request(
        "POST",
        "/campaigns/conversations/create",
        params={"campaign_id": campaign_id},
    )
    assert create_conversation.status_code == 200
    conversation_id = create_conversation.json()["id"]

    turn = api_request(
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        params={"message": "I have chest pain today"},
    )
    assert turn.status_code == 200
    assert turn.json().startswith("mocked-reply:")

    end = api_request("POST", f"/campaigns/{campaign_id}/{conversation_id}/end")
    assert end.status_code == 200
    payload = end.json()
    assert payload["status"] == "ended"
    assert "chest pain" in payload["detected_flags"]
    assert payload["escalation_id"] is not None

    escalations = api_request("GET", "/escalations")
    assert escalations.status_code == 200
    assert any(e["id"] == payload["escalation_id"] for e in escalations.json())


def test_acknowledge_escalation(app_ctx, api_request):
    # Use seeded escalation by creating one through call end.
    campaign_id = next(iter(app_ctx.store["campaigns"]))
    conv = api_request("POST", "/campaigns/conversations/create", params={"campaign_id": campaign_id}).json()
    conversation_id = conv["id"]

    api_request(
        "POST",
        f"/campaigns/{campaign_id}/{conversation_id}",
        params={"message": "Emergency and chest pain"},
    )
    ended = api_request("POST", f"/campaigns/{campaign_id}/{conversation_id}/end").json()
    escalation_id = ended["escalation_id"]

    ack = api_request("PATCH", f"/escalations/{escalation_id}/acknowledge")
    assert ack.status_code == 200
    body = ack.json()
    assert body["status"] == "acknowledged"
    assert body["acknowledged_at"] is not None
