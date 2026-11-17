// Local sentence embeddings (all-MiniLM-L6-v2, ~25 MB quantized) so questions are matched by MEANING.
// Runs on your CPU in ~10-30 ms per question. The model file downloads once on first use, then works offline.
const path = require('path');

let pipePromise = null;
function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = process.env.MODEL_CACHE || path.join(__dirname, '..', '.models');
      if (process.env.MODEL_OFFLINE === '1') env.allowRemoteModels = false; // installed app ships the model; never download
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    })();
    pipePromise.catch(() => { pipePromise = null; }); // allow retry (e.g. first run while offline)
  }
  return pipePromise;
}

async function embed(text) {
  const p = await getPipe();
  const out = await p(text, { pooling: 'mean', normalize: true });
  return out.data; // Float32Array, unit length
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

module.exports = { embed, dot, getPipe };
