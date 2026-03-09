// Deepfake Audio Analyzer — ValidSoft Voice Verity Integration
// Handles audio upload, microphone recording, base64 encoding, API calls, and result display

class DeepfakeAnalyzer {
  // Target sample rate for ValidSoft API. Override via URL param: ?rate=16000
  static TARGET_RATE = (() => {
    const param = new URLSearchParams(window.location.search).get('rate');
    return param ? parseInt(param, 10) : 8000;
  })();

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
    this.resultsAudioPlayer = document.getElementById('resultsAudioPlayer');
    this.gaugeScore = document.getElementById('gaugeScore');
    this.gaugeUnit = document.getElementById('gaugeUnit');
    this.gaugeFill = document.getElementById('gaugeFill');
    this.classificationBadge = document.getElementById('classificationBadge');
    this.classificationDesc = document.getElementById('classificationDesc');
    this.resultsSummary = document.getElementById('resultsSummary');
    this.detailsGrid = document.getElementById('detailsGrid');
    this.rawJson = document.getElementById('rawJson');
    this.newAnalysisBtn = document.getElementById('newAnalysisBtn');

    // DOM elements — History
    this.historySection = document.getElementById('historySection');
    this.historyList = document.getElementById('historyList');

    // State
    this.currentFile = null;
    this.base64Data = null;
    this.audioUrl = null;
    this.pcmSamples = [];
    this.scriptProcessorNode = null;
    this.mediaStream = null;
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

