---
name: web-search
description: Search the web for information without API keys. Use when you need to look up current information, research topics, find documentation, check prices, news, or any factual query. Prefer this over guessing or using outdated knowledge.
allowed-tools: Bash(curl:*), Bash(agent-browser:*)
---

# Web Search

Search the web from the container using curl or agent-browser. No API keys required.

## Quick Search (curl + DuckDuckGo)

For simple factual queries, use DuckDuckGo's instant answer API:

```bash
curl -s "https://api.duckduckgo.com/?q=your+query+here&format=json&no_html=1" | python3 -m json.tool
```

Fields to check: `AbstractText`, `Answer`, `RelatedTopics[].Text`

## Web Search (agent-browser)

For full search results, use agent-browser with Google or DuckDuckGo:

```bash
agent-browser open "https://www.google.com/search?q=your+query+here"
agent-browser snapshot -i
```

Then read the results from the snapshot. Click links for full articles:

```bash
agent-browser click @e3      # Click a search result
agent-browser snapshot -i    # Read the page
```

## Research Workflow

1. **Start broad**: Search the topic to understand the landscape
2. **Go deep**: Click into 2-3 relevant results and read them
3. **Synthesize**: Combine findings into a clear answer
4. **Cite**: Mention where you found the information

## Tips

- URL-encode spaces as `+` in search queries
- For code/docs: add `site:github.com` or `site:stackoverflow.com` to the query
- For recent info: add the current year to the query
- Use `agent-browser` for JavaScript-heavy sites that curl can't render
- For long articles, use `agent-browser snapshot` (text only) to save context

## Fetching Web Pages (curl)

For simple pages, curl is faster than agent-browser:

```bash
# Get page as text (strip HTML)
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

```bash
# Get JSON API responses
curl -s "https://api.example.com/data" | python3 -m json.tool
```
