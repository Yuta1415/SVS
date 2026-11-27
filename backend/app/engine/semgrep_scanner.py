import json
import os
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

    # Language-to-ruleset mapping for targeted scanning
    LANGUAGE_RULESETS = {
        ".py": "p/python",
        ".js": "p/javascript",
        ".jsx": "p/javascript",
        ".ts": "p/typescript",
        ".tsx": "p/typescript",
        ".go": "p/go",
        ".java": "p/java",
        ".c": "p/c",
        ".cpp": "p/cpp",
        ".cc": "p/cpp",
        ".cxx": "p/cpp",
        ".rb": "p/ruby",
        ".php": "p/php",
        ".rs": "p/rust",
        ".kt": "p/kotlin",
        ".swift": "p/swift",
        ".scala": "p/scala",
        ".cs": "p/csharp",
    }

    def _detect_languages(self, project_path: str) -> list[str]:
        """Detect which language rulesets to use based on file extensions."""
        langs = set()
        for root, _, files in os.walk(project_path):
            if os.path.basename(root) in {".git", "node_modules", "vendor", "venv", ".venv", "__pycache__"}:
                continue
            for name in files:
                ext = os.path.splitext(name)[1].lower()
                ruleset = self.LANGUAGE_RULESETS.get(ext)
                if ruleset:
                    langs.add(ruleset)
        return sorted(langs)

    def scan(self, scan_id: int, project_path: str, db: Session):
        try:
            # Detect languages and use targeted rulesets instead of one broad
            # ruleset. Falls back to p/security-audit if no languages detected.
            langs = self._detect_languages(project_path)
            configs = [f"--config={rs}" for rs in langs] if langs else ["--config=p/security-audit"]

            output = self._run_command(
                "Semgrep",
                [
                    "semgrep", "scan", "--json",
                    "--metrics=off",
                    "--disable-version-check",
                    "--timeout=30",
                    "--exclude=tests/", "--exclude=test/",
                    "--exclude=node_modules/", "--exclude=vendor/",
                    "--exclude=*.min.js", "--exclude=*.generated.*",
                ] + configs + [project_path],
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
