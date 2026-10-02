import re

# Remediation guidance keyed by weakness class. Tools are uneven about this:
# semgrep ships a rule name and a message but no fix text, and pip-audit only
# echoes the advisory description, so without this table a third of findings
# would tell the user nothing they can act on.
#
# ponytail: partial coverage by design. The classes below cover what the four
# scanners actually emit; anything else falls through to a Mitre link, which is
# still better than "Review Semgrep rule documentation." Add rows as real scans
# show gaps rather than importing the whole 1,400-entry CWE catalogue.
CWE_REMEDIATION = {
    "CWE-20": "Validate and sanitize all input at the boundary before use; reject anything that does not match the expected type, length and format.",
    "CWE-22": "Reject path traversal by resolving the path and confirming it stays inside the intended root directory.",
    "CWE-78": "Do not pass untrusted input to a shell. Use parameterised APIs or an argument list instead of a command string.",
    "CWE-79": "Encode output for the context it lands in (HTML, attribute, JavaScript) and never interpolate raw input into a template.",
    "CWE-89": "Use prepared statements with bound parameters for every query, including ones that only read.",
    "CWE-94": "Do not evaluate untrusted data as code. Move the logic into the application and treat the input as data.",
    "CWE-200": "Return the minimum information an operation needs and keep internal identifiers, paths and stack traces out of responses.",
    "CWE-209": "Do not leak implementation detail in error output; log it server-side and return a generic message to the client.",
    "CWE-269": "Drop privileges and run the component as the least-permitted user that still works.",
    "CWE-295": "Verify certificates and hostnames on every connection; do not disable or bypass certificate checks.",
    "CWE-319": "Use TLS for the transport and serve no content over plaintext.",
    "CWE-327": "Use a modern, unbroken algorithm and a library default, not a hand-rolled or legacy construction.",
    "CWE-338": "Use the platform's cryptographically secure generator for anything that must be unpredictable.",
    "CWE-352": "Require an unpredictable per-session anti-CSRF token and verify it on every state-changing request.",
    "CWE-400": "Bound the work an untrusted request can cause: cap input size, loop iterations and allocation before use.",
    "CWE-407": "Compare the full expected value with a constant-time check rather than short-circuiting on the first mismatch.",
    "CWE-502": "Do not deserialize untrusted data with a format that can reconstruct objects. Prefer a data-only format and validate the result.",
    "CWE-601": "Validate every redirect target against an allow-list of destinations; never redirect to a caller-supplied URL unchecked.",
    "CWE-611": "Disable external entity resolution in the XML parser before parsing untrusted documents.",
    "CWE-798": "Rotate the exposed credential now, store the replacement in a secret manager or environment variable, and never write it back to the repo.",
    "CWE-918": "Do not let a caller choose the destination of a server-side request; validate the scheme, host and port against an allow-list.",
    "CWE-1333": "ReDoS: bound the pattern or the input. Use a non-backtracking engine, reject nested quantifiers, or cap input length.",
}

# npm audit advisories carry "cwe": ["CWE-400", "CWE-1333"]. Semgrep rule
# metadata may hold a single string or a list, so this accepts either.
def _extract_cwe(value) -> str | None:
    if isinstance(value, (list, tuple)):
        ids = [v for v in value if isinstance(v, str) and re.fullmatch(r"CWE-\d+", v.strip())]
        return ids[0].strip() if ids else None
    if isinstance(value, str) and re.fullmatch(r"CWE-\d+", value.strip()):
        return value.strip()
    return None


class FindingNormalizer:
    """Normalizes findings from different security tools into a standard format."""

    # Semgrep reports ERROR/WARNING/INFO; SVS scores CRITICAL/HIGH/MEDIUM/LOW/INFO.
    # ponytail: map at this choke point so scoring, the findings API and the PDF
    # all see one vocabulary. Unknown values fall back to MEDIUM rather than
    # passing through and silently scoring zero.
    SEMGREP_SEVERITY = {"ERROR": "HIGH", "WARNING": "MEDIUM", "INFO": "INFO"}

    # npm audit reports "moderate", not "medium", so a raw upper() produced a
    # severity that WEIGHTS does not recognise and every moderate advisory
    # silently scored zero and counted toward nothing.
    NPM_SEVERITY = {
        "critical": "CRITICAL",
        "high": "HIGH",
        "moderate": "MEDIUM",
        "low": "LOW",
        "info": "INFO",
    }

    def _cwe_remediation(self, cwe: str, fallback: str) -> str:
        """Prefer weakness-class guidance over the tool's own one-liner.

        Falls through to the Mitre definition for a class this table does not
        cover, which keeps every finding actionable without importing the whole
        catalogue.
        """
        if not cwe:
            return fallback
        return CWE_REMEDIATION.get(
            cwe,
            f"{fallback} See {cwe}: https://cwe.mitre.org/data/definitions/{cwe.split('-')[1]}.html",
        )

    def normalize_semgrep(self, finding: dict) -> dict:
        raw = finding.get("extra", {}).get("severity", "WARNING").upper()
        # cwe in semgrep is rule-author metadata, not a schema guarantee, so a
        # rule that omits it still normalizes; remediation just falls back.
        cwe = _extract_cwe(finding.get("extra", {}).get("metadata", {}).get("cwe"))
        return {
            "v_type": finding.get("check_id", "Semgrep-Finding"),
            "severity": self.SEMGREP_SEVERITY.get(raw, "MEDIUM"),
            "file_path": finding.get("path", "unknown"),
            "line": finding.get("start", {}).get("line"),
            "desc": finding.get("extra", {}).get("message", "No description provided"),
            "cwe": cwe,
            "remediation": self._cwe_remediation(
                cwe, finding.get("extra", {}).get("remediation", "Review the Semgrep rule documentation for this check.")
            ),
        }

    def normalize_gitleaks(self, finding: dict) -> dict:
        # CWE-798 is the class for a hardcoded credential, and it is what lets
        # the remediation text grow with the table instead of staying a fixed
        # string that never names the fix.
        return {
            "v_type": "Secret-Leak",
            "severity": "CRITICAL",
            "file_path": finding.get("File", "unknown"),
            "line": finding.get("StartLine", 0),
            "desc": f"Detected secret: {finding.get('RuleID', 'Unknown Rule')}",
            "cwe": "CWE-798",
            "remediation": CWE_REMEDIATION["CWE-798"],
        }

    def normalize_pip_audit(self, dep: dict, vuln: dict) -> dict:
        # pip-audit has no dedicated CWE field; the class only appears inside
        # the advisory description as free text ("a CWE-20: ... vulnerability").
        cwe = None
        m = re.search(r"CWE-\d+", vuln.get("description") or "")
        if m:
            cwe = m.group(0)
        # aliases carries the CVE id when the advisory is keyed by a GHSA/OSV
        # id, which is what a reader actually searches for.
        ids = [vuln.get("id")] + (vuln.get("aliases") or [])
        fix = vuln.get("fix_versions") or []
        # The fix versions are the actionable part for a dependency, so they are
        # appended even when the CWE table supplies the guidance.
        rem = self._cwe_remediation(cwe, f"Update {dep['name']} to a fixed version.")
        if fix:
            rem += f" Fixed in: {', '.join(fix)}."
        return {
            "v_type": "Dependency-Vulnerability",
            "severity": "HIGH",
            "file_path": "requirements.txt",
            "line": 0,
            "desc": f"Vulnerable dependency {dep['name']} ({dep['version']}): {', '.join(str(i) for i in ids if i)}",
            "cwe": cwe,
            "remediation": rem,
        }

    def normalize_npm_audit(self, pkg: str, details: dict) -> dict:
        # "via" is a list of advisory titles (strings) or advisory objects;
        # it can also be empty, which used to IndexError and silently kill
        # the whole JS dependency scan.
        via = details.get("via") or []
        advisory = "No info"
        url = None
        cwe = None
        if via:
            first = via[0]
            if isinstance(first, str):
                advisory = first
            else:
                advisory = first.get("title") or first.get("name") or "No info"
                url = first.get("url")
                cwe = _extract_cwe(first.get("cwe"))
        return {
            "v_type": "Dependency-Vulnerability",
            "severity": self.NPM_SEVERITY.get(
                (details.get("severity") or "moderate").lower(), "MEDIUM"),
            "file_path": "package.json",
            "line": 0,
            "desc": f"Vulnerable package {pkg}: {advisory}" + (f" ({url})" if url else ""),
            "cwe": cwe,
            "remediation": self._cwe_remediation(cwe, f"Run npm audit fix or update {pkg}."),
        }


    def normalize_checkov(self, finding: dict) -> dict:
        # Checkov reports CRITICAL/HIGH/MEDIUM/LOW in SVS's own vocabulary, but a
        # policy that leaves severity unset reports the key absent entirely.
        # Unknown values fall back to MEDIUM, as everywhere else, rather than
        # passing through and scoring zero.
        severity = (finding.get("severity") or "").upper()
        if severity not in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"):
            severity = "MEDIUM"
        # The scan directory is mounted at /src, so checkov reports paths back
        # into it absolutely. Strip the prefix to keep the report consistent
        # with the other scanners, which report paths relative to the repo.
        # With "-d /src" checkov reports paths relative to that root with a
        # leading separator ("/main.tf"), never the mount point itself, so the
        # repo-relative path is one lstrip away. A path that is already
        # relative (or the "unknown" placeholder) is left alone.
        file_path = finding.get("file_path", "unknown")
        file_path = file_path.lstrip("/") if file_path.startswith("/") else file_path
        # The check id is the v_type, not a generic "IaC-Misconfiguration":
        # dedup keys on (file, line, cwe or v_type), checkov emits no CWE, so a
        # generic label would fold two different policies on one resource into a
        # single finding and hide one. It doubles as the SARIF ruleId.
        check_id = finding.get("check_id") or "CKV_UNKNOWN"
        # Checkov emits no CWE: a misconfiguration is keyed by that check id, so
        # the weakness-class table has no entry for it. The guideline URL is the
        # remediation pointer instead.
        guideline = finding.get("guideline")
        return {
            "v_type": check_id,
            "severity": severity,
            "file_path": file_path,
            "line": (finding.get("file_line_range") or [0])[0],
            "desc": f"{check_id}: "
                    f"{finding.get('check_name', 'Unknown IaC check')} "
                    f"({finding.get('resource', 'unknown resource')})",
            "cwe": None,
            "remediation": (
                f"{finding.get('check_name', 'Unknown IaC check')}. "
                f"Remediation guidance: {guideline}" if guideline
                else "Apply the policy fix this check describes."
            ),
        }


