# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | Yes       |

## Reporting a Vulnerability

SVS is a security scanner. If you find a vulnerability in SVS itself, please
report it responsibly.

1. **Do not** open a public issue for security vulnerabilities.
2. Email the maintainer or use GitHub's private vulnerability reporting:
   - Go to the repository → **Security** → **Report a vulnerability**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix or mitigation:** within 30 days for critical, 90 days for others

## Scope

In scope:
- Remote code execution via scanned repositories
- SSRF bypasses in Git URL ingestion
- Path traversal in zip extraction
- SQL injection in the API
- Authentication/authorization bypasses (when auth is added)

Out of scope:
- Denial of service via large repositories (documented limitation)
- Scanner false positives/negatives (report to upstream scanner projects)
- Issues in dependencies (report to the dependency maintainer)

## Security Design

SVS is designed for **local, single-user use**. It is not hardened for
multi-user or public deployment without additional authentication and
network controls. See the README for the security posture section.