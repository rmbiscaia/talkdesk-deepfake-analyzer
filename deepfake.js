// Deepfake Audio Analyzer — ValidSoft Voice Verity Integration
// Handles audio upload, microphone recording, base64 encoding, API calls, and result display

class DeepfakeAnalyzer {
  constructor() {
    // DOM elements — Input
    this.dropzone = document.getElementById('dropzone');
    this.fileInput = document.getElementById('fileInput');
    this.browseBtn = document.getElementById('browseBtn');
    this.recordBtn = document.getElementById('recordBtn');
    this.recorder = document.getElementById('recorder');
    this.recorderTime = document.getElementById('recorderTime');
    this.recorderWaveform = document.getElementById('recorderWaveform');
    this.stopRecordBtn = document.getElementById('stopRecordBtn');
    this.cancelRecordBtn = document.getElementById('cancelRecordBtn');
    this.inputSection = document.getElementById('inputSection');

    // DOM elements — Preview
    this.previewSection = document.getElementById('previewSection');
    this.previewName = document.getElementById('previewName');
    this.previewMeta = document.getElementById('previewMeta');
    this.audioPlayer = document.getElementById('audioPlayer');
    this.clearBtn = document.getElementById('clearBtn');
    this.analyzeBtn = document.getElementById('analyzeBtn');

    // DOM elements — States
    this.analyzingSection = document.getElementById('analyzingSection');
    this.resultsSection = document.getElementById('resultsSection');
    this.errorSection = document.getElementById('errorSection');
    this.errorText = document.getElementById('errorText');
    this.errorDetail = document.getElementById('errorDetail');
    this.retryBtn = document.getElementById('retryBtn');

    // DOM elements — Results
    this.gaugeScore = document.getElementById('gaugeScore');
    this.gaugeUnit = document.getElementById('gaugeUnit');
    this.gaugeFill = document.getElementById('gaugeFill');
    this.classificationBadge = document.getElementById('classificationBadge');
    this.classificationDesc = document.getElementById('classificationDesc');
    this.detailsGrid = document.getElementById('detailsGrid');
    this.rawJson = document.getElementById('rawJson');
    this.newAnalysisBtn = document.getElementById('newAnalysisBtn');

    // DOM elements — History
    this.historySection = document.getElementById('historySection');
    this.historyList = document.getElementById('historyList');

    // State
    this.currentFile = null;
    this.base64Data = null;
    this.mediaRecorder = null;
    this.recordingChunks = [];
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.analyserNode = null;
    this.audioContext = null;
    this.history = [];

    this.bindEvents();
  }

  // ==========================================
  // Event Binding
  // ==========================================

