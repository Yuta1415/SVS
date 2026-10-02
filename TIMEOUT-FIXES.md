# Slow Repository Fix

## Problem

When scanning repositories like `https://github.com/VonHoltenCodes/SlowBooks-Pro-2026.git`, the system would often fail due to timeouts.

## Root Causes

1. **Network latency** - Scanners that download rulesets/advisories (Semgrep, pip-audit, npm audit) can be slow
2. **Large repositories** - Files with many files take longer to scan
3. **Registry lookups** - Dependency scanning needs to query remote CVE/registry databases
4. **Slow clone operations** - Some repos have large histories or slow network connections

## Solution Applied

### 1. Increased Scanner Timeouts

| Scanner | Old Timeout | New Timeout |
|---------|-------------|-------------|
| **Semgrep** | 15 min (900s) | **30 min (1800s)** |
| **Gitleaks** | 15 min (900s) | **30 min (1800s)** |
| **pip-audit** | 15 min (900s) | **30 min (1800s)** |
| **npm audit** | 15 min (900s) | **30 min (1800s)** |
| **Checkov (IaC)** | 15 min (900s) | **30 min (1800s)** |

**Files modified:**
- `backend/app/engine/semgrep_scanner.py`
- `backend/app/engine/dependency_scanner.py`
- `backend/app/engine/gitleaks_scanner.py`
- `backend/app/engine/iac_scanner.py`

### 2. Improved Git Clone with Timeout

Replaced GitPython's `clone_from()` with direct `git clone` subprocess that includes:
- **Explicit timeout**: 5 minutes for clone operation
- **Better error messages**: Clear feedback when clone fails
- **Error handling**: Proper cleanup on timeout

**File modified:** `backend/app/engine/ingestion.py`

```python
# Before: No timeout, unclear error messages
Repo.clone_from(repo_url, extract_path, depth=1)

# After: 5-minute timeout, better error handling
result = subprocess.run(
    ["git", "clone", "--depth=1", "--timeout=60", repo_url, "."],
    cwd=extract_path,
    capture_output=True,
    text=True,
    timeout=300  # 5 minute clone timeout
)
```

## Expected Improvements

1. **Fewer timeout failures** - Slow repositories now have adequate time to complete
2. **Better error feedback** - Clear messages when operations fail
3. **More reliable cloning** - Explicit timeout prevents hanging

## If Issues Persist

If a repository still fails after these changes:

1. **Check network connectivity** - Some scanners need external network access:
   - Semgrep: downloads ruleset from semgrep.dev
   - pip-audit: downloads CVE database
   - npm audit: downloads registry/advisory data

2. **Try alternative methods**:
   - Upload as `.zip` instead of cloning
   - Use the demo scan endpoint for testing

3. **Increase timeout further**:
   - Edit `backend/app/engine/base_scanner.py`
   - Increase `DEFAULT_TIMEOUT = 1800` to `3600` (60 minutes)

## Testing

Test with the slow repository:
```bash
# Start the system
run-svs.bat

# Then use the UI to scan:
# https://github.com/VonHoltenCodes/SlowBooks-Pro-2026.git
```

Expected behavior:
- Clone completes within 5 minutes
- Scanning completes within 30-60 minutes depending on repo size
- Clear error messages if it still fails
