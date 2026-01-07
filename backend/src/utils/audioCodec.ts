/**
 * Audio Codec Utilities for Twilio ↔ Gemini Audio Transcoding
 *
 * Handles conversion between:
 * - μ-law (G.711) 8kHz (Twilio Media Streams)
 * - PCM 16-bit 24kHz (Gemini 2.0 Live API)
 *
 * Also provides RMS calculation for barge-in detection.
 */

export class AudioCodec {
  // G.711 μ-law constants
  private static readonly BIAS = 0x84;
  private static readonly CLIP = 32635;
  private static readonly MU_LAW_TABLE = AudioCodec.generateMuLawTable();

  /**
   * Generate μ-law lookup table for faster encoding/decoding
   */
  private static generateMuLawTable(): Int16Array {
    const table = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
      const byte = ~i & 0xff;
      const sign = byte & 0x80;
      const exponent = (byte >> 4) & 0x07;
      const mantissa = byte & 0x0f;
      let sample = ((mantissa << 3) + 0x84) << exponent;
      sample -= AudioCodec.BIAS;
      table[i] = sign ? -sample : sample;
    }
    return table;
  }

  /**
   * Convert linear PCM (16-bit signed) to μ-law
   */
  static pcm2ulaw(data: Buffer): Buffer {
    const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
    const ulaw = Buffer.alloc(samples.length);

    for (let i = 0; i < samples.length; i++) {
      let sample = samples[i];
      let sign = 0;

      if (sample < 0) {
        sample = -sample;
        sign = 0x80;
      }

      if (sample > AudioCodec.CLIP) {
        sample = AudioCodec.CLIP;
      }

      sample += AudioCodec.BIAS;

      const exponent = Math.floor(Math.log2(sample)) - 7;
      const mantissa = (sample >> (exponent + 3)) & 0x0f;

      ulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
    }

    return ulaw;
  }

  /**
   * Convert μ-law to linear PCM (16-bit signed)
   */
  static ulaw2pcm(data: Buffer): Buffer {
    const pcm = Buffer.alloc(data.length * 2);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, data.length);

    for (let i = 0; i < data.length; i++) {
      samples[i] = AudioCodec.MU_LAW_TABLE[data[i]];
    }

    return pcm;
  }

  /**
   * Resample audio between different sample rates
   */
  static resample(data: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) {
      return data;
    }

    const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);

    // Optimized 8kHz → 24kHz upsampling (3x)
    if (fromRate === 8000 && toRate === 24000) {
      const output = new Int16Array(samples.length * 3);
      for (let i = 0; i < samples.length - 1; i++) {
        const s1 = samples[i];
        const s2 = samples[i + 1];
        output[i * 3] = s1;
        output[i * 3 + 1] = Math.floor((2 * s1 + s2) / 3);
        output[i * 3 + 2] = Math.floor((s1 + 2 * s2) / 3);
      }
      const lastIdx = samples.length - 1;
      output[lastIdx * 3] = samples[lastIdx];
      output[lastIdx * 3 + 1] = samples[lastIdx];
      output[lastIdx * 3 + 2] = samples[lastIdx];

      return Buffer.from(output.buffer);
    }

    // Optimized 24kHz → 8kHz downsampling (1/3)
    if (fromRate === 24000 && toRate === 8000) {
      const output = new Int16Array(Math.floor(samples.length / 3));
      for (let i = 0; i < output.length; i++) {
        const idx = i * 3;
        const avg = Math.floor((samples[idx] + samples[idx + 1] + samples[idx + 2]) / 3);
        output[i] = avg;
      }
      return Buffer.from(output.buffer);
    }

    // Generic linear interpolation resampling
    const ratio = toRate / fromRate;
    const outputLength = Math.floor(samples.length * ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      const sample1 = samples[srcIndexFloor];
      const sample2 = samples[srcIndexCeil];
      output[i] = Math.floor(sample1 + fraction * (sample2 - sample1));
    }

    return Buffer.from(output.buffer);
  }

  /**
   * Calculate RMS (Root Mean Square) of audio signal
   */
  static calculateRMS(data: Buffer): number {
    const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);

    if (samples.length === 0) {
      return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }

    return Math.sqrt(sumSquares / samples.length);
  }
}

// Export standalone functions for convenience
export const pcm2ulaw = (data: Buffer) => AudioCodec.pcm2ulaw(data);
export const ulaw2pcm = (data: Buffer) => AudioCodec.ulaw2pcm(data);
export const resample = (data: Buffer, fromRate: number, toRate: number) =>
  AudioCodec.resample(data, fromRate, toRate);
export const calculateRMS = (data: Buffer) => AudioCodec.calculateRMS(data);
