---
name: web-search
description: Search the web for information. Uses Google Gemini for search. Prefer the MCP tool for queries; use curl/agent-browser for direct URL fetching.
allowed-tools: Bash(curl:*), Bash(agent-browser:*)
---

# Web Search

## Primary: Gemini Search (MCP tool)

Use the `mcp__nanoclaw__gemini_search` tool for all web searches:

```
Tool: mcp__nanoclaw__gemini_search
  query: "your search query"
  detail: "brief" (default) or "detailed"
```

This uses Google Gemini with built-in Google Search for accurate, current results.

## Fetching Specific URLs

For fetching a known URL, use `WebFetch` (built-in) or `curl`:

```bash
# Simple page fetch
curl -sL "https://example.com" | python3 -c "
import sys, html, re
text = sys.stdin.read()
text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text).strip()
print(html.unescape(text)[:5000])
"
```

## Interactive Browsing (agent-browser)

For JavaScript-heavy sites or when you need to interact:

```bash
agent-browser open "https://www.google.com/search?q=your+query"
agent-browser snapshot -i
agent-browser click @e3
```
