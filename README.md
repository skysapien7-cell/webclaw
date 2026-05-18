# WebClaw — Zero-Cost AI CLI Agent

> Combined agent from [OpenClaw Zero-Token](https://github.com/openclaw/openclaw) + [OpenCode](https://github.com/anomalyco/opencode.git)  
> **Only Qwen International + DeepSeek** — Chrome browser automation, no API keys needed.

## Supported Models

| Provider | Model ID | Description |
|---|---|---|
| **Qwen International** 🟢 | `qwen-max-latest` | Most capable Qwen model |
| | `qwen-plus-latest` | Balanced performance |
| | `qwen-turbo-latest` | Fast responses |
| | `qwq-32b` | Reasoning model |
| **DeepSeek** 🔵 | `deepseek_chat` | DeepSeek V3 general chat |
| | `deepseek_reasoner` | DeepSeek R1 with chain-of-thought |

> ✅ **Qwen International works in India** — no VPN needed!

## Quick Start

```bash
# 1. Install dependencies
cd webclaw-agent
npm install

# 2. Launch Chrome in debug mode
node src/index.js chrome

# 3. Log in to Qwen/DeepSeek in the Chrome window that opens

# 4. Capture credentials
node src/index.js auth qwen
node src/index.js auth deepseek

# 5. Start chatting!
node src/index.js chat
```

## Commands

| Command | Description |
|---|---|
| `webclaw chrome` | Launch Chrome with debug port for automation |
| `webclaw auth qwen` | Capture Qwen International credentials |
| `webclaw auth deepseek` | Capture DeepSeek credentials |
| `webclaw auth` | Show auth status for all providers |
| `webclaw chat` | Start interactive AI chat |
| `webclaw chat -m deepseek_reasoner` | Chat with specific model |
| `webclaw chat -s "Hello"` | Single message (non-interactive) |
| `webclaw models` | List all available models |

## Chat Commands (Inside Chat)

| Command | Description |
|---|---|
| `/model <id>` | Switch to a different model |
| `/models` | List available models |
| `/clear` | Clear the screen |
| `/quit` | Exit |

## How It Works

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐
│ You type  │────▶│  WebClaw    │────▶│ Chrome CDP   │
│ in CLI    │     │  CLI Agent  │     │ (port 9222)  │
└──────────┘     └─────────────┘     └──────┬───────┘
                                             │
                       Stolen cookies/tokens │
                                             ▼
                 ┌─────────────┐     ┌──────────────┐
                 │ Streaming   │◀────│ AI Web API   │
                 │ Response    │     │ (qwen/ds)    │
                 └─────────────┘     └──────────────┘
```

1. **Chrome launches** with debug port 9222 enabled
2. **You log in** to Qwen/DeepSeek in the browser
3. **WebClaw captures** your session cookies via Chrome DevTools Protocol
4. **When you chat**, WebClaw replays those cookies to the AI's web API
5. **Responses stream** back in real-time to your terminal

## Architecture (from OpenClaw + OpenCode)

- **CLI Framework**: yargs (from OpenCode) — clean command routing
- **Browser Automation**: Playwright + Chrome CDP (from OpenClaw) — cookie capture
- **Streaming**: Native fetch + SSE parsing (from OpenClaw's web-stream modules)
- **Auth Storage**: Simple JSON file (custom — lightweight)

## Project Structure

```
webclaw-agent/
├── src/
│   ├── index.js              ← Entry point (yargs CLI)
│   ├── browser/
│   │   └── chrome.js         ← Chrome CDP connection manager
│   ├── auth/
│   │   ├── store.js          ← JSON credential storage
│   │   ├── qwen.js           ← Qwen auth capture
│   │   └── deepseek.js       ← DeepSeek auth capture
│   ├── providers/
│   │   ├── qwen.js           ← Qwen streaming client
│   │   └── deepseek.js       ← DeepSeek streaming client
│   ├── commands/
│   │   ├── chrome.js         ← `webclaw chrome`
│   │   ├── auth.js           ← `webclaw auth`
│   │   ├── chat.js           ← `webclaw chat`
│   │   └── models.js         ← `webclaw models`
│   └── ui/
│       └── banner.js         ← CLI branding + colors
└── package.json
```

## Requirements

- **Node.js** ≥ 20
- **Google Chrome** (any recent version)
- **playwright-core** (installed via npm)

## License

MIT — derived from OpenClaw (MIT) and OpenCode (MIT).
