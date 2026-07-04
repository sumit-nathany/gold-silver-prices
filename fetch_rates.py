#!/usr/bin/env python3
"""
Fetch IBJA gold/silver rates and upsert into data/<year>.csv.

Columns: date, gold_999_am, gold_999_pm, silver_999_am, silver_999_pm, reason
Units  : gold per 10g INR (ex-GST), silver per 1kg INR (ex-GST)
reason : empty for trading days; "SAT", "SUN", or "Market Holiday" otherwise
"""

import csv
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from io import BytesIO
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("pdfplumber is required: pip install pdfplumber")


BASE_URL = "https://ibjarates.com"
INDEX_URL = f"{BASE_URL}/"
DATA_DIR = Path(__file__).parent / "data"

# Columns we care about (0-indexed positions in the PDF table, after header rows)
# PDF columns: Date, Gold999AM, Gold999PM, Gold995AM, Gold995PM, Gold916AM, Gold916PM,
#              Gold750AM, Gold750PM, Gold585AM, Gold585PM, Silver999AM, Silver999PM
COL_DATE = 0
COL_GOLD_AM = 1
COL_GOLD_PM = 2
COL_SILVER_AM = 11
COL_SILVER_PM = 12


def discover_pdf_url() -> str:
    """Scrape the index page to find the current 30-day PDF URL."""
    with urllib.request.urlopen(INDEX_URL, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    match = re.search(
        r'["\']([^"\']*UploadedFiles/30DaysPdf/[^"\']+\.pdf)["\']',
        html,
        re.IGNORECASE,
    )
    if not match:
        sys.exit("Could not find 30-day PDF link on ibjarates.com")

    path = match.group(1)
    if path.startswith("http"):
        return path
    path = path.lstrip("./")
    return f"{BASE_URL}/{path}"


def download_pdf(url: str) -> bytes:
    # Encode spaces and non-ASCII in the path while preserving the scheme/host
    parsed = urllib.parse.urlsplit(url)
    safe_path = urllib.parse.quote(parsed.path)
    safe_url = urllib.parse.urlunsplit(parsed._replace(path=safe_path))
    req = urllib.request.Request(safe_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse_iso_date(raw: str):
    """Convert '25-Jun-26' → '2026-06-25', or None if unparseable."""
    raw = raw.strip()
    try:
        return datetime.strptime(raw, "%d-%b-%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def non_trading_reason(marker: str):
    """Return reason string if marker indicates a non-trading day, else None."""
    m = marker.strip().upper()
    if m == "SAT":
        return "SAT"
    if m == "SUN":
        return "SUN"
    if "HOLIDAY" in m:
        return "Market Holiday"
    return None


def parse_pdf(data: bytes) -> list[dict]:
    """Return list of {date, gold_999_am, gold_999_pm, silver_999_am, silver_999_pm, reason}."""
    rows = []
    seen_dates = set()
    with pdfplumber.open(BytesIO(data)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or row[COL_DATE] is None:
                        continue
                    iso = parse_iso_date(str(row[COL_DATE]))
                    if iso is None or iso in seen_dates:
                        continue
                    seen_dates.add(iso)

                    # The gold AM cell holds the non-trading marker (SAT/SUN/Holiday)
                    reason = non_trading_reason(str(row[COL_GOLD_AM] or ""))
                    if reason is not None:
                        rows.append({
                            "date": iso,
                            "gold_999_am": "",
                            "gold_999_pm": "",
                            "silver_999_am": "",
                            "silver_999_pm": "",
                            "reason": reason,
                        })
                    else:
                        try:
                            rows.append({
                                "date": iso,
                                "gold_999_am": int(str(row[COL_GOLD_AM]).replace(",", "")),
                                "gold_999_pm": int(str(row[COL_GOLD_PM]).replace(",", "")),
                                "silver_999_am": int(str(row[COL_SILVER_AM]).replace(",", "")),
                                "silver_999_pm": int(str(row[COL_SILVER_PM]).replace(",", "")),
                                "reason": "",
                            })
                        except (ValueError, TypeError, IndexError):
                            continue
    return rows


def load_existing_dates(csv_path: Path) -> set[str]:
    if not csv_path.exists():
        return set()
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        return {row["date"] for row in reader}


def upsert_rows(rows: list[dict]) -> int:
    """Write new rows into data/<year>.csv. Returns count of rows added."""
    by_year: dict[str, list[dict]] = {}
    for row in rows:
        year = row["date"][:4]
        by_year.setdefault(year, []).append(row)

    DATA_DIR.mkdir(exist_ok=True)
    added = 0

    for year, year_rows in sorted(by_year.items()):
        csv_path = DATA_DIR / f"{year}.csv"
        existing = load_existing_dates(csv_path)

        new_rows = sorted(
            [r for r in year_rows if r["date"] not in existing],
            key=lambda r: r["date"],
        )
        if not new_rows:
            continue

        fieldnames = ["date", "gold_999_am", "gold_999_pm", "silver_999_am", "silver_999_pm", "reason"]
        write_header = not csv_path.exists()
        with csv_path.open("a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if write_header:
                writer.writeheader()
            writer.writerows(new_rows)

        added += len(new_rows)
        print(f"  Added {len(new_rows)} rows to {csv_path.relative_to(Path(__file__).parent)}")

    return added


def git_commit_and_push(added: int):
    if added == 0:
        return
    repo = str(Path(__file__).parent)
    date = datetime.utcnow().strftime("%Y-%m-%d")
    # Works both locally (SSH remote) and in CI (checkout configures an
    # HTTPS-authenticated origin; HEAD:main pushes the current commit to main).
    subprocess.run(["git", "-C", repo, "add", "data/"], check=True)
    subprocess.run(
        ["git", "-C", repo, "commit", "-m", f"chore: add rates for {date}"],
        check=True,
    )
    subprocess.run(["git", "-C", repo, "push", "origin", "HEAD:main"], check=True)


def main():
    print("Discovering PDF URL...")
    url = discover_pdf_url()
    print(f"  → {url}")

    print("Downloading PDF...")
    data = download_pdf(url)
    print(f"  Downloaded {len(data):,} bytes")

    print("Parsing rates...")
    rows = parse_pdf(data)
    trading = sum(1 for r in rows if r["reason"] == "")
    print(f"  Found {len(rows)} days ({trading} trading, {len(rows) - trading} non-trading)")

    print("Upserting into CSV...")
    added = upsert_rows(rows)

    if added == 0:
        print("Nothing new to commit.")
    else:
        print(f"Committing {added} new rows...")
        git_commit_and_push(added)
        print("Done.")


if __name__ == "__main__":
    main()
