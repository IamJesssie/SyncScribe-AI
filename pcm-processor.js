/**
 * ZeroScribe AI - AudioWorklet PCM Processor
 * High-performance, CSP-compliant AudioWorklet for PCM audio extraction
 */

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      if (channelData && channelData.length > 0) {
        this.port.postMessage(channelData);
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
