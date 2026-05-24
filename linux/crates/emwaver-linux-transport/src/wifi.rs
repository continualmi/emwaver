use crate::{TransportError, TransportResult};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManualWifiTarget {
    pub host: String,
    pub port: u16,
}

impl ManualWifiTarget {
    pub fn new(host: impl Into<String>, port: u16) -> TransportResult<Self> {
        let host = host.into();
        let invalid = host.trim().is_empty()
            || host.contains("://")
            || host.contains('/')
            || host
                .rsplit_once(':')
                .is_some_and(|(_, suffix)| suffix.parse::<u16>().is_ok());
        if invalid {
            return Err(TransportError::Fixture(
                "manual Wi-Fi host must be a bare hostname or IP".to_string(),
            ));
        }
        Ok(Self { host, port })
    }
}

#[derive(Default, Debug)]
pub struct LinuxWifiManager;

impl LinuxWifiManager {
    pub fn discover_mdns(&self) -> TransportResult<Vec<ManualWifiTarget>> {
        Err(TransportError::NotImplemented(
            "Wi-Fi mDNS discovery and WebSocket transport",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_wifi_rejects_urlish_hosts() {
        assert!(ManualWifiTarget::new("ws://emwaver.local", 3922).is_err());
        assert!(ManualWifiTarget::new("emwaver.local:3922", 3922).is_err());
        assert!(ManualWifiTarget::new("emwaver.local", 3922).is_ok());
    }
}
