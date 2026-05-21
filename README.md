<div align="center">

<img src="https://img.shields.io/badge/WebClaw-v1.0.0-blueviolet?style=for-the-badge&logo=node.js&logoColor=white" />
<img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen?style=for-the-badge&logo=node.js" />
<img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" />
<img src="https://img.shields.io/badge/Cost-100%25%20Free-orange?style=for-the-badge" />

# 🕷️ WebClaw

**A zero-cost, autonomous AI CLI agent powered by Chrome browser automation.**  
Chat with frontier AI models — Qwen & DeepSeek — completely **free**, without spending a single token or API credit.

</div>

---

## ✨ What is WebClaw?

WebClaw is a lightweight, powerful CLI tool that **hijacks your already-logged-in browser sessions** using the [Chrome DevTools Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/). It streams real AI responses from **Qwen International** and **DeepSeek** — just like using their web UIs — but entirely from your terminal.

No API keys. No subscriptions. No rate-limit billing. Just AI.

> **Inspired by** [openclaw-zero-token](https://github.com) and [opencode](https://github.com), both MIT licensed.

---

## 🚀 Features

| Feature | Description |
|---|---|
| 🧠 **Multi-model support** | Qwen Max, Qwen Plus, Qwen Turbo, QwQ 32B, DeepSeek Chat, DeepSeek Reasoner |
| 💬 **Stateful chat sessions** | Full multi-turn conversation context across messages |
| 🤔 **Thinking / Reasoning mode** | Live chain-of-thought display with animated indicator |
| 🔍 **Web search toggle** | Enable Qwen's built-in search with a flag |
| 🤖 **Autonomous agent mode** | Launch parallel sub-agents for deep research |
| 🎨 **Beautiful CLI UI** | Colored output, spinners, banners — not just plaintext |
| 🔐 **Session cookie auth** | One-time login per provider, persisted securely |
| 💸 **Zero cost** | No API keys required — uses your existing browser login |

---

## 📦 Prerequisites

- **Node.js** `>= 20.0.0`
- **Google Chrome** installed on your system
- Active accounts at:
  - [chat.qwen.ai](https://chat.qwen.ai) (for Qwen models)
  - [chat.deepseek.com](https://chat.deepseek.com) (for DeepSeek models)

---

## ⚡ Installation

```bash
# Clone the repository
git clone https://github.com/skysapien7-cell/webclaw.git
cd webclaw

# Install dependencies
npm install

# (Optional) Install globally to use `webclaw` from anywhere
npm link
```

---

## 🛠️ Setup & Usage

### 1. Start Chrome in Debug Mode

WebClaw connects to Chrome via CDP. You must launch Chrome with the remote debugging port open:

```bash
webclaw chrome
```

Or manually:

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### 2. Authenticate Your Providers

Log in once per provider. WebClaw saves your session cookie so you never need to log in again.

```bash
# Authenticate with Qwen International
webclaw auth qwen

# Authenticate with DeepSeek
webclaw auth deepseek
```

Follow the prompts — WebClaw will open the provider's login page and capture your session automatically.

### 3. Start Chatting!

```bash
# Start an interactive chat session (default model: qwen-max-latest)
webclaw chat

# Chat with a specific model
webclaw chat --model qwen-plus-latest
webclaw chat --model deepseek-reasoner

# Enable thinking/reasoning mode
webclaw chat --think

# Enable web search (Qwen only)
webclaw chat --search

# Use DeepSeek as the provider
webclaw chat --provider deepseek
```

---

## 📖 All Commands

```
webclaw <command> [options]

Commands:
  webclaw chrome    Launch Chrome in debug mode (CDP)
  webclaw auth      Authenticate with a provider (qwen | deepseek)
  webclaw chat      Start an interactive AI chat session
  webclaw models    List all available models for each provider
  webclaw agent     Launch an autonomous research agent
  webclaw gui       Open the WebClaw web GUI

Options:
  --help, -h        Show help
  --version, -v     Show version number
```

### Chat Options

```
webclaw chat [options]

  --provider    AI provider to use          [string] [choices: "qwen", "deepseek"]
  --model       Model ID to use             [string]
  --think       Enable chain-of-thought     [boolean]
  --search      Enable web search (Qwen)    [boolean]
```

---

## 🤖 Supported Models

### Qwen International (`chat.qwen.ai`)

| Model ID | Name | Best For |
|---|---|---|
| `qwen-max-latest` | Qwen Max (Latest) | Complex tasks, coding, analysis |
| `qwen-plus-latest` | Qwen Plus (Latest) | Balanced speed & quality |
| `qwen-turbo-latest` | Qwen Turbo (Latest) | Fast, lightweight responses |
| `qwq-32b` | QwQ 32B (Reasoning) | Deep reasoning & math |

### DeepSeek (`chat.deepseek.com`)

| Model ID | Name | Best For |
|---|---|---|
| `deepseek-chat` | DeepSeek V3 | General chat, coding |
| `deepseek-reasoner` | DeepSeek R1 | Advanced reasoning, research |

---

## 🏗️ Architecture

```
webclaw/
├── src/
│   ├── index.js              # CLI entry point (yargs)
│   ├── history.js            # Conversation history & context builder
│   ├── commands/
│   │   ├── auth.js           # Provider authentication flow
│   │   ├── chat.js           # Interactive chat command (REPL loop)
│   │   ├── chrome.js         # Chrome debug launcher
│   │   ├── models.js         # List available models
│   │   ├── agent.js          # Autonomous agent orchestration
│   │   └── gui.js            # Web GUI server command
│   ├── providers/
│   │   ├── qwen.js           # Qwen streaming client (CDP + fetch injection)
│   │   ├── deepseek.js       # DeepSeek streaming client (CDP + SSE)
│   │   └── resolve.js        # Provider resolution helper
│   ├── browser/
│   │   └── chrome.js         # Playwright CDP connection manager
│   ├── auth/
│   │   └── store.js          # Session cookie persistence
│   └── ui/
│       └── banner.js         # CLI banner & UI utilities
└── webclaw_system_prompt.txt # Default system prompt for agent mode
```

### How It Works

```
  Your Terminal
       │
       ▼
  webclaw CLI  ──────────────────────────────────────────────┐
       │                                                      │
       ▼                                                      ▼
  Chrome (CDP)  ◄──── Playwright Core (page.evaluate)   Auth Store
       │                                               (cookies.json)
       ▼
  Browser Context (with your logged-in session)
       │
       ▼
  fetch() INSIDE browser  ──► chat.qwen.ai / chat.deepseek.com
       │
       ▼
  SSE Stream  ──► console.log interception  ──► back to CLI
       │
       ▼
  Streamed response in your terminal ✅
```

The magic: by running `fetch()` **inside the browser context** via `page.evaluate()`, WebClaw inherits your session cookies automatically. The AI provider can't tell the difference between you and their own web UI.

---

## 💡 Tips & Tricks

- **Switch models mid-session:** Type `/model <model-id>` during a chat.
- **Clear context:** Type `/clear` to reset conversation history.
- **Exit chat:** Type `exit` or press `Ctrl+C`.
- **Reasoning mode:** Use `--think` with QwQ 32B or DeepSeek Reasoner for best results.
- **Multiple providers:** Run `webclaw models` to see all available models across both providers.

---

## 🐛 Troubleshooting

**Chrome not connecting?**
```bash
# Make sure Chrome is running with debug port
webclaw chrome
# Then verify it's accessible
curl http://localhost:9222/json/version
```

**Authentication expired?**
```bash
# Re-authenticate the provider
webclaw auth qwen
# or
webclaw auth deepseek
```

**Model not responding?**
- Ensure you're logged in at [chat.qwen.ai](https://chat.qwen.ai) or [chat.deepseek.com](https://chat.deepseek.com) in Chrome
- Try a different model with `--model <model-id>`

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Commit: `git commit -m "feat: add my feature"`
5. Push: `git push origin feat/my-feature`
6. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

WebClaw is built on top of open-source projects:
- [openclaw](https://github.com/openclaw/openclaw) — MIT (official)
- [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) — MIT
- [opencode](https://github.com/sst/opencode) — MIT

---

<div align="center">

## 👨‍💻 Contributors

* **[rahulbaiga](https://github.com/skysapien7-cell)** - Creator & Lead Developer
* **WebClaw / Antigravity AI** - AI Co-Pilot & Contributor
