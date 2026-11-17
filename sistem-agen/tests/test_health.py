"""Tests for /health endpoint."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from hub.main import app


def test_health_success():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["database"] == "healthy"


def test_health_db_failure():
    with TestClient(app) as client:
        with patch("hub.db.session.SessionLocal") as mock_session_cls:
            mock_session = mock_session_cls.return_value.__enter__.return_value
            mock_session.execute.side_effect = Exception("Database connection failure")

            res = client.get("/health")
            assert res.status_code == 503
            data = res.json()
            assert data["status"] == "error"
            assert "Database connection failure" in data["database"]
