# Exit Code 126 Fix

## Problem

Gitleaks was failing with exit code 126:
```
zricethezav/gitleaks:v8.9.0: exited 126
```

**Exit 126** means "permission denied" - the Docker container couldn't execute the binary directly.

## Root Cause

When Docker containers are configured with custom entrypoints or specific binary paths, calling a command directly (like `command=["detect", ...]`) can fail if the binary isn't in the default execution path or lacks execute permissions.

## Solution

Changed all scanners to use shell invocation instead of direct binary calls:

### Before (Failed):
```python
command=["detect", "--no-git", "--source", "/src", ...]
```

### After (Fixed):
```python
command=["sh", "-c", "gitleaks detect --no-git --source /src ..."]
```

## Files Updated

| Scanner | Change |
|---------|--------|
| **Gitleaks** | `gitleaks detect ...` via shell |
| **Semgrep** | `semgrep scan ...` via shell |
| **Checkov (IaC)** | `checkov -d /src ...` via shell |

## Why This Works

The shell (`sh`) inside the container handles command resolution, ensuring the binary is found regardless of the image's entrypoint or PATH configuration. This is a common Docker pattern for running commands in images with non-standard configurations.

## Expected Behavior

Gitleaks should now:
1. ✅ Execute properly via shell
2. ✅ Exit with code 0 (clean) or 1 (findings found)  
3. ✅ Write the report to the mounted scan directory

## Testing

Try scanning again:
```
https://github.com/VonHoltenCodes/SlowBooks-Pro-2026.git
```

Expected: Gitleaks completes without exit code 126 error.
