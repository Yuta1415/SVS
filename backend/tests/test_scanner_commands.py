import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.engine.base_scanner import ScannerError
from app.engine.dependency_scanner import DependencyScanner
from app.engine.semgrep_scanner import SemgrepScanner


def test_local_command_runner_returns_stdout():
    output = SemgrepScanner()._run_command(
        "Semgrep",
        [sys.executable, "-c", "print('report')"],
    )

    assert output == "report"


def test_local_command_runner_reports_exit_details():
    with pytest.raises(ScannerError, match="exited 7: scanner failed"):
        SemgrepScanner()._run_command(
            "Semgrep",
            [sys.executable, "-c", "import sys; sys.stderr.write('scanner failed'); sys.exit(7)"],
        )


def test_local_command_runner_preserves_errors_on_report_exit_codes():
    with pytest.raises(ScannerError, match="404 File not found"):
        SemgrepScanner()._run_command(
            "SCA Audit",
            [sys.executable, "-c", "import sys; sys.stderr.write('404 File not found'); sys.exit(1)"],
            accept_exit_codes=(0, 1),
        )


def test_semgrep_keeps_findings_and_records_parser_warnings(monkeypatch):
    scanner = SemgrepScanner()
    scan = SimpleNamespace(warning_detail=None)
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = scan
    result = {
        "errors": [{
            "level": "warn",
            "type": "Syntax error",
            "path": r"C:\repo\config\sections.json",
            "message": r"Syntax error in C:\repo\config\sections.json: `export` was unexpected",
        }],
        "results": [{
            "check_id": "test.rule",
            "path": r"C:\repo\src\app.py",
            "start": {"line": 4},
            "extra": {"severity": "WARNING", "message": "test finding"},
        }],
    }
    monkeypatch.setattr(scanner, "_run_command", lambda *args, **kwargs: json.dumps(result))
    monkeypatch.setattr(scanner, "_save_finding", Mock())

    assert scanner.scan(1, r"C:\repo", db) == 1
    assert "Syntax error in config\\sections.json" in scan.warning_detail
    assert "`export` was unexpected" in scan.warning_detail
    assert r"C:\repo" not in scan.warning_detail
    scanner._save_finding.assert_called_once()
    db.commit.assert_called_once()


def test_semgrep_still_fails_on_non_warning_report_errors(monkeypatch):
    scanner = SemgrepScanner()
    result = {"errors": [{"level": "error", "message": "invalid Semgrep configuration"}]}
    monkeypatch.setattr(scanner, "_run_command", lambda *args, **kwargs: json.dumps(result))

    with pytest.raises(ScannerError, match="invalid Semgrep configuration"):
        scanner.scan(1, r"C:\repo", Mock())


def test_semgrep_summarizes_github_expression_parser_warnings():
    message = (
        "When parsing a snippet as Bash for metavariable-pattern in rule "
        "'yaml.github-actions.security.curl-eval.curl-eval', `${{` was unexpected"
    )
    warnings = [
        {
            "type": "Syntax error",
            "path": r"C:\repo\.github\workflows\test.yml",
            "message": r"Syntax error at .github\workflows\test.yml:83:" + "\n" + message,
        },
        {
            "type": "Syntax error",
            "path": r"C:\repo\.github\workflows\test.yml",
            "message": r"Syntax error at .github\workflows\test.yml:83:" + "\n" + message.replace(
                "yaml.github-actions.security.curl-eval.curl-eval",
                "yaml.github-actions.security.gha-curl-pipe-shell.gha-curl-pipe-shell",
            ),
        },
    ]

    detail = SemgrepScanner._format_warnings(r"C:\repo", warnings)
    normalized_detail = detail.replace("\\", "/")

    assert normalized_detail.count(".github/workflows/test.yml") == 1
    assert "GitHub Actions expressions" in normalized_detail
    assert "line 83" in normalized_detail
    assert "embedded-Bash" in normalized_detail
    assert "curl-eval" in normalized_detail
    assert "gha-curl-pipe-shell" in normalized_detail
    assert "checks may be incomplete" in normalized_detail
    assert "not a GitHub Actions workflow syntax error" in normalized_detail
    assert "C:\\repo" not in detail
    assert "was unexpected" not in detail


def test_dependency_scanner_discovers_nested_manifests(tmp_path, monkeypatch):
    project = tmp_path / "deepseek-harness-master"
    python_manifest = project / "backend" / "requirements.txt"
    javascript_manifest = project / "frontend" / "package.json"
    python_manifest.parent.mkdir(parents=True)
    javascript_manifest.parent.mkdir(parents=True)
    python_manifest.write_text("example==1.0\n", encoding="utf-8")
    javascript_manifest.write_text(json.dumps({"name": "example"}), encoding="utf-8")
    (project / "node_modules" / "nested").mkdir(parents=True)
    (project / "node_modules" / "nested" / "package.json").write_text("{}", encoding="utf-8")

    seen = []
    scanner = DependencyScanner()
    monkeypatch.setattr(
        scanner, "_scan_python",
        lambda scan_id, manifest, root, db: seen.append(("python", manifest)) or 1,
    )
    monkeypatch.setattr(
        scanner, "_scan_javascript",
        lambda scan_id, manifest, root, db: seen.append(("javascript", manifest)) or 1,
    )

    assert scanner.scan(1, os.fspath(project), None) == 2
    assert ("python", os.fspath(python_manifest)) in seen
    assert ("javascript", os.fspath(javascript_manifest)) in seen
    assert all("node_modules" not in path for _, path in seen)