  bindEvents() {
    // File browse
    this.browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fileInput.click();
    });
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Drag & drop
    this.dropzone.addEventListener('click', () => this.fileInput.click());
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('df-dropzone--active');
    });
    this.dropzone.addEventListener('dragleave', () => {
      this.dropzone.classList.remove('df-dropzone--active');
    });
    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('df-dropzone--active');
      const files = e.dataTransfer.files;
      if (files.length > 0) this.loadFile(files[0]);
    });

    // Recording
    this.recordBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startRecording();
    });
    this.stopRecordBtn.addEventListener('click', () => this.stopRecording());
    this.cancelRecordBtn.addEventListener('click', () => this.cancelRecording());

    // Preview controls
    this.clearBtn.addEventListener('click', () => this.reset());
    this.analyzeBtn.addEventListener('click', () => this.analyze());

    // Results controls
    this.newAnalysisBtn.addEventListener('click', () => this.reset());
    this.retryBtn.addEventListener('click', () => this.reset());
  }

  // ==========================================
  // File Handling
  // ==========================================

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) this.loadFile(file);
  }

  loadFile(file) {
    const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm',
                        'audio/x-wav', 'audio/wave', 'audio/x-m4a', 'audio/mp4'];
    const validExtensions = ['.wav', '.mp3', '.ogg', '.webm', '.m4a'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      this.showError('Unsupported file format', `Please upload a WAV, MP3, OGG, or WebM audio file. Got: ${file.type || ext}`);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      this.showError('File too large', 'Maximum file size is 50 MB.');
      return;
    }

    this.currentFile = file;
    this.encodeFile(file);
  }

  encodeFile(file) {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      this.base64Data = base64;
      this.showPreview(file);
    };

    reader.onerror = () => {
      this.showError('Failed to read file', 'Could not read the audio file. Please try again.');
    };

    reader.readAsDataURL(file);
  }

  showPreview(file) {
    const ext = file.name.split('.').pop().toUpperCase();
    const sizeKB = (file.size / 1024).toFixed(1);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    const sizeStr = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

    this.previewName.textContent = file.name;
    this.previewMeta.textContent = `${ext} — ${sizeStr}`;

    const url = URL.createObjectURL(file);
    this.audioPlayer.src = url;
    this.audioPlayer.onloadedmetadata = () => {
      const duration = this.audioPlayer.duration;
      if (duration && isFinite(duration)) {
        this.previewMeta.textContent = `${ext} — ${sizeStr} — ${this.formatDuration(duration)}`;
      }
    };

    this.inputSection.hidden = true;
    this.previewSection.hidden = false;
    this.hideError();
    this.resultsSection.hidden = true;
    this.analyzingSection.hidden = true;
  }

  // ==========================================
  // Microphone Recording
  // ==========================================

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Audio context for waveform visualization
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      // MediaRecorder
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.getSupportedMimeType()
      });
      this.recordingChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (this.recordingChunks.length > 0) {
          const blob = new Blob(this.recordingChunks, { type: this.mediaRecorder.mimeType });
          const ext = this.mediaRecorder.mimeType.includes('webm') ? 'webm' :
                      this.mediaRecorder.mimeType.includes('mp4') ? 'm4a' : 'ogg';
          const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
          this.loadFile(file);
        }
        this.cleanupRecording();
      };

      this.mediaRecorder.start(100);
      this.recordingStartTime = Date.now();

      // Show recorder UI
      this.dropzone.hidden = true;
      this.recorder.hidden = false;

      // Start timer
      this.recordingTimer = setInterval(() => this.updateRecordingTime(), 100);

      // Start waveform
      this.drawWaveform();

    } catch (err) {
      console.error('Microphone access denied:', err);
      this.showError('Microphone access denied', 'Please allow microphone access in your browser settings to record audio.');
    }
  }

  getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  cancelRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.recordingChunks = [];
      this.mediaRecorder.stop();
    }
    this.cleanupRecording();
    this.dropzone.hidden = false;
    this.recorder.hidden = true;
  }

  cleanupRecording() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyserNode = null;
  }

  updateRecordingTime() {
    const elapsed = (Date.now() - this.recordingStartTime) / 1000;
    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    this.recorderTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  drawWaveform() {
    if (!this.analyserNode || !this.recorder || this.recorder.hidden) return;

    const canvas = this.recorderWaveform;
    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!this.analyserNode || this.recorder.hidden) return;
      requestAnimationFrame(draw);

      this.analyserNode.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#EF4444';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
  }

  // ==========================================
  // API Integration
  // ==========================================

  async analyze() {
    if (!this.base64Data) return;

    this.setState('analyzing');

    try {
      const data = await this.analyzeBase64(this.base64Data);
      this.showResults(data);
      this.addToHistory(this.currentFile?.name || 'Recording', data, null);
    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'Request timed out. The audio file may be too large or the server is not responding.'
        : err.message;
      this.showError('Analysis failed', message);
      this.addToHistory(this.currentFile?.name || 'Recording', null, message);
    }
  }

  async analyzeBase64(base64) {
    const payloadSize = base64.length;
    const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1);
    console.log(`[Deepfake] Sending ${payloadMB} MB payload to API`);

    if (payloadSize > 45 * 1024 * 1024) {
      throw new Error(`Audio too large (${payloadMB} MB). Max ~45 MB base64. Try a shorter recording.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch('/validsoft/deepfake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceData: base64 }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { rawResponse: text };
      }

      if (!response.ok) {
        const msg = data.message || data.error || data.type || `HTTP ${response.status}`;
        const detail = data.type ? `${data.type}: ${msg}` : msg;
        throw new Error(detail);
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      console.error('[Deepfake] Fetch error:', err.name, err.message);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. The server may be unreachable or the audio too large.');
      }
      throw new Error(`Could not reach the analysis server (${err.message}). Check that the server is running on ${window.location.origin} and try again.`);
    }
  }

  // ==========================================
  // Results Display
  // ==========================================

  showResults(data) {
    this.setState('results');

    const score = this.extractScore(data);
    const classification = this.extractClassification(data, score);
    const details = this.extractDetails(data);

    // Update gauge
    this.animateGauge(score, classification);

    // Update classification badge
    this.classificationBadge.textContent = classification.label;
    this.classificationBadge.className = `df-classification-badge df-classification-badge--${classification.type}`;
    this.classificationDesc.textContent = classification.description;

    // Update details grid
    this.detailsGrid.innerHTML = '';
    for (const detail of details) {
      const card = document.createElement('div');
      card.className = 'df-detail-card';
      card.innerHTML = `
        <div class="df-detail-label">${detail.label}</div>
        <div class="df-detail-value">${detail.value}</div>
      `;
      this.detailsGrid.appendChild(card);
    }

    // Raw JSON
    this.rawJson.textContent = JSON.stringify(data, null, 2);
  }

  extractScore(data) {
    // ValidSoft API: extract normalizedScore from synthetic-voice plugin
    if (Array.isArray(data.pluginScores)) {
      const synth = data.pluginScores.find(p => p.option === 'synthetic-voice');
      if (synth) {
        if (typeof synth.normalizedScore === 'number') {
          // normalizedScore is 0–1; guard against 0–100 range
          return synth.normalizedScore > 1 ? synth.normalizedScore / 100 : synth.normalizedScore;
        }
        if (typeof synth.score === 'number' && synth.score >= 0 && synth.score <= 1) {
          return synth.score;
        }
      }
    }

    // Fallback: generic field names for non-ValidSoft responses
    if (typeof data.score === 'number') return data.score;
    if (typeof data.deepfakeScore === 'number') return data.deepfakeScore;
    if (typeof data.confidence === 'number') return data.confidence;
    if (typeof data.genuineScore === 'number') return data.genuineScore;
    if (typeof data.result?.score === 'number') return data.result.score;
    if (typeof data.probability === 'number') return data.probability;
    return null;
  }

  extractClassification(data, score) {
    // ValidSoft API: use outcome + reason
    if (data.outcome === 'PASSED') {
      const pct = score !== null ? ` (${(score * 100).toFixed(1)}% confidence)` : '';
      return { type: 'genuine', label: 'Genuine', description: `All checks passed${pct} — this audio appears to be genuine human speech.` };
    }
    if (data.outcome === 'FAILED') {
      const pct = score !== null ? ` Score: ${(score * 100).toFixed(1)}%.` : '';
      switch (data.reason) {
        case 'SYNTHETIC-VOICE':
          return { type: 'deepfake', label: 'Deepfake Detected', description: `Synthetic voice detected.${pct} This audio shows characteristics of AI-generated speech.` };
        case 'REPLAY-DETECTION':
          return { type: 'deepfake', label: 'Replay Detected', description: `Audio replay attack detected.${pct}` };
        case 'DETECT-SPEECH':
          return { type: 'unknown', label: 'No Speech', description: 'Insufficient speech detected in the audio. Try a longer sample with clear speech.' };
        case 'GET-SNR':
          return { type: 'unknown', label: 'Low Quality', description: 'Audio signal-to-noise ratio is too low for reliable analysis. Try a cleaner recording.' };
        case 'AUDIO-PROCESSING-FAILURE':
          return { type: 'unknown', label: 'Processing Error', description: 'Audio could not be processed. Try a different format (WAV recommended) or a longer sample.' };
        default:
          return { type: 'deepfake', label: 'Failed', description: `Analysis failed: ${data.reason}.${pct}` };
      }
    }

    // Fallback: score-based classification for non-ValidSoft responses
    if (score !== null) {
      if (score >= 0.7) return { type: 'genuine', label: 'Genuine', description: `Confidence: ${(score * 100).toFixed(1)}% — This audio appears to be genuine.` };
      if (score <= 0.3) return { type: 'deepfake', label: 'Deepfake Detected', description: `Confidence: ${(score * 100).toFixed(1)}% — This audio shows synthetic characteristics.` };
      return { type: 'unknown', label: 'Inconclusive', description: `Score: ${(score * 100).toFixed(1)}% — The result is inconclusive. Try a longer or clearer sample.` };
    }

    return { type: 'unknown', label: 'Result Received', description: 'Analysis complete. See the raw API response for details.' };
  }

  extractDetails(data) {
    const details = [];

    // ValidSoft API: structured response with outcome, reason, pluginScores
    if (data.outcome) {
      details.push({ label: 'Outcome', value: data.outcome });
    }
    if (data.reason) {
      details.push({ label: 'Reason', value: data.reason });
    }

    // Plugin scores — show each analysis module
    if (Array.isArray(data.pluginScores)) {
      for (const plugin of data.pluginScores) {
        const name = plugin.option
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());

        let value = '';
        if (typeof plugin.normalizedScore === 'number') {
          const ns = plugin.normalizedScore > 1 ? plugin.normalizedScore : plugin.normalizedScore * 100;
          value = `${ns.toFixed(1)}%`;
        } else if (typeof plugin.score === 'number') {
          value = String(plugin.score % 1 === 0 ? plugin.score : plugin.score.toFixed(2));
        }
        if (typeof plugin.threshold === 'number') {
          value += ` (thr: ${plugin.threshold})`;
        }
        details.push({ label: name, value });
      }
    }

    if (data.requestId) {
      details.push({ label: 'Request ID', value: data.requestId });
    }

    // Fallback: generic extraction for non-ValidSoft responses
    if (details.length === 0) {
      const skip = new Set(['voiceData', 'rawResponse', 'pluginScores']);
      const source = data.result && typeof data.result === 'object' ? data.result : data;
      for (const [key, val] of Object.entries(source)) {
        if (skip.has(key) || typeof val === 'object') continue;
        if (details.length >= 6) break;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim();
        details.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: String(val) });
      }
    }

    // Always add file info
    if (this.currentFile) {
      details.push({ label: 'File', value: this.currentFile.name });
      const sizeMB = (this.currentFile.size / (1024 * 1024)).toFixed(2);
      details.push({ label: 'File Size', value: `${sizeMB} MB` });
    }

    return details;
  }

  animateGauge(score, classification) {
    const circumference = 2 * Math.PI * 85; // ~534
    const fill = this.gaugeFill;

    if (score !== null) {
      const offset = circumference * (1 - score);
      this.gaugeScore.textContent = Math.round(score * 100);
      this.gaugeUnit.textContent = 'score';
      requestAnimationFrame(() => {
        fill.style.strokeDashoffset = offset;
      });
    } else {
      this.gaugeScore.textContent = '\u2014';
      this.gaugeUnit.textContent = '';
      fill.style.strokeDashoffset = circumference;
    }

    fill.classList.remove('df-gauge-fill--genuine', 'df-gauge-fill--deepfake', 'df-gauge-fill--unknown');
    fill.classList.add(`df-gauge-fill--${classification.type}`);
  }

  // ==========================================
  // History
  // ==========================================

  addToHistory(name, data, error) {
    const entry = {
      name,
      timestamp: new Date(),
      data,
      error,
      classification: error ? 'error' : this.extractClassification(data, this.extractScore(data)).type,
      score: data ? this.extractScore(data) : null
    };

    this.history.unshift(entry);
    this.renderHistory();
  }

  renderHistory() {
    if (this.history.length === 0) {
      this.historySection.hidden = true;
      return;
    }

    this.historySection.hidden = false;
    this.historyList.innerHTML = '';

    for (const entry of this.history) {
      const item = document.createElement('div');
      item.className = 'df-history-item';

      const scoreText = entry.error ? 'Error' :
                        entry.score !== null ? `${Math.round(entry.score * 100)}%` :
                        'Done';

      const resultClass = entry.classification;
      const timeStr = entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <span class="df-history-dot df-history-dot--${resultClass}"></span>
        <span class="df-history-name">${this.escapeHtml(entry.name)}</span>
        <span class="df-history-result df-history-result--${resultClass}">${scoreText}</span>
        <span class="df-history-time">${timeStr}</span>
      `;

      if (entry.data) {
        item.addEventListener('click', () => {
          this.showResults(entry.data);
          this.previewName.textContent = entry.name;
        });
      }

      this.historyList.appendChild(item);
    }
  }

  // ==========================================
  // UI State Management
  // ==========================================

  setState(state) {
    this.inputSection.hidden = true;
    this.previewSection.hidden = true;
    this.analyzingSection.hidden = true;
    this.resultsSection.hidden = true;
    this.errorSection.hidden = true;

    switch (state) {
      case 'idle':
        this.inputSection.hidden = false;
        this.dropzone.hidden = false;
        this.recorder.hidden = true;
        break;
      case 'loaded':
        this.previewSection.hidden = false;
        break;
      case 'analyzing':
        this.analyzingSection.hidden = false;
        break;
      case 'results':
        this.resultsSection.hidden = false;
        break;
      case 'error':
        this.errorSection.hidden = false;
        break;
    }
  }

  reset() {
    this.currentFile = null;
    this.base64Data = null;
    this.fileInput.value = '';
    this.audioPlayer.src = '';
    this.setState('idle');
  }

  showError(title, detail) {
    this.errorText.textContent = title;
    this.errorDetail.textContent = detail || '';
    this.setState('error');
  }

  hideError() {
    this.errorSection.hidden = true;
  }

  // ==========================================
  // Utilities
  // ==========================================

  formatDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return m > 0 ? `${m}m ${s}s` : `${s}.${ms}s`;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.deepfakeAnalyzer = new DeepfakeAnalyzer();
});
