#!/usr/bin/env python3
"""
copilot-stealth-patch — Make copilot-api proxies look like real VS Code Copilot.

GitHub monitors Copilot API usage and can detect non-standard clients.
This script patches copilot-api and @jeffreycao/copilot-api proxy dist files
to send identical headers to a real VS Code Copilot extension:
  - vscode-machineid (SHA256 of MAC address — stable per machine)
  - vscode-sessionid (UUID+timestamp — rotated hourly like real VS Code)
  - openai-organization: github-copilot
  - Updated VS Code version fallback

Usage:
  # Patch copilot-api (port 4141)
  python3 copilot_stealth_patch.py

  # Patch with custom paths
  python3 copilot_stealth_patch.py --main /path/to/main.js --config /path/to/config.js

  # Check status only
  python3 copilot_stealth_patch.py --check

  # Restore originals
  python3 copilot_stealth_patch.py --restore

Idempotent. Backs up originals as .orig on first run.
Re-run after npm updates to re-apply patches.
"""

import argparse
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# ─── Auto-detect paths ───────────────────────────────────────────
def find_copilot_api_main() -> Path | None:
    """Find copilot-api main.js (the original ericc-ch version)."""
    candidates = [
        # Linux
        Path("/usr/lib/node_modules/copilot-api/dist/main.js"),
        Path("/usr/local/lib/node_modules/copilot-api/dist/main.js"),
        Path.home() / ".local/lib/node_modules/copilot-api/dist/main.js",
        # macOS (Homebrew)
        Path("/opt/homebrew/lib/node_modules/copilot-api/dist/main.js"),
    ]
    # Windows: %APPDATA%\npm\node_modules\copilot-api\dist\main.js
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "npm/node_modules/copilot-api/dist/main.js")
    # Also check npm global prefix (works on all platforms)
    try:
        import subprocess
        prefix = subprocess.check_output(
            ["npm", "prefix", "-g"], text=True, stderr=subprocess.DEVNULL
        ).strip()
        candidates.append(Path(prefix) / "lib/node_modules/copilot-api/dist/main.js")
        # Windows npm prefix puts node_modules directly under prefix
        candidates.append(Path(prefix) / "node_modules/copilot-api/dist/main.js")
    except Exception:
        pass

    for p in candidates:
        if p.exists():
            return p
    return None


def find_copilot_api_responses_config() -> Path | None:
    """Find @jeffreycao/copilot-api config dist file."""
    candidates = [
        # Linux
        Path("/opt/copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist"),
        Path("/usr/lib/node_modules/@jeffreycao/copilot-api/dist"),
        Path("/usr/local/lib/node_modules/@jeffreycao/copilot-api/dist"),
        # macOS (Homebrew)
        Path("/opt/homebrew/lib/node_modules/@jeffreycao/copilot-api/dist"),
        # Home directory install (all platforms)
        Path.home() / "copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist",
    ]
    # Windows: %APPDATA%\npm\node_modules or custom dir
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "npm/node_modules/@jeffreycao/copilot-api/dist")
    # Windows / macOS home directory common location
    candidates.append(Path.home() / ".copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist")
    # C:\copilot-api-responses on Windows
    if os.name == "nt":
        candidates.append(Path("C:/copilot-api-responses/node_modules/@jeffreycao/copilot-api/dist"))

    for d in candidates:
        if d.exists():
            # Find the config-*.js file
            for f in d.glob("config-*.js"):
                return f
    return None


# ─── Configuration ───────────────────────────────────────────────
VSCODE_VERSION = "1.111.0"  # Update when VS Code releases new versions


def log(msg: str):
    print(f"[{datetime.now():%H:%M:%S}] {msg}")


def backup(path: Path) -> bool:
    bak = path.with_suffix(path.suffix + ".orig")
    if not bak.exists():
        shutil.copy2(path, bak)
        log(f"  Backed up → {bak.name}")
        return True
    return False


def restore(path: Path) -> bool:
    bak = path.with_suffix(path.suffix + ".orig")
    if bak.exists():
        shutil.copy2(bak, path)
        log(f"  Restored {path.name} from backup")
        return True
    log(f"  No backup found for {path.name}")
    return False


# ─── Patchers ────────────────────────────────────────────────────

