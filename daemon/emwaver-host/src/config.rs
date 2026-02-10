#[derive(Debug, Clone)]
pub struct Config {
    pub backend_base_url: String,
    pub id_token: Option<String>,
    pub host_session_id: String,
}
