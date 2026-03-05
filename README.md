# Talkdesk Deepfake Analyzer

AI-powered audio deepfake detection built on the **ValidSoft Voice Verity API**. Upload audio files or record from your microphone to determine whether speech is genuine or synthetically generated.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/rmbiscaia/talkdesk-deepfake-analyzer.git
cd talkdesk-deepfake-analyzer

# 2. Configure your API key
cp .env.example .env
# Edit .env and set your VALIDSOFT_API_KEY

# 3. Start the server
node server.js

# 4. Open http://localhost:3000
```

No dependencies to install — uses only Node.js built-in modules.

---

## Features

- **File Upload** — Drag-and-drop or browse for audio files (WAV, MP3, OGG, WebM, M4A, up to 50 MB)
- **Microphone Recording** — Record directly from the browser with real-time waveform visualization
- **Result Visualization** — Circular gauge with percentage score, classification badges (Genuine / Deepfake / Inconclusive), and detailed metrics grid
- **Analysis History** — Automatic tracking of past results with timestamps and quick re-access
- **Raw API Response** — Expandable view of the complete ValidSoft response JSON

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Client)                     │
│                                                         │
│  index.html ──► deepfake.js (Analyzer UI + Logic)       │
│              ──► styles.css  (Talkdesk Design Tokens)   │
└────────────────────────┬────────────────────────────────┘
                         │
                    POST /validsoft/deepfake
                    { voiceData: "<base64>" }
                         │
┌────────────────────────▼────────────────────────────────┐
│                  server.js (Node.js :3000)               │
│                                                         │
│  POST /validsoft/deepfake ──► ValidSoft Voice Verity    │
│  /*                       ──► Static file serving       │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer        | Technology                                               |
| ------------ | -------------------------------------------------------- |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3                   |
| **Backend**  | Node.js (native `http`/`https` modules, zero dependencies) |
| **Audio**    | Web Audio API, MediaRecorder API, FileReader API         |
| **API**      | ValidSoft Voice Verity                                    |
| **Design**   | Talkdesk Brand Tokens (Purple #5405BD, Inter/Poppins)    |

---

## Project Structure

```
talkdesk-deepfake-analyzer/
├── server.js          # Node.js proxy server (port 3000)
├── index.html         # Single-page application
├── styles.css         # Talkdesk design system & component styles
├── deepfake.js        # Audio deepfake analyzer (ValidSoft integration)
├── .env.example       # Environment variable template
├── .env               # Your local config (git-ignored)
└── README.md
```

---

## Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

| Variable            | Description                                     |
| ------------------- | ----------------------------------------------- |
| `VALIDSOFT_API_KEY`  | Your ValidSoft Voice Verity API key             |
| `VALIDSOFT_API_URL`  | Full URL of the ValidSoft deepfake endpoint     |
| `PORT`               | Server port (default: `3000`)                   |

The server reads `.env` on startup with a built-in parser (no `dotenv` dependency needed).

---

## API Proxy

### `POST /validsoft/deepfake`

The server proxies requests to the ValidSoft Voice Verity API, injecting the API key server-side.

**Request:**
```json
{
  "voiceData": "<base64-encoded audio>"
}
```

**Response:** Forwarded directly from ValidSoft — typically includes a score (0–1), classification label, and detailed metrics.

**Authentication:** `Authorization: Bearer <VALIDSOFT_API_KEY>` header, injected by the proxy.

---

## Deepfake Analysis

### How It Works

#### 1. File Upload
Upload a pre-recorded audio file. The client reads the file, encodes it to Base64, and sends it to `/validsoft/deepfake`. Results are displayed as a circular gauge with a confidence score and classification.

#### 2. Microphone Recording
Click record to capture audio directly from the browser microphone. A real-time waveform is rendered via the Web Audio API. Once stopped, the recording is analyzed identically to uploaded files.

### Score Classification

| Score Range | Classification | Color  |
| ----------- | -------------- | ------ |
| 0.7 – 1.0   | Genuine        | Green  |
| 0.3 – 0.7   | Inconclusive   | Amber  |
| 0.0 – 0.3   | Deepfake       | Red    |

### Response Metrics
The analyzer extracts and displays:
- **Confidence Score** — Probability of genuine speech (0–1)
- **Classification** — Genuine, Deepfake, or Synthetic
- **Audio Duration** — Length of analyzed segment
- **Sample Rate** — Audio quality indicator
- **Speech Detection** — Whether speech was found in the audio

The response parser is flexible and adapts to various field naming conventions from the API.

---

## License

This project is proprietary to Talkdesk. All rights reserved.
