from __future__ import annotations

from database import CallRecord
from models import CallState


def test_create_and_list_users(api_request):
    create_user = api_request(
        "POST",
        "/users",
        json={"name": "Alex", "phone": "+1-555-1111", "campaign_id": "cmp_demo_001"},
    )
    assert create_user.status_code == 200
    user_id = create_user.json()["id"]

    listed = api_request("GET", "/users")
    assert listed.status_code == 200
    users = listed.json()
    assert any(u["id"] == user_id for u in users)


def test_trigger_outbound_call_success(app_ctx, api_request, monkeypatch):
    created = api_request(
        "POST",
        "/users",
        json={"name": "Alex", "phone": "+1-555-1111", "campaign_id": "cmp_demo_001"},
    ).json()

    async def fake_place_outbound_call(payload):
        return "smallest_call_123"

    monkeypatch.setattr(app_ctx, "place_outbound_call", fake_place_outbound_call)

    response = api_request(
        "POST",
        "/calls/outbound",
        params={"user_id": created["id"], "campaign_id": "cmp_demo_001"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "call_placed"
    assert body["smallest_call_id"] == "smallest_call_123"


def test_trigger_outbound_call_failure_sets_busy_retry(app_ctx, api_request, monkeypatch):
    created = api_request(
        "POST",
        "/users",
        json={"name": "Jamie", "phone": "+1-555-2222", "campaign_id": "cmp_demo_001"},
    ).json()

    async def fake_place_outbound_call(payload):
        return None

    monkeypatch.setattr(app_ctx, "place_outbound_call", fake_place_outbound_call)

    response = api_request("POST", "/calls/outbound", params={"user_id": created["id"]})
    assert response.status_code == 502

    db = app_ctx.SessionLocal()
    try:
        latest = db.query(CallRecord).filter(CallRecord.user_id == created["id"]).order_by(CallRecord.created_at.desc()).first()
        assert latest is not None
        assert latest.state == CallState.BUSY_RETRY
    finally:
        db.close()


def test_call_history_returns_db_records(app_ctx, api_request):
    created = api_request(
        "POST",
        "/users",
        json={"name": "Morgan", "phone": "+1-555-3333", "campaign_id": "cmp_demo_001"},
    ).json()

    db = app_ctx.SessionLocal()
    try:
        rec = CallRecord(
            id="call_hist_001",
            user_id=created["id"],
            campaign_id="cmp_demo_001",
            state=CallState.COMPLETED,
            summary="Recovered well",
            sentiment_score=4,
        )
        db.add(rec)
        db.commit()
    finally:
        db.close()

    history = api_request("GET", f"/call-history/{created['id']}")
    assert history.status_code == 200
    rows = history.json()
    assert len(rows) >= 1
    assert rows[0]["user_id"] == created["id"]
