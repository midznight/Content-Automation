"""CLI Admin for Hub agent management."""

import argparse
import sys
from typing import NoReturn

from sqlalchemy import select

from hub.auth import generate_agent_key, hash_key
from hub.db import session as db_session
from hub.db.models import Agent, Event

VALID_ROLES = {
    "pm",
    "ceo",
    "strategist",
    "fact_checker",
    "animator",
    "animator_backup",
    "analyst",
    "social",
}


def create_agent(name: str, role: str, vendor: str = "manual") -> None:
    """Create a new agent, hash its key, and display raw key once."""
    if role not in VALID_ROLES:
        print(f"Galat: Role '{role}' tidak valid. Role yang sah: {', '.join(sorted(VALID_ROLES))}")
        sys.exit(1)

    db_session.init_db()
    with db_session.SessionLocal() as db:
        existing = db.scalar(select(Agent).where(Agent.name == name))
        if existing:
            print(f"Galat: Agen dengan nama '{name}' sudah ada.")
            sys.exit(1)

        raw_key = generate_agent_key()
        digest = hash_key(raw_key)

        agent = Agent(
            name=name,
            role=role,
            vendor=vendor,
            key_hash=digest,
            active=True,
        )
        db.add(agent)

        event = Event(
            actor="admin",
            action="create_agent",
            detail={"name": name, "role": role, "vendor": vendor},
        )
        db.add(event)
        db.commit()

        print(f"Agen '{name}' ({role}, vendor={vendor}) berhasil dibuat.")
        print("PERINGATAN: Kunci hanya ditampilkan sekali. Simpan di tempat aman:")
        print(raw_key)


def revoke_agent(name: str) -> None:
    """Deactivate an agent by name."""
    db_session.init_db()
    with db_session.SessionLocal() as db:
        agent = db.scalar(select(Agent).where(Agent.name == name))
        if not agent:
            print(f"Galat: Agen '{name}' tidak ditemukan.")
            sys.exit(1)

        agent.active = False
        event = Event(
            actor="admin",
            action="revoke_agent",
            detail={"name": name, "agent_id": agent.id},
        )
        db.add(event)
        db.commit()
        print(f"Akses untuk agen '{name}' berhasil dicabut.")


def rotate_key(name: str) -> None:
    """Rotate an agent's API key and display new raw key once."""
    db_session.init_db()
    with db_session.SessionLocal() as db:
        agent = db.scalar(select(Agent).where(Agent.name == name))
        if not agent:
            print(f"Galat: Agen '{name}' tidak ditemukan.")
            sys.exit(1)

        raw_key = generate_agent_key()
        agent.key_hash = hash_key(raw_key)
        agent.active = True

        event = Event(
            actor="admin",
            action="rotate_key",
            detail={"name": name, "agent_id": agent.id},
        )
        db.add(event)
        db.commit()

        print(f"Kunci untuk agen '{name}' berhasil dirotasi.")
        print("PERINGATAN: Kunci baru hanya ditampilkan sekali. Simpan sekarang:")
        print(raw_key)


def list_agents() -> None:
    """List all agents without revealing keys or key hashes."""
    db_session.init_db()
    with db_session.SessionLocal() as db:
        agents = db.scalars(select(Agent).order_by(Agent.name)).all()
        if not agents:
            print("Belum ada agen yang terdaftar.")
            return

        header = f"{'Nama':<20} {'Role':<18} {'Vendor':<10} {'Status':<8} {'Terakhir Aktif'}"
        print(header)
        print("-" * len(header))
        for ag in agents:
            status = "Aktif" if ag.active else "Nonaktif"
            last_seen = ag.last_seen_at.isoformat() if ag.last_seen_at else "-"
            print(f"{ag.name:<20} {ag.role:<18} {ag.vendor:<10} {status:<8} {last_seen}")


def main() -> NoReturn:
    parser = argparse.ArgumentParser(description="CLI Admin Hub MCP Multi-Agen")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # create-agent
    p_create = subparsers.add_parser("create-agent", help="Buat agen baru")
    p_create.add_argument("name", help="Nama unik agen")
    p_create.add_argument("role", help="Role agen (ceo, strategist, dll)")
    p_create.add_argument("--vendor", default="manual", help="Vendor agen (cue, muse, manual)")

    # revoke-agent
    p_revoke = subparsers.add_parser("revoke-agent", help="Cabut akses agen")
    p_revoke.add_argument("name", help="Nama agen yang akan dicabut")

    # rotate-key
    p_rotate = subparsers.add_parser("rotate-key", help="Rotasi kunci API agen")
    p_rotate.add_argument("name", help="Nama agen")

    # list-agents
    subparsers.add_parser("list-agents", help="Daftar semua agen")

    args = parser.parse_args()

    if args.command == "create-agent":
        create_agent(args.name, args.role, args.vendor)
    elif args.command == "revoke-agent":
        revoke_agent(args.name)
    elif args.command == "rotate-key":
        rotate_key(args.name)
    elif args.command == "list-agents":
        list_agents()

    sys.exit(0)


if __name__ == "__main__":
    main()
