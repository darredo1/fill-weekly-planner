#!/usr/bin/env python3
"""Fail on common secret and PII patterns in tracked text files and commit messages."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def pattern(parts: list[str]) -> re.Pattern[str]:
    return re.compile("".join(parts), re.IGNORECASE)


RULES = {
    "email address": pattern([r"[A-Z0-9._%+-]+", "@", r"[A-Z0-9.-]+", r"\.[A-Z]{2,}"]),
    "US phone number": pattern([r"(?:\+1[ .-]?)?", r"(?:\(?\d{3}\)?[ .-]?)", r"\d{3}[ .-]\d{4}"]),
    "Social Security number": pattern([r"\b\d{3}-\d{2}-\d{4}\b"]),
    "student-style identifier": pattern([r"\b[Nn]\d{8}\b"]),
    "private key": pattern(["-----BEGIN ", r"[A-Z ]+", "PRIVATE KEY-----"]),
    "GitHub token": pattern([r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"]),
}

# Non-personal, platform-generated addresses that legitimately appear in commit
# trailers (e.g. "Co-authored-by:" lines added by squash-merges) and normal git
# author metadata. These identify no individual and are not PII; CONTRIBUTING.md
# already carves out "GitHub account and normal Git author metadata" from the
# privacy rule, and Co-authored-by trailers referencing them are the same case.
EMAIL_ALLOWLIST = pattern([r"\bnoreply@anthropic\.com\b|\b[A-Z0-9._%+-]+@users\.noreply\.github\.com\b"])


def matches_email_rule(text: str) -> bool:
    for match in RULES["email address"].finditer(text):
        if not EMAIL_ALLOWLIST.fullmatch(match.group(0)):
            return True
    return False


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True)


def git_bytes(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def check_text(label: str, text: str) -> list[str]:
    findings = []
    for rule, expression in RULES.items():
        if rule == "email address":
            if matches_email_rule(text):
                findings.append(f"{label}: possible {rule}")
        elif expression.search(text):
            findings.append(f"{label}: possible {rule}")
    return findings


def scan_files() -> list[str]:
    findings = []
    for relative_path in git("ls-files", "--cached", "--others", "--exclude-standard").splitlines():
        path = ROOT / relative_path
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        findings.extend(check_text(relative_path, text))
    return findings


def scan_history() -> list[str]:
    findings = []
    records = git("log", "--format=%H%x00%B%x00").split("\x00")
    for index in range(0, len(records) - 1, 2):
        commit, message = records[index], records[index + 1]
        findings.extend(check_text(f"commit {commit[:12]}", message))
    for commit in git("rev-list", "--all").splitlines():
        for relative_path in git("ls-tree", "-r", "--name-only", commit).splitlines():
            try:
                text = git_bytes("show", f"{commit}:{relative_path}").decode("utf-8")
            except (subprocess.CalledProcessError, UnicodeDecodeError):
                continue
            findings.extend(check_text(f"history {commit[:12]}:{relative_path}", text))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="also inspect reachable commit messages and file contents")
    args = parser.parse_args()
    findings = scan_files()
    if args.history:
        findings.extend(scan_history())
    if findings:
        print("Privacy scan failed:", file=sys.stderr)
        print("\n".join(f"- {finding}" for finding in findings), file=sys.stderr)
        return 1
    print("Privacy scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
