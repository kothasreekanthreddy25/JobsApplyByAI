// Streaming speech-to-text via Deepgram (nova-3). Interim results arrive in ~300ms;
// speech_final / UtteranceEnd tells us the speaker finished, which triggers answering.
const WebSocket = require('ws');
const EventEmitter = require('events');

class StreamingSTT extends EventEmitter {
  constructor(apiKey) { super(); this.key = apiKey; this.ws = null; this.buf = ''; }

  open() {
    const url = 'wss://api.deepgram.com/v1/listen?' + new URLSearchParams({
      model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1',
      interim_results: 'true', endpointing: '350', utterance_end_ms: '1000',
      smart_format: 'true', punctuate: 'true',
    });
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${this.key}` } });
    this.ws.on('open', () => {
      this.keep = setInterval(() => this.ws.readyState === 1 && this.ws.send(JSON.stringify({ type: 'KeepAlive' })), 8000);
      this.emit('ready');
    });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'Results') {
        const t = m.channel?.alternatives?.[0]?.transcript || '';
        if (!t) return;
        if (m.is_final) this.buf += (this.buf ? ' ' : '') + t;
        this.emit('interim', (this.buf + ' ' + (m.is_final ? '' : t)).trim());
        if (m.speech_final) this.flush();
      } else if (m.type === 'UtteranceEnd') this.flush();
    });
    this.ws.on('close', () => { clearInterval(this.keep); this.emit('closed'); });
    this.ws.on('error', (e) => this.emit('error', e));
  }

  flush() {
    const text = this.buf.trim();
    this.buf = '';
    if (text) this.emit('utterance', text);
  }

  send(pcm16) { if (this.ws?.readyState === 1) this.ws.send(pcm16); }
  close() { try { this.ws?.close(); } catch {} }
}

module.exports = { StreamingSTT };
