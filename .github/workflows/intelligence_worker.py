
"""
StayLive Intelligence Worker
Processes hotel safety reports with anomaly detection, risk scoring, and automated alerts.
"""

import os
from datetime import datetime, timedelta
from collections import defaultdict
import math
from supabase import create_client, Client

# Configuration - read from environment variables
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Scoring constants
CRITICAL_POINTS = 30
WARNING_POINTS = 10
RISK_THRESHOLD = 50
DECAY_HALF_LIFE_HOURS = 12
ANOMALY_WINDOW_SECONDS = 60


def init_supabase() -> Client:
    """Initialize Supabase client with service_role key to bypass RLS."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERROR] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        raise SystemExit(1)
    print("[INFO] Service-role client initialized (RLS bypassed)")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def calculate_time_decay(report_time: datetime) -> float:
    """
    Calculate time decay factor using exponential decay with 12-hour half-life.

    Args:
        report_time: Timestamp of the report

    Returns:
        Decay factor (0.0 to 1.0)
    """
    now = datetime.utcnow()
    if report_time.tzinfo:
        from datetime import timezone
        now = datetime.now(timezone.utc)

    hours_elapsed = (now - report_time).total_seconds() / 3600
    decay_factor = math.pow(0.5, hours_elapsed / DECAY_HALF_LIFE_HOURS)
    return decay_factor


def detect_anomalies(reports: list) -> set:
    """
    Detect anomalous reports from same reporter within 60 seconds.

    Args:
        reports: List of report records

    Returns:
        Set of report IDs to exclude as anomalies
    """
    reporter_timeline = defaultdict(list)
    anomalies = set()

    # Group reports by reporter_id with timestamps
    for report in reports:
        reporter_id = report.get('reporter_id')
        report_id = report.get('id')
        created_at = report.get('created_at')

        if not all([reporter_id, report_id, created_at]):
            continue

        # Parse timestamp
        if isinstance(created_at, str):
            timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        else:
            timestamp = created_at

        reporter_timeline[reporter_id].append((report_id, timestamp))

    # Check for reports within 60-second window
    for reporter_id, timeline in reporter_timeline.items():
        timeline.sort(key=lambda x: x[1])

        for i in range(len(timeline) - 1):
            current_id, current_time = timeline[i]
            next_id, next_time = timeline[i + 1]

            time_diff = (next_time - current_time).total_seconds()

            if time_diff <= ANOMALY_WINDOW_SECONDS:
                # Flag the later report as anomaly
                anomalies.add(next_id)

    return anomalies


def calculate_hotel_risk_scores(reports: list, anomalies: set) -> dict:
    """
    Calculate risk scores for each hotel with time decay.

    Args:
        reports: List of report records
        anomalies: Set of anomalous report IDs to exclude

    Returns:
        Dictionary mapping hotel_id to risk score
    """
    hotel_scores = defaultdict(float)
    hotel_report_counts = defaultdict(int)

    for report in reports:
        report_id = report.get('id')
        hotel_id = report.get('hotel_id')
        severity = report.get('severity', '').upper()
        created_at = report.get('created_at')

        # Skip anomalies
        if report_id in anomalies:
            continue

        if not all([hotel_id, severity, created_at]):
            continue

        # Parse timestamp
        if isinstance(created_at, str):
            timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        else:
            timestamp = created_at

        # Calculate base score
        if severity == 'CRITICAL':
            base_score = CRITICAL_POINTS
        elif severity == 'WARNING':
            base_score = WARNING_POINTS
        else:
            continue

        # Apply time decay
        decay_factor = calculate_time_decay(timestamp)
        weighted_score = base_score * decay_factor

        hotel_scores[hotel_id] += weighted_score
        hotel_report_counts[hotel_id] += 1

    return dict(hotel_scores)


def update_hotel_statuses(supabase: Client, hotel_scores: dict) -> int:
    """
    Update hotel_status table for hotels exceeding risk threshold.

    Args:
        supabase: Supabase client
        hotel_scores: Dictionary of hotel_id to risk scores

    Returns:
        Number of hotels updated to ALERT status
    """
    alert_count = 0

    for hotel_id, risk_score in hotel_scores.items():
        if risk_score > RISK_THRESHOLD:
            try:
                supabase.table('hotel_status').upsert({
                    'hotel_id': hotel_id,
                    'status': 'ALERT',
                    'risk_score': round(risk_score, 2),
                    'updated_at': datetime.utcnow().isoformat()
                }).execute()
                alert_count += 1
            except Exception as e:
                print(f"[ERROR] Failed to update hotel {hotel_id}: {e}")

    return alert_count


def run_intelligence_worker():
    """Main execution logic for intelligence worker."""
    print("=" * 60)
    print("StayLive Intelligence Worker - Starting Analysis")
    print("=" * 60)

    # Initialize client
    supabase = init_supabase()

    # Fetch recent reports
    print("\n[1/5] Fetching reports from database...")
    try:
        response = supabase.table('reports').select('*').order('created_at', desc=True).execute()
        reports = response.data
        print(f"      → Retrieved {len(reports)} reports")
    except Exception as e:
        print(f"[ERROR] Failed to fetch reports: {e}")
        return

    # Anomaly detection
    print("\n[2/5] Running anomaly detection...")
    anomalies = detect_anomalies(reports)
    print(f"      → Detected {len(anomalies)} anomalous reports")
    if anomalies:
        print(f"      → Excluded report IDs: {sorted(anomalies)}")

    # Calculate risk scores
    print("\n[3/5] Calculating hotel risk scores...")
    hotel_scores = calculate_hotel_risk_scores(reports, anomalies)
    print(f"      → Analyzed {len(hotel_scores)} unique hotels")

    # Update statuses
    print("\n[4/5] Updating hotel statuses...")
    alert_count = update_hotel_statuses(supabase, hotel_scores)
    print(f"      → Updated {alert_count} hotels to ALERT status")

    # Structured logging
    print("\n[5/5] Risk Score Summary:")
    print("-" * 60)
    print(f"{'Hotel ID':<15} {'Risk Score':<12} {'Status':<10}")
    print("-" * 60)

    # Sort hotels by risk score (descending)
    sorted_hotels = sorted(hotel_scores.items(), key=lambda x: x[1], reverse=True)

    for hotel_id, risk_score in sorted_hotels:
        status = "ALERT" if risk_score > RISK_THRESHOLD else "OK"
        print(f"{str(hotel_id):<15} {risk_score:>10.2f}  {status:<10}")

    print("-" * 60)
    print(f"\nAnalysis complete. {alert_count}/{len(hotel_scores)} hotels in ALERT status.")
    print("=" * 60)


if __name__ == "__main__":
    run_intelligence_worker()
