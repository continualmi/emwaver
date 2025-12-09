/**
 * SamplerBuffer - Manages signal buffer for sampler functionality
 * Mirrors the Android native buffer implementation
 */

export class SamplerBuffer {
  private buffer: Uint8Array = new Uint8Array(0);
  private maxSize: number = 393216; // ~30 seconds at 10μs per sample (default from Android)

  /**
   * Append data to the buffer
   */
  append(data: Uint8Array): void {
    const newSize = this.buffer.length + data.length;
    if (newSize > this.maxSize) {
      // Truncate to max size
      const remaining = this.maxSize - this.buffer.length;
      if (remaining > 0) {
        const newBuffer = new Uint8Array(this.maxSize);
        newBuffer.set(this.buffer);
        newBuffer.set(data.slice(0, remaining), this.buffer.length);
        this.buffer = newBuffer;
      }
    } else {
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(this.buffer);
      newBuffer.set(data, this.buffer.length);
      this.buffer = newBuffer;
    }
  }

  /**
   * Get the current buffer
   */
  getBuffer(): Uint8Array {
    return this.buffer.slice();
  }

  /**
   * Get buffer length
   */
  getBufferLength(): number {
    return this.buffer.length;
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = new Uint8Array(0);
  }

  /**
   * Load data into buffer
   */
  loadBuffer(data: Uint8Array): void {
    this.buffer = data.slice();
  }

  /**
   * Set maximum buffer size
   */
  setMaxSize(size: number): void {
    this.maxSize = size;
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(0, this.maxSize);
    }
  }

  /**
   * Compress data bits for display
   * Matches the C++ native-lib.cpp compressDataBits implementation exactly
   */
  compressDataBits(rangeStart: number, rangeEnd: number, numberBins: number): {
    timeValues: number[];
    dataValues: number[];
  } {
    const timePerSample = 1.0;
    const totalPointsInRange = (rangeEnd - rangeStart) / timePerSample;
    const timeValues: number[] = [];
    const dataValues: number[] = [];

    // If zoomed in (fewer points than bins * 2), show raw data
    if (totalPointsInRange <= numberBins * 2) {
      for (let i = Math.floor(rangeStart); i < Math.floor(rangeEnd); i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        if (byteIndex < this.buffer.length) {
          const bit = (this.buffer[byteIndex] >> bitIndex) & 1;
          timeValues.push(i * timePerSample);
          dataValues.push(bit ? 255.0 : 0.0);
        }
      }
    } else {
      // Zoomed out: bin and return min/max pairs (2 points per bin)
      const binWidth = totalPointsInRange / numberBins;
      for (let bin = 0; bin < numberBins; bin++) {
        const binStart = Math.floor(rangeStart + bin * binWidth);
        const binEnd = Math.min(Math.floor(binStart + binWidth), Math.floor(rangeEnd));

        let foundData = false;
        let minVal = 255.0;
        let maxVal = 0.0;

        for (let i = binStart; i < binEnd; i++) {
          const byteIndex = Math.floor(i / 8);
          const bitIndex = i % 8;
          if (byteIndex < this.buffer.length) {
            const bit = (this.buffer[byteIndex] >> bitIndex) & 1;
            const value = bit ? 255.0 : 0.0;
            minVal = Math.min(minVal, value);
            maxVal = Math.max(maxVal, value);
            foundData = true;
          }
        }

        if (foundData) {
          timeValues.push(binStart * timePerSample);
          dataValues.push(minVal);
          timeValues.push((binEnd - 1) * timePerSample);
          dataValues.push(maxVal);
        }
      }
    }

    return { timeValues, dataValues };
  }

  /**
   * Build signed raw timings string (for Get Timings feature)
   */
  buildSignedRawTimings(): string {
    if (this.buffer.length === 0) {
      return "";
    }

    const timings: string[] = [];
    let currentState = (this.buffer[0] & 0x01) !== 0;
    let count = 0;
    const totalBits = this.buffer.length * 8;

    for (let i = 0; i < totalBits; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      const bit = ((this.buffer[byteIndex] >> bitIndex) & 1) !== 0;

      if (bit === currentState) {
        count++;
      } else {
        if (count > 0) {
          const microseconds = count * 10;
          if (!currentState) {
            timings.push(`-${microseconds}`);
          } else {
            timings.push(`${microseconds}`);
          }
        }
        currentState = bit;
        count = 1;
      }
    }

    // Append final timing
    if (count > 0) {
      const microseconds = count * 10;
      if (!currentState) {
        timings.push(`-${microseconds}`);
      } else {
        timings.push(`${microseconds}`);
      }
    }

    return timings.join(" ");
  }
}