def patch_main(path: Path) -> int:
    """Patch copilot-api main.js (ericc-ch original)."""
    log(f"Patching {path}")
    backup(path)
    content = path.read_text()
    changes = 0

    # Already patched?
    has_machineid = "vscode-machineid" in content
    has_org = "openai-organization" in content

    # 1. Update VS Code fallback version
    for old_ver in ['"1.104.3"', '"1.100.0"', '"1.96.0"']:
        old = f'const FALLBACK = {old_ver}'
        if old in content:
            content = content.replace(old, f'const FALLBACK = "{VSCODE_VERSION}"')
            changes += 1
            log(f"  Updated FALLBACK: {old_ver} → \"{VSCODE_VERSION}\"")
            break

    if has_machineid and has_org:
        if changes:
            path.write_text(content)
        else:
            log("  Already fully patched")
        return changes

    # 2. Add createHash import
    if "createHash" not in content:
        content = content.replace(
            'import { randomUUID } from "node:crypto";',
            'import { randomUUID, createHash } from "node:crypto";'
        )
        changes += 1
        log("  Added createHash import")

    # 3. Inject machine ID + session ID generation
    if "macMachineId" not in content:
        machine_id_block = '''
//#region stealth-patch: vscode-machineid and vscode-sessionid
const _patchInvalidMacs = new Set(["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "ac:de:48:00:11:22"]);
function _patchGetMac() {
\tconst ifaces = os.networkInterfaces();
\tfor (const name in ifaces) {
\t\tfor (const { mac } of (ifaces[name] || [])) {
\t\t\tif (!_patchInvalidMacs.has(mac.toLowerCase())) return mac;
\t\t}
\t}
\treturn null;
}
(() => {
\tconst mac = _patchGetMac() || randomUUID();
\tstate.macMachineId = createHash("sha256").update(mac, "utf8").digest("hex");
\tstate.vsCodeSessionId = randomUUID() + Date.now().toString();
\tsetInterval(() => {
\t\tstate.vsCodeSessionId = randomUUID() + Date.now().toString();
\t}, 3600000 + Math.floor(Math.random() * 1200000));
})();
//#endregion'''
        match = re.search(r'(const state = \{[^}]+\};)', content)
        if match:
            content = content[:match.end()] + "\n" + machine_id_block + "\n" + content[match.end():]
            changes += 1
            log("  Injected machineid/sessionid generation")

    # 4. Add headers to copilotHeaders
    old_close = '"x-vscode-user-agent-library-version": "electron-fetch"\n\t};'
    new_close = ('"x-vscode-user-agent-library-version": "electron-fetch",\n'
                 '\t\t"openai-organization": "github-copilot"\n'
                 '\t};\n'
                 '\tif (state$1.macMachineId) headers["vscode-machineid"] = state$1.macMachineId;\n'
                 '\tif (state$1.vsCodeSessionId) headers["vscode-sessionid"] = state$1.vsCodeSessionId;')
    if old_close in content and not has_machineid:
        content = content.replace(old_close, new_close, 1)
        changes += 1
        log("  Added machineid/sessionid/org to copilotHeaders")

    # 5. Add openai-organization to githubHeaders
    gh_old = '"x-vscode-user-agent-library-version": "electron-fetch"\n});'
    gh_new = ('"x-vscode-user-agent-library-version": "electron-fetch",\n'
              '\t"openai-organization": "github-copilot"\n});')
    if gh_old in content and not has_org:
        content = content.replace(gh_old, gh_new, 1)
        changes += 1
        log("  Added openai-organization to githubHeaders")

    path.write_text(content)
    log(f"  Done: {changes} changes")
    return changes


def patch_config(path: Path) -> int:
    """Patch @jeffreycao/copilot-api config file."""
    log(f"Patching {path}")
    backup(path)
    content = path.read_text()
    changes = 0

    if "openai-organization" in content:
        log("  Already patched")
        return 0

    # Add openai-organization to copilotHeaders
    old = '"x-interaction-type": "conversation-agent"\n\t};'
    new = ('"x-interaction-type": "conversation-agent",\n'
           '\t\t"openai-organization": "github-copilot"\n\t};')
    if old in content:
        content = content.replace(old, new, 1)
        changes += 1
        log("  Added openai-organization to copilotHeaders")

    # Add to githubHeaders
    gh_old = '"x-vscode-user-agent-library-version": "electron-fetch"\n});'
    gh_new = ('"x-vscode-user-agent-library-version": "electron-fetch",\n'
              '\t"openai-organization": "github-copilot"\n});')
    if gh_old in content:
        content = content.replace(gh_old, gh_new, 1)
        changes += 1
        log("  Added openai-organization to githubHeaders")

    path.write_text(content)
    log(f"  Done: {changes} changes")
    return changes


def check_status(main_path: Path | None, config_path: Path | None):
    """Check if patches are applied."""
    print("\nCopilot Stealth Patch Status\n" + "=" * 40)

    if main_path and main_path.exists():
        c = main_path.read_text()
        checks = [
            ("vscode-machineid", "vscode-machineid" in c),
            ("vscode-sessionid", "vscode-sessionid" in c),
            ("openai-organization", "openai-organization" in c),
            (f"FALLBACK={VSCODE_VERSION}", VSCODE_VERSION in c),
        ]
        print(f"\ncopilot-api ({main_path}):")
        for name, ok in checks:
            print(f"  {'✓' if ok else '✗'} {name}")
    else:
        print(f"\ncopilot-api: not found")

    if config_path and config_path.exists():
        c = config_path.read_text()
        checks = [
            ("openai-organization", "openai-organization" in c),
            ("vscode-machineid", "vscode-machineid" in c),
            ("vscode-sessionid", "vsCodeSessionId" in c),
        ]
        print(f"\ncopilot-api-responses ({config_path}):")
        for name, ok in checks:
            print(f"  {'✓' if ok else '✗'} {name}")
    else:
        print(f"\ncopilot-api-responses: not found")


def main():
    parser = argparse.ArgumentParser(
        description="Make copilot-api proxies look like real VS Code Copilot")
    parser.add_argument("--main", type=Path,
                        help="Path to copilot-api main.js")
    parser.add_argument("--config", type=Path,
                        help="Path to @jeffreycao/copilot-api config-*.js")
    parser.add_argument("--check", action="store_true",
                        help="Check patch status only")
    parser.add_argument("--restore", action="store_true",
                        help="Restore original unpatched files")
    args = parser.parse_args()

    main_path = args.main or find_copilot_api_main()
    config_path = args.config or find_copilot_api_responses_config()

    if args.check:
        check_status(main_path, config_path)
        return

    if args.restore:
        if main_path:
            restore(main_path)
        if config_path:
            restore(config_path)
        print("Restored. Restart services to take effect.")
        return

    log("copilot-stealth-patch starting...")
    total = 0

    if main_path:
        total += patch_main(main_path)
    else:
        log("copilot-api not found (skipping)")

    if config_path:
        total += patch_config(config_path)
    else:
        log("@jeffreycao/copilot-api not found (skipping)")

    if total > 0:
        log(f"\nDone! {total} total changes. Restart proxy services to activate.")
    else:
        log("\nAll patches already applied.")


if __name__ == "__main__":
    main()
