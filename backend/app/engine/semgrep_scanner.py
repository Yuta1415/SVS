import json
import re

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer
from ..models.scan import Scan


class SemgrepScanner(BaseScanner):
    @staticmethod
    def _format_warnings(project_path: str, warnings: list[dict]) -> str:
        details = []
        github_workflow_warnings = {}
        for warning in warnings:
            path = BaseScanner._repo_relative_path(project_path, warning.get("path"))
            message = warning.get("message") or warning.get("type") or "scan warning"
            normalized_path = path.replace("\\", "/").lower()

            if (
                ".github/workflows/" in normalized_path
                and "when parsing a snippet as bash" in message.lower()
                and "${{" in message
            ):
                grouped = github_workflow_warnings.setdefault(
                    path, {"rules": set(), "lines": set()}
                )
                grouped["rules"].update(re.findall(r"rule '([^']+)'", message))
                grouped["lines"].update(re.findall(r":(\d+):", message))
                continue

            message = message.replace(project_path, ".")
            details.append(f"{warning.get('type', 'warning')} in {path}: {message}")

        for path, grouped in sorted(github_workflow_warnings.items()):
            rules = grouped["rules"]
            rule_list = ", ".join(sorted(rules)) if rules else "GitHub Actions shell rules"
            line_list = ", ".join(sorted(grouped["lines"], key=int))
            location = f" (line {line_list})" if line_list else ""
            details.append(
                f"Semgrep's embedded-Bash parser could not handle GitHub Actions expressions "
                f"in {path}{location} ({rule_list}); those checks may be incomplete. "
                "This is not a GitHub Actions workflow syntax error."
            )

        if len(details) > 5:
            details = details[:5] + [f"{len(details) - 5} additional Semgrep warnings omitted"]
        return " | ".join(details)[:2000]

    def scan(self, scan_id: int, project_path: str, db: Session):
        try:
            # p/default is a pinned registry ruleset: it downloads once, is
            # cached locally, and needs no semgrep.dev login (unlike
            # --config=auto, which returns empty rules without auth). Metrics
            # telemetry does not include scanned code, which stays on the host,
            # but turning it off keeps that promise explicit.
            output = self._run_command(
                "Semgrep",
                [
                    "semgrep", "scan", "--json",
                    "--config=p/default", "--metrics=off",
                    "--disable-version-check",
                    "--timeout=30",
                    "--exclude=tests/", "--exclude=test/",
                    "--exclude=node_modules/", "--exclude=vendor/",
                    "--exclude=*.min.js", "--exclude=*.generated.*",
                    project_path,
                ],
                timeout=1800,  # 30 minutes for slow repos
                accept_exit_codes=(0, 1),
            )

            data = json.loads(output)
            errors = data.get("errors") or []
            warnings = [error for error in errors if error.get("level") == "warn"]
            blocking_errors = [error for error in errors if error.get("level") != "warn"]
            if blocking_errors:
                raise ScannerError("Semgrep", f"reported scan errors: {blocking_errors[0]}")
            results = data.get("results", [])
            norm = FindingNormalizer()

            for res in results:
                result = dict(res)
                result["path"] = self._repo_relative_path(project_path, result.get("path"))
                normalized = norm.normalize_semgrep(result)
                self._save_finding(
                    db, scan_id,
                    **normalized
                )

            if warnings:
                scan = db.query(Scan).filter(Scan.id == scan_id).first()
                if scan:
                    scan.warning_detail = self._format_warnings(project_path, warnings)

            db.commit()
            return len(results)
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("Semgrep", str(e)) from e
