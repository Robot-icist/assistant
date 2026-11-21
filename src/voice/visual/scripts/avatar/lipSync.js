import { state } from "./state.js";
import * as THREE from "three";

// ============ Lip Sync ============
// Enhanced phoneme-based lip sync using multi-band frequency analysis
// Detects vowels (a, i, u, e, o) and consonants (bilabial, dental, velar) for natural mouth shapes

// VRM expression names for vowels (standard VRM expressions)
export const VOWEL_EXPRESSIONS = {
  a: ["a", "aa", "A"],
  i: ["i", "ih", "I"],
  u: ["u", "uw", "U"],
  e: ["e", "eh", "E"],
  o: ["o", "oh", "O"],
};

// Phoneme frequency bands (in Hz) for better discrimination
// Based on acoustic phonetics - key frequency regions for different phoneme classes
export const PHONEME_BANDS = {
  // Vowel formant regions
  vowel_a: { low: 600, high: 1000, weight: 1.0 },   // F1 for /a/
  vowel_a_f2: { low: 1000, high: 1600, weight: 0.7 }, // F2 for /a/
  vowel_i: { low: 200, high: 400, weight: 1.0 },    // F1 for /i/
  vowel_i_f2: { low: 2000, high: 3000, weight: 0.7 }, // F2 for /i/
  vowel_u: { low: 200, high: 400, weight: 1.0 },    // F1 for /u/
  vowel_u_f2: { low: 600, high: 1000, weight: 0.7 }, // F2 for /u/
  vowel_e: { low: 400, high: 700, weight: 1.0 },    // F1 for /e/
  vowel_e_f2: { low: 1600, high: 2400, weight: 0.7 }, // F2 for /e/
  vowel_o: { low: 400, high: 600, weight: 1.0 },    // F1 for /o/
  vowel_o_f2: { low: 800, high: 1200, weight: 0.7 }, // F2 for /o/
  
  // Consonant regions
  bilabial: { low: 100, high: 500, weight: 1.0 },     // m, b, p - low freq, nasal/oral
  dental: { low: 500, high: 2000, weight: 1.0 },      // t, d, n, s - mid freq
  velar: { low: 1000, high: 3000, weight: 0.8 },      // k, g, ng - higher freq
  fricative: { low: 2000, high: 6000, weight: 1.0 },  // s, z, sh, f - high freq noise
  
  // Overall energy bands
  lowEnergy: { low: 80, high: 300, weight: 1.0 },     // Fundamental + 1st harmonic
  midEnergy: { low: 300, high: 1000, weight: 0.8 },   // Formant region
  highEnergy: { low: 1000, high: 4000, weight: 0.6 }, // Frication + higher formants
};


// Smoothed phoneme state for temporal continuity

export function setupAudioAnalysis(audioEl) {
  if (!audioEl) return;

  state.mediaElement = audioEl;

  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }

  // Create analyser for real-time frequency data - larger FFT for better freq resolution
  if (!state.analyser) {
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024; // Better frequency resolution
    state.analyser.smoothingTimeConstant = 0.15;
  }

  // Recreate audio source if element changed
  if (state.audioSource) {
    try { state.audioSource.disconnect(); } catch (e) {}
  }
  state.audioSource = state.audioContext.createMediaElementSource(audioEl);
  state.audioSource.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);

  // Also connect to a second analyser for time-domain data (waveform)
  if (!state.waveformAnalyser) {
    state.waveformAnalyser = state.audioContext.createAnalyser();
    state.waveformAnalyser.fftSize = 2048; // Better time resolution
    state.waveformAnalyser.smoothingTimeConstant = 0.05;
  }
  state.audioSource.connect(state.waveformAnalyser);
}

// Second analyser for waveform/amplitude analysis

