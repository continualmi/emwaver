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
    // Match C++: if (totalPointsInRange <= numberBins * 2)
    if (totalPointsInRange <= numberBins * 2) {
      // Match C++: for (int i = rangeStart; i < rangeEnd; ++i)
      for (let i = rangeStart; i < rangeEnd; i++) {
        // Match C++: int byteIndex = i / 8; int bitIndex = i % 8;
        const byteIndex = Math.floor(i / 8);
        const bitIndex = i % 8;
        if (byteIndex < this.buffer.length) {
          // Match C++: uint8_t bit = (ble_buffer[byteIndex] >> bitIndex) & 1;
          const bit = (this.buffer[byteIndex] >> bitIndex) & 1;
          // Match C++: timeValues.push_back(static_cast<float>(i * timePerSample));
          timeValues.push(i * timePerSample);
          // Match C++: dataValues.push_back(bit ? 255.0f : 0.0f);
          dataValues.push(bit ? 255.0 : 0.0);
        }
      }
    } else {
      // Zoomed out: bin and return min/max pairs (2 points per bin)
      // Match C++ implementation exactly: binWidth = totalPointsInRange / numberBins
      const binWidth = totalPointsInRange / numberBins;
      for (let bin = 0; bin < numberBins; bin++) {
        // Match C++: binStart = static_cast<int>(rangeStart + bin * binWidth)
        const binStart = Math.floor(rangeStart + bin * binWidth);
        // Match C++: binEnd = std::min(static_cast<int>(binStart + binWidth), rangeEnd)
        const binEnd = Math.min(Math.floor(binStart + binWidth), rangeEnd);

        let foundData = false;
        let hasLow = false;
        let hasHigh = false;

        // Match C++: for (int i = binStart; i < binEnd; ++i)
        for (let i = binStart; i < binEnd; ) {
          const byteIndex = i >> 3;
          if (byteIndex >= this.buffer.length) break;

          // Optimization: If byte-aligned and we have a full byte to check
          if ((i & 7) === 0 && (i + 8) <= binEnd) {
            const byteVal = this.buffer[byteIndex];
            
            if (byteVal === 0) {
              hasLow = true;
            } else if (byteVal === 255) {
              hasHigh = true;
            } else {
              // Mixed bits means we have both 0 and 1
              hasLow = true;
              hasHigh = true;
            }
            i += 8;
          } else {
            // Process single bit
            const bitIndex = i & 7;
            const bit = (this.buffer[byteIndex] >> bitIndex) & 1;
            
            if (bit) {
              hasHigh = true;
            } else {
              hasLow = true;
            }
            i++;
          }

          // Optimization: If we found both 0 and 1, we know the min is 0 and max is 255.
          // We don't need to scan the rest of this bin.
          if (hasLow && hasHigh) {
            break;
          }
        }

        if (foundData) {
          // Match C++: timeValues.push_back(static_cast<float>(binStart * timePerSample));
          timeValues.push(binStart * timePerSample);
          // Match C++: dataValues.push_back(minVal);
          dataValues.push(hasLow ? 0.0 : 255.0);
          // Match C++: timeValues.push_back(static_cast<float>((binEnd - 1) * timePerSample));
          timeValues.push((binEnd - 1) * timePerSample);
          // Match C++: dataValues.push_back(maxVal);
          dataValues.push(hasHigh ? 255.0 : 0.0);
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