  async encodeFile(file) {
    try {
      // Read file as ArrayBuffer, decode audio, resample to 16kHz mono WAV
      const arrayBuffer = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      audioCtx.close().catch(() => {});

      const TARGET_RATE = DeepfakeAnalyzer.TARGET_RATE;
      const srcRate = decoded.sampleRate;
      const duration = decoded.duration;
      const targetLength = Math.round(duration * TARGET_RATE);

      console.log(`[Deepfake] Resampling: ${srcRate}Hz → ${TARGET_RATE}Hz, ${duration.toFixed(1)}s, ${decoded.numberOfChannels}ch`);

      // Mix to mono and resample via OfflineAudioContext
      const offline = new OfflineAudioContext(1, targetLength, TARGET_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();

      // Encode as 16-bit PCM WAV
      const wavBytes = this.encodeWav(rendered.getChannelData(0), TARGET_RATE);
      const wavBase64 = this.arrayBufferToBase64(wavBytes);

      this.base64Data = wavBase64;
      console.log(`[Deepfake] Resampled WAV: ${(wavBytes.byteLength / 1024).toFixed(0)} KB base64: ${(wavBase64.length / 1024).toFixed(0)} KB`);

      this.showPreview(file);
    } catch (err) {
      console.error('[Deepfake] Audio processing error:', err);
      this.showError('Failed to process audio', `Could not decode or resample the audio file: ${err.message}`);
    }
  }

  encodeWav(samples, sampleRate) {
    const numSamples = samples.length;
    const bytesPerSample = 2; // 16-bit
    const dataSize = numSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);           // fmt chunk size
    view.setUint16(20, 1, true);            // PCM format
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);   // sample rate
    view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
    view.setUint16(32, bytesPerSample, true); // block align
    view.setUint16(34, 16, true);           // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM samples — clamp float32 [-1,1] → int16
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return buffer;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  showPreview(file) {
    const ext = file.name.split('.').pop().toUpperCase();
    const sizeKB = (file.size / 1024).toFixed(1);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    const sizeStr = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

    this.previewName.textContent = file.name;
    this.previewMeta.textContent = `${ext} — ${sizeStr}`;

    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = URL.createObjectURL(file);
    this.audioPlayer.src = this.audioUrl;
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
      this.mediaStream = stream;

      const TARGET_RATE = DeepfakeAnalyzer.TARGET_RATE;

      // Create AudioContext at target sample rate — browser resamples
      // from native mic rate (e.g. 48kHz) using high-quality HW resampling
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: TARGET_RATE
      });

      if (this.audioContext.sampleRate !== TARGET_RATE) {
        console.warn(`[Deepfake] AudioContext sampleRate is ${this.audioContext.sampleRate}, requested ${TARGET_RATE}`);
      }

      const source = this.audioContext.createMediaStreamSource(stream);

      // AnalyserNode for waveform visualization
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      // ScriptProcessorNode for raw PCM capture (mono, 4096 buffer)
      this.scriptProcessorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.pcmSamples = [];

      this.scriptProcessorNode.onaudioprocess = (e) => {
        // Copy input buffer — it's reused by the audio system
        this.pcmSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        // Silence the output to prevent feedback
        e.outputBuffer.getChannelData(0).fill(0);
      };

      // Must connect to destination for onaudioprocess to fire
      source.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.audioContext.destination);

      this.recordingStartTime = Date.now();

      // Show recorder UI
      this.dropzone.hidden = true;
      this.recorder.hidden = false;

      // Start timer
      this.recordingTimer = setInterval(() => this.updateRecordingTime(), 100);

      // Start waveform
      this.drawWaveform();

      console.log(`[Deepfake] Recording started: raw PCM at ${this.audioContext.sampleRate}Hz mono`);

    } catch (err) {
      console.error('Microphone access denied:', err);
      this.showError('Microphone access denied', 'Please allow microphone access in your browser settings to record audio.');
    }
  }

  stopRecording() {
    if (!this.audioContext || this.pcmSamples.length === 0) return;

    const actualRate = this.audioContext.sampleRate;

    // Concatenate all PCM chunks into a single Float32Array
    const totalLength = this.pcmSamples.reduce((sum, c) => sum + c.length, 0);
    const allSamples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.pcmSamples) {
      allSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const duration = totalLength / actualRate;
    console.log(`[Deepfake] Recording stopped: ${duration.toFixed(1)}s, ${totalLength} samples at ${actualRate}Hz`);

    if (duration < 0.5) {
      this.showError('Recording too short', 'Please record at least 1 second of audio.');
      if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
      this.cleanupRecording();
      this.dropzone.hidden = false;
      this.recorder.hidden = true;
      return;
    }

    // Encode raw PCM directly as 16-bit WAV — zero lossy compression
    const wavBytes = this.encodeWav(allSamples, actualRate);
    const wavBase64 = this.arrayBufferToBase64(wavBytes);

    this.base64Data = wavBase64;
    console.log(`[Deepfake] Raw PCM WAV: ${(wavBytes.byteLength / 1024).toFixed(0)} KB, base64: ${(wavBase64.length / 1024).toFixed(0)} KB`);

    // Create File for preview player
    const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
    const file = new File([wavBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' });
    this.currentFile = file;

    // Show preview (skip encodeFile — already at correct rate)
    this.showPreview(file);

    // Stop media stream + cleanup
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
    this.cleanupRecording();
  }

  cancelRecording() {
    this.pcmSamples = [];
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
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
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.onaudioprocess = null;
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.mediaStream = null;
    this.pcmSamples = [];
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
    const jsonBody = JSON.stringify({ voiceData: base64 });
    const jsonMB = (jsonBody.length / (1024 * 1024)).toFixed(1);
    console.log(`[Deepfake] Sending ${jsonMB} MB JSON payload (${payloadMB} MB base64)`);

    if (jsonBody.length > 5.5 * 1024 * 1024) {
      throw new Error(`Audio too large (${jsonMB} MB payload). Netlify has a 6 MB request limit. Try a shorter or lower-quality recording.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch('/validsoft/deepfake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
        signal: controller.signal
      });

      clearTimeout(timeout);

      const text = await response.text();
      const fromProxy = response.headers.get('x-proxy') === 'deepfake-fn';
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { rawResponse: text };
      }

      if (!response.ok) {
        console.error(`[Deepfake] HTTP ${response.status} (from ${fromProxy ? 'proxy' : 'Netlify infra'}):`, text.slice(0, 500));

        if (!fromProxy) {
          // 400 from Netlify infrastructure, not our function
          throw new Error(`Netlify returned HTTP ${response.status} before reaching the proxy function. This usually means the request body is too large (${jsonMB} MB; limit ~6 MB) or the function path is misconfigured.`);
        }

        const msg = data.message || data.error || data.type || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(`HTTP ${response.status}: ${msg}`);
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      console.error('[Deepfake] Fetch error:', err.name, err.message);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. The server may be unreachable or the audio too large.');
      }
      throw err;
    }
  }

  // ==========================================
  // Results Display
  // ==========================================

  showResults(data) {
    this.setState('results');

    // Set audio player in results section
    if (this.audioUrl) {
      this.resultsAudioPlayer.src = this.audioUrl;
      this.resultsAudioPlayer.parentElement.hidden = false;
    } else {
      this.resultsAudioPlayer.parentElement.hidden = true;
    }

    const score = this.extractScore(data);
    const classification = this.extractClassification(data, score);
    const details = this.extractDetails(data);

    // Update gauge
    this.animateGauge(score, classification);

    // Update classification badge
    this.classificationBadge.textContent = classification.label;
    this.classificationBadge.className = `df-classification-badge df-classification-badge--${classification.type}`;
    this.classificationDesc.textContent = classification.description;

    // Update summary
    const summary = this.generateSummary(data);
    if (summary) {
      this.resultsSummary.textContent = summary;
      this.resultsSummary.hidden = false;
    } else {
      this.resultsSummary.hidden = true;
    }

    // Update details grid
    this.detailsGrid.innerHTML = '';
    for (const detail of details) {
      const card = document.createElement('div');
      card.className = 'df-detail-card';
      const statusDot = typeof detail.passed === 'boolean'
        ? `<span class="df-detail-status df-detail-status--${detail.passed ? 'passed' : 'failed'}"></span>`
        : '';
      const descHtml = detail.description
        ? `<div class="df-detail-desc">${detail.description}</div>`
        : '';
      card.innerHTML = `
        <div class="df-detail-label">${detail.label}</div>
        <div class="df-detail-header">
          <div class="df-detail-value">${detail.value}</div>
          ${statusDot}
        </div>
        ${descHtml}
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

    // Plugin scores — show each analysis module with descriptions
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
          value += ` (threshold: ${plugin.threshold})`;
        }

        const description = this.getPluginDescription(plugin);
        details.push({ label: name, value, description, passed: plugin.passed });
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

  getPluginDescription(plugin) {
    const passed = plugin.passed;
    const scoreStr = typeof plugin.score === 'number'
      ? (plugin.score % 1 === 0 ? String(plugin.score) : plugin.score.toFixed(2))
      : null;
    const thrStr = typeof plugin.threshold === 'number' ? String(plugin.threshold) : null;
    const context = scoreStr && thrStr ? ` Score: ${scoreStr}, threshold: ${thrStr}.` : '';

    switch (plugin.option) {
      case 'synthetic-voice':
        return passed
          ? `The audio does not appear to be AI-generated — it sounds like a real human voice.${context}`
          : `The audio shows characteristics of AI-generated or synthesized speech.${context}`;
      case 'replay-detection':
        return passed
          ? `The audio appears to be live speech, not played back from a recording.${context}`
          : `The audio may have been played through a speaker and re-captured rather than being live speech.${context}`;
      case 'detect-speech':
        return passed
          ? `Sufficient speech content was detected in the audio.${context}`
          : `Insufficient speech detected — try a longer sample with clear speech.${context}`;
      case 'get-snr':
        return passed
          ? `Audio quality is good — speech signal is well above background noise.${context}`
          : `Audio quality is too low for reliable analysis — try a cleaner recording environment.${context}`;
      default:
        return passed ? `Check passed.${context}` : `Check failed.${context}`;
    }
  }

  generateSummary(data) {
    if (!Array.isArray(data.pluginScores) || !data.outcome) return '';

    const total = data.pluginScores.length;
    const passedCount = data.pluginScores.filter(p => p.passed).length;
    const countStr = `${passedCount} of ${total} checks passed.`;

    if (data.outcome === 'PASSED') {
      return `The audio passed all ${total} checks. It appears to be genuine live human speech with good audio quality. ${countStr}`;
    }

    const synth = data.pluginScores.find(p => p.option === 'synthetic-voice');
    const replay = data.pluginScores.find(p => p.option === 'replay-detection');

    switch (data.reason) {
      case 'SYNTHETIC-VOICE': {
        const scoreInfo = synth ? ` The synthetic voice score of ${(synth.score * 100).toFixed(0)}% fell below the ${(synth.threshold * 100).toFixed(0)}% threshold needed to pass.` : '';
        return `The audio was flagged as AI-generated speech.${scoreInfo} ${countStr}`;
      }
      case 'REPLAY-DETECTION': {
        const replayInfo = replay ? ` The replay detection score of ${replay.score.toFixed(2)} fell below the ${replay.threshold} threshold.` : '';
        const synthPassed = synth?.passed ? ' The voice itself sounds human (not AI-generated),' : '';
        return `The audio was flagged as a replay attack —${synthPassed} but the system suspects it was played through a speaker rather than spoken live.${replayInfo} This could be a false positive depending on recording conditions. ${countStr}`;
      }
      case 'DETECT-SPEECH':
        return `The audio did not contain enough speech for reliable analysis. Try a longer recording with clear speech. ${countStr}`;
      case 'GET-SNR':
        return `The audio quality was too low for reliable analysis. The signal-to-noise ratio did not meet the minimum threshold. Try recording in a quieter environment. ${countStr}`;
      case 'AUDIO-PROCESSING-FAILURE':
        return `The audio could not be processed by the analysis engine. Try a different audio format or a longer sample. ${countStr}`;
      default:
        return `Analysis failed: ${data.reason}. ${countStr}`;
    }
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
    this.resultsAudioPlayer.src = '';
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
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