if __name__ == "__main__":
    n = FindingNormalizer()
    for raw, want in [("ERROR", "HIGH"), ("WARNING", "MEDIUM"), ("INFO", "INFO"),
                      ("error", "HIGH"), ("Garbage", "MEDIUM")]:
        got = n.normalize_semgrep({"check_id": "x", "extra": {"severity": raw}})["severity"]
        assert got == want, f"{raw} -> {got}, expected {want}"
    # a finding with no severity field must still land in a scored bucket
    assert n.normalize_semgrep({"check_id": "x", "extra": {}})["severity"] == "MEDIUM"

    # Secret material must never reach the database. gitleaks hands us the
    # matched secret itself in "Secret"/"Match"; the normalizer keeps only the
    # rule id, so the value has nowhere to leak to. This asserts that, so a
    # future "add the value for context" change fails here instead of storing
    # live credentials in a finding row.
    secret_value = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"
    leak = {"RuleID": "github-pat", "File": "config.py", "StartLine": 12,
            "Secret": secret_value, "Match": f"token={secret_value}"}
    out = n.normalize_gitleaks(leak)
    dumped = " ".join(str(v) for v in out.values())
    assert secret_value not in dumped, "raw secret leaked into the finding record"
    assert out["v_type"] == "Secret-Leak" and out["severity"] == "CRITICAL"
    assert "github-pat" in out["desc"]
    # gitleaks findings now carry the weakness class and guidance off it
    assert out["cwe"] == "CWE-798"
    assert "Rotate" in out["remediation"]

    # CWE-shaped remediation. npm advisories ship cwe as a list of bare ids.
    npm = n.normalize_npm_audit("minimatch", {
        "severity": "high",
        "via": [{"title": "Redos in minimatch", "url": "https://github.com/advisories/GHSA-f8q6-p94x-37v3",
                 "cwe": ["CWE-400", "CWE-1333"]}],
    })
    assert npm["cwe"] == "CWE-400", npm["cwe"]
    assert npm["remediation"] == CWE_REMEDIATION["CWE-400"]
    assert "GHSA-f8q6-p94x-37v3" in npm["desc"]

    # pip-audit hides the class in the description text.
    pip = n.normalize_pip_audit(
        {"name": "flask", "version": "2.0.0"},
        {"id": "GHSA-9446-f63c-6cfd", "aliases": ["CVE-2023-30861"],
         "description": "Flask before 2.2.5 has a CWE-20: Improper Input Validation vulnerability.",
         "fix_versions": ["2.2.5"]},
    )
    assert pip["cwe"] == "CWE-20", pip["cwe"]
    assert pip["remediation"].startswith(CWE_REMEDIATION["CWE-20"])
    assert "CVE-2023-30861" in pip["desc"] and "Fixed in: 2.2.5." in pip["remediation"]

    # A class the table does not cover still gets a pointer, not a dead end.
    odd = n.normalize_npm_audit("pkg", {
        "severity": "moderate",
        "via": [{"title": "something", "cwe": ["CWE-9999"]}],
    })
    assert odd["cwe"] == "CWE-9999"
    assert "cwe.mitre.org/data/definitions/9999.html" in odd["remediation"]

    # No CWE anywhere: the tool's own guidance still comes through intact.
    bare = n.normalize_semgrep({"check_id": "x", "extra": {"severity": "WARNING"}})
    assert bare["cwe"] is None
    assert bare["remediation"].startswith("Review the Semgrep rule documentation")
    bare_npm = n.normalize_npm_audit("pkg", {"severity": "low", "via": ["some advisory string"]})
    assert bare_npm["cwe"] is None and "npm audit fix" in bare_npm["remediation"]

    # semgrep metadata may carry a single string rather than a list.
    sg = n.normalize_semgrep({"check_id": "x", "extra": {"severity": "ERROR",
                              "metadata": {"cwe": "CWE-89"}}})
    assert sg["cwe"] == "CWE-89" and sg["remediation"] == CWE_REMEDIATION["CWE-89"]

    # Checkov findings keep their own severity vocabulary, but an unset or
    # unrecognised one must still land in a scored bucket, and the scan-root
    # leading separator must not reach the report.
    ckv = n.normalize_checkov({
        "check_id": "CKV_AWS_18", "check_name": "Ensure S3 bucket has access logging enabled",
        "resource": "aws_s3_bucket.example", "file_path": "/main.tf",
        "file_line_range": [7, 9], "severity": "high",
        "guideline": "https://docs.prismacloud.io/en/enterprise-edition/policy-reference/s3-policies/s3-2/s3-2-enable-access-logging",
    })
    assert ckv["v_type"] == "CKV_AWS_18", ckv["v_type"]
    assert ckv["severity"] == "HIGH", ckv["severity"]
    assert ckv["file_path"] == "main.tf", ckv["file_path"]
    assert ckv["line"] == 7, ckv["line"]
    assert "CKV_AWS_18" in ckv["desc"] and "aws_s3_bucket.example" in ckv["desc"]
    assert ckv["cwe"] is None
    assert "Remediation guidance:" in ckv["remediation"]

    # No severity and no guideline: defaults instead of None or an empty fix.
    # A nested path keeps its directories under the root.
    bare_ckv = n.normalize_checkov({
        "check_id": "CKV_DOCKER_3", "check_name": "Ensure that a user for the container has been created",
        "resource": "Dockerfile", "file_path": "/Dockerfile", "file_line_range": [1, 1],
    })
    assert bare_ckv["severity"] == "MEDIUM", bare_ckv["severity"]
    assert bare_ckv["file_path"] == "Dockerfile", bare_ckv["file_path"]
    assert "Apply the policy fix" in bare_ckv["remediation"]

    nested = n.normalize_checkov({
        "check_id": "CKV_AWS_145", "check_name": "Ensure that S3 buckets have versioning enabled",
        "resource": "aws_s3_bucket.logs", "file_path": "/modules/bucket/s3.tf",
        "file_line_range": [3, 3],
    })
    assert nested["file_path"] == "modules/bucket/s3.tf", nested["file_path"]

    print("normalizer severity mapping + secret masking + CWE remediation OK")