// Get energy in a frequency band
export function getBandEnergy(freqData, sampleRate, band) {
  const fftSize = freqData.length * 2;
  const startBin = Math.max(0, Math.floor((band.low * fftSize) / sampleRate));
  const endBin = Math.min(freqData.length - 1, Math.floor((band.high * fftSize) / sampleRate));
  
  let sum = 0;
  let count = 0;
  for (let i = startBin; i <= endBin; i++) {
    sum += freqData[i];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// Detect phoneme scores from frequency spectrum using multi-band analysis
export function detectPhonemesFromSpectrum(freqData, sampleRate = 44100) {
  const scores = {
    a: 0, i: 0, u: 0, e: 0, o: 0,
    bilabial: 0, dental: 0, velar: 0, fricative: 0
  };

  // Get energy in each phoneme band
  const bandEnergies = {};
  for (const [name, band] of Object.entries(PHONEME_BANDS)) {
    bandEnergies[name] = getBandEnergy(freqData, sampleRate, band) * band.weight;
  }

  // Vowel classification based on formant ratios
  // F1/F2 ratios are distinctive for each vowel
  const f1_a = bandEnergies.vowel_a;
  const f2_a = bandEnergies.vowel_a_f2;
  const f1_i = bandEnergies.vowel_i;
  const f2_i = bandEnergies.vowel_i_f2;
  const f1_u = bandEnergies.vowel_u;
  const f2_u = bandEnergies.vowel_u_f2;
  const f1_e = bandEnergies.vowel_e;
  const f2_e = bandEnergies.vowel_e_f2;
  const f1_o = bandEnergies.vowel_o;
  const f2_o = bandEnergies.vowel_o_f2;

  // Vowel scoring using formant patterns
  // /a/ - high F1, mid F2
  scores.a = (f1_a * 1.2 + f2_a * 0.5) / 2;
  // /i/ - low F1, high F2
  scores.i = (f1_i * 1.5 + f2_i * 1.2) / 2;
  // /u/ - low F1, low F2
  scores.u = (f1_u * 1.3 + f2_u * 0.8) / 2;
  // /e/ - mid F1, high F2
  scores.e = (f1_e * 1.1 + f2_e * 1.0) / 2;
  // /o/ - mid F1, mid-low F2
  scores.o = (f1_o * 1.0 + f2_o * 0.9) / 2;

  // Consonant scoring
  scores.bilabial = bandEnergies.bilabial;      // m, b, p - mouth closed
  scores.dental = bandEnergies.dental;          // t, d, n, s - tongue forward
  scores.velar = bandEnergies.velar;            // k, g - tongue back
  scores.fricative = bandEnergies.fricative;    // s, z, sh, f - high freq noise

  // Normalize vowel scores
  const vowelMax = Math.max(scores.a, scores.i, scores.u, scores.e, scores.o);
  if (vowelMax > 0) {
    scores.a /= vowelMax;
    scores.i /= vowelMax;
    scores.u /= vowelMax;
    scores.e /= vowelMax;
    scores.o /= vowelMax;
  }

  // Normalize consonant scores
  const consMax = Math.max(scores.bilabial, scores.dental, scores.velar, scores.fricative);
  if (consMax > 0) {
    scores.bilabial /= consMax;
    scores.dental /= consMax;
    scores.velar /= consMax;
    scores.fricative /= consMax;
  }

  // Temporal smoothing - keep history for stability
  state.phonemeHistory.push(scores);
  if (state.phonemeHistory.length > 3) state.phonemeHistory.shift();

  // Average over history
  const avgScores = { a: 0, i: 0, u: 0, e: 0, o: 0, bilabial: 0, dental: 0, velar: 0, fricative: 0 };
  for (const h of state.phonemeHistory) {
    for (const k of Object.keys(avgScores)) {
      avgScores[k] += h[k];
    }
  }
  for (const k of Object.keys(avgScores)) {
    avgScores[k] /= state.phonemeHistory.length;
  }

  // Additional smoothing with previous frame
  for (const k of Object.keys(avgScores)) {
    state.lastPhonemeScores[k] = THREE.MathUtils.lerp(state.lastPhonemeScores[k], avgScores[k], 0.3);
  }

  return { ...state.lastPhonemeScores };
}

export function updateLipSync(deltaTime) {
  if (!state.config.lipSyncEnabled || !state.vrm || !state.vrm.expressionManager || !state.analyser) return;

  // Get frequency data
  const freqData = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(freqData);

  // Get time-domain data for amplitude
  const timeData = new Uint8Array(state.waveformAnalyser?.frequencyBinCount || 1024);
  if (state.waveformAnalyser) {
    state.waveformAnalyser.getByteTimeDomainData(timeData);
  }

  // Calculate RMS amplitude for jaw/overall openness
  let rmsSum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const sample = (timeData[i] - 128) / 128; // Convert to -1..1
    rmsSum += sample * sample;
  }
  const rms = Math.sqrt(rmsSum / timeData.length);
  const voiceActivity = Math.min(rms * 3.5, 1); // Scale and clamp
  state.currentVoiceActivity = voiceActivity; // Update global for face tracking blending

  // Detect phonemes from spectrum
  const phonemeScores = detectPhonemesFromSpectrum(freqData);

  // Map phonemes to VRM morph targets with distinct mouth shapes
  // Vowels drive primary mouth shape
  const vowelIntensity = voiceActivity;
  
  // Target vowel morphs - each vowel gets a distinct shape
  state.targetMorphTargets.a = phonemeScores.a * vowelIntensity;
  state.targetMorphTargets.i = phonemeScores.i * vowelIntensity;
  state.targetMorphTargets.u = phonemeScores.u * vowelIntensity;
  state.targetMorphTargets.e = phonemeScores.e * vowelIntensity;
  state.targetMorphTargets.o = phonemeScores.o * vowelIntensity;

  // Consonant modifications - these override/add to vowel shapes
  // Bilabials (m, b, p) - mouth closed, lips together
  const bilabialWeight = phonemeScores.bilabial * voiceActivity;
  
  // Fricatives (s, z, sh, f) - teeth close, lips spread
  const fricativeWeight = phonemeScores.fricative * voiceActivity;
  
  // Dental (t, d, n) - tongue up, slight mouth open
  const dentalWeight = phonemeScores.dental * voiceActivity;

  // Smooth morph target transitions - adaptive smoothing based on phoneme type
  // Vowels: slower smoothing for natural transitions
  // Consonants: faster for crisp articulation
  const vowelSmoothing = 0.15;
  const consonantSmoothing = 0.35;

  // Apply vowel morphs
  ["a", "i", "u", "e", "o"].forEach((key) => {
    state.currentMorphTargets[key] += (state.targetMorphTargets[key] - state.currentMorphTargets[key]) * vowelSmoothing;
    const expr = state.vrm.expressionManager?.getExpression(key);
    if (expr) {
      expr.weight = state.currentMorphTargets[key];
    }
  });

  // Handle jaw opening - base on voice activity, modified by consonants
  // Bilabials reduce jaw open, fricatives increase it slightly
  let jawOpen = voiceActivity * 1.8;
  
  // Reduce jaw for bilabials (m, b, p - lips closed)
  jawOpen *= (1 - bilabialWeight * 0.7);
  
  // Slight increase for fricatives (s, f - teeth apart)
  jawOpen += fricativeWeight * 0.2;
  
  // Dental consonants (t, d, n) - moderate jaw
  jawOpen = Math.max(jawOpen, dentalWeight * 0.4);
  
  jawOpen = Math.min(jawOpen, 1);

  const jawExpr = state.vrm.expressionManager?.getExpression("jawOpen") || state.vrm.expressionManager?.getExpression("aa");
  if (jawExpr) {
    // Smooth jaw movement
    jawExpr.weight += (jawOpen - jawExpr.weight) * 0.25;
  }

  // Apply consonant-specific mouth shapes
  // Bilabial: narrow mouth (funneled) - use 'u' or 'o' shape with jaw closed
  if (bilabialWeight > 0.3) {
    const uExpr = state.vrm.expressionManager?.getExpression("u");
    const oExpr = state.vrm.expressionManager?.getExpression("o");
    if (uExpr) uExpr.weight = Math.max(uExpr.weight, bilabialWeight * 0.6);
    if (oExpr) oExpr.weight = Math.max(oExpr.weight, bilabialWeight * 0.4);
  }

  // Fricative: spread lips (wide) - enhance 'i' and 'e' shapes
  if (fricativeWeight > 0.3) {
    const iExpr = state.vrm.expressionManager?.getExpression("i");
    const eExpr = state.vrm.expressionManager?.getExpression("e");
    if (iExpr) iExpr.weight = Math.max(iExpr.weight, fricativeWeight * 0.5);
    if (eExpr) eExpr.weight = Math.max(eExpr.weight, fricativeWeight * 0.4);
  }
}

