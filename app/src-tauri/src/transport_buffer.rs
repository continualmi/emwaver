use serde::Serialize;

#[derive(Default)]
pub struct TransportBufferState {
    buffer: Vec<u8>,
    head: usize,
    pub max_size: usize,
    total_bytes: u64,
    version: u64,
}

#[derive(Clone, Serialize)]
pub struct TransportBufferReadResponse {
    pub data: Vec<u8>,
    pub next_offset: u64,
    pub buffer_len_bytes: usize,
    pub version: u64,
}

impl TransportBufferState {
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.head = 0;
        // Keep `total_bytes` monotonic so readers holding an `offset` can continue
        // reading after a clear (they will clamp to the new base offset).
        self.version = self.version.saturating_add(1);
    }

    pub fn len(&self) -> usize {
        self.buffer.len().saturating_sub(self.head)
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn end_offset(&self) -> u64 {
        self.total_bytes
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buffer.get(self.head..).unwrap_or_default().to_vec()
    }

    pub fn set(&mut self, data: Vec<u8>) {
        self.buffer = data;
        self.head = 0;
        // Treat `set()` as a new segment in the same monotonic stream so existing
        // readers can continue from their prior offsets.
        self.total_bytes = self.total_bytes.saturating_add(self.buffer.len() as u64);
        self.version = self.version.saturating_add(1);
        self.enforce_max_size();
    }

    pub fn append(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        self.buffer.extend_from_slice(data);
        self.total_bytes = self.total_bytes.saturating_add(data.len() as u64);
        self.version = self.version.saturating_add(1);

        self.enforce_max_size();
    }

    pub fn read_since(&self, offset: u64, max_bytes: usize) -> TransportBufferReadResponse {
        let buffer_len_bytes = self.len();
        let version = self.version();

        if buffer_len_bytes == 0 || max_bytes == 0 {
            return TransportBufferReadResponse {
                data: Vec::new(),
                next_offset: offset,
                buffer_len_bytes,
                version,
            };
        }

        let base_offset = self.base_offset();
        let start_offset = offset.max(base_offset);
        let start_rel = (start_offset - base_offset) as usize;
        if start_rel >= buffer_len_bytes {
            return TransportBufferReadResponse {
                data: Vec::new(),
                next_offset: start_offset,
                buffer_len_bytes,
                version,
            };
        }

        let start_index = self.head + start_rel;
        let available = self.buffer.len().saturating_sub(start_index);
        let count = available.min(max_bytes);
        let end_index = start_index + count;
        let data = self.buffer.get(start_index..end_index).unwrap_or_default().to_vec();
        let next_offset = start_offset.saturating_add(data.len() as u64);

        TransportBufferReadResponse {
            data,
            next_offset,
            buffer_len_bytes,
            version,
        }
    }

    fn base_offset(&self) -> u64 {
        self.total_bytes.saturating_sub(self.len() as u64)
    }

    fn enforce_max_size(&mut self) {
        if self.max_size == 0 {
            return;
        }

        let len = self.len();
        if len <= self.max_size {
            return;
        }

        let overflow = len - self.max_size;
        self.head = (self.head + overflow).min(self.buffer.len());

        // Periodically compact so head doesn't grow without bound.
        if self.head >= 64 * 1024 && self.head >= (self.buffer.len() / 2) {
            self.buffer.drain(0..self.head);
            self.head = 0;
        }
    }
}
