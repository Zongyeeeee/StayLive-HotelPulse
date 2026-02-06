
"""
StayLive Policy Enforcer
Single-pass enforcement script designed for scheduled CI execution.
Idempotent — safe to run on any cadence.
"""

import os
import sys
import logging
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from difflib import SequenceMatcher

from supabase import create_client, Client

# ── Configuration ────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

FLOOD_WINDOW_MINUTES = 10
MIN_DESCRIPTION_LENGTH = 5
SIMILARITY_THRESHOLD = 0.85

# ── Logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("guard")


# ── Helpers ──────────────────────────────────────────────────────────

def init_supabase() -> Client:
    """Initialize Supabase client with service_role key to bypass RLS."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        sys.exit(1)
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    log.info("Service-role client initialized (RLS bypassed)")
    return client


def parse_timestamp(raw: str | datetime) -> datetime:
    """Normalise a Supabase timestamp to an aware UTC datetime."""
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc)
        return raw
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def is_repetitive(text: str) -> bool:
    """Return True if *text* is built from a short repeating pattern."""
    s = text.strip().lower()
    length = len(s)
    if length == 0:
        return True
    for pattern_len in range(1, length // 2 + 1):
        pattern = s[:pattern_len]
        full_repeats = length // pattern_len
        if pattern * full_repeats == s[: pattern_len * full_repeats]:
            remaining = s[pattern_len * full_repeats :]
            if pattern.startswith(remaining):
                return True
    return False


def delete_rows(sb: Client, ids: list[int]) -> int:
    """Delete rows by id list; return count deleted."""
    if not ids:
        return 0
    deleted = 0
    for row_id in ids:
        try:
            sb.table("reports").delete().eq("id", row_id).execute()
            deleted += 1
        except Exception as exc:
            log.error("Delete id=%s failed: %s", row_id, exc)
    return deleted


def unverify_rows(sb: Client, ids: list[int]) -> int:
    """Set is_verified=false for given ids; return count updated."""
    if not ids:
        return 0
    updated = 0
    for row_id in ids:
        try:
            sb.table("reports").update({"is_verified": False}).eq("id", row_id).execute()
            updated += 1
        except Exception as exc:
            log.error("Unverify id=%s failed: %s", row_id, exc)
    return updated


# ── Policy modules ───────────────────────────────────────────────────

def enforce_anti_flood(sb: Client, reports: list) -> int:
    """Delete duplicate reports from the same reporter within a 10-min window.

    Keeps the earliest report per window; removes the rest.
    """
    by_reporter: dict[str, list[tuple[int, datetime]]] = defaultdict(list)

    for r in reports:
        rid = r.get("reporter_id")
        if rid is None:
            continue
        by_reporter[rid].append((r["id"], parse_timestamp(r["created_at"])))

    to_delete: list[int] = []

    for rid, entries in by_reporter.items():
        entries.sort(key=lambda x: x[1])
        _, anchor_ts = entries[0]

        for row_id, ts in entries[1:]:
            if (ts - anchor_ts) <= timedelta(minutes=FLOOD_WINDOW_MINUTES):
                to_delete.append(row_id)
            else:
                anchor_ts = ts

    count = delete_rows(sb, to_delete)
    log.info("Anti-Flood: deleted %d flood reports", count)
    return count


def enforce_quality_gate(sb: Client, reports: list) -> int:
    """Unverify reports with descriptions < 15 chars or repetitive gibberish."""
    to_unverify: list[int] = []

    for r in reports:
        if not r.get("is_verified", False):
            continue

        desc = (r.get("description") or "").strip()
        row_id = r["id"]

        if len(desc) < MIN_DESCRIPTION_LENGTH or is_repetitive(desc):
            to_unverify.append(row_id)

    count = unverify_rows(sb, to_unverify)
    log.info("Quality-Gate: flagged %d low-quality reports", count)
    return count


def detect_duplicates(sb: Client, reports: list) -> int:
    """Flag near-identical descriptions from different reporters as bot activity."""
    flagged: set[int] = set()
    items = [
        (r["id"], r.get("reporter_id"), (r.get("description") or "").strip().lower())
        for r in reports
        if (r.get("description") or "").strip()
    ]

    for i in range(len(items)):
        id_a, reporter_a, desc_a = items[i]
        if id_a in flagged:
            continue
        for j in range(i + 1, len(items)):
            id_b, reporter_b, desc_b = items[j]
            if reporter_a == reporter_b:
                continue
            if SequenceMatcher(None, desc_a, desc_b).ratio() >= SIMILARITY_THRESHOLD:
                flagged.add(id_a)
                flagged.add(id_b)
                log.warning(
                    "Duplicate-Detect: reporters %s & %s (ids %d, %d)",
                    reporter_a, reporter_b, id_a, id_b,
                )

    count = unverify_rows(sb, list(flagged))
    log.info("Duplicate-Detect: flagged %d suspected bot reports", count)
    return count


def auto_clean(sb: Client, reports: list) -> int:
    """Remove issue_key='other' entries with empty descriptions."""
    to_delete: list[int] = []

    for r in reports:
        if r.get("issue_key") != "other":
            continue
        desc = (r.get("description") or "").strip()
        if not desc:
            to_delete.append(r["id"])

    count = delete_rows(sb, to_delete)
    log.info("Auto-Cleaner: removed %d empty 'other' reports", count)
    return count


# ── Entry point ──────────────────────────────────────────────────────

def run() -> None:
    """Single-pass enforcement run."""
    log.info("── Policy Enforcer: run start ──")

    sb = init_supabase()

    try:
        response = sb.table("reports").select("*").order("created_at", desc=True).execute()
        reports = response.data or []
    except Exception as exc:
        log.error("Failed to fetch reports: %s", exc)
        sys.exit(1)

    log.info("Fetched %d reports", len(reports))

    if not reports:
        log.info("── run end (nothing to process) ──")
        return

    enforce_anti_flood(sb, reports)
    enforce_quality_gate(sb, reports)
    detect_duplicates(sb, reports)
    auto_clean(sb, reports)

    log.info("── Policy Enforcer: run complete ──")


if __name__ == "__main__":
    run()
