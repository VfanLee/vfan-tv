use crate::infrastructure::network::NetworkMode;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StreamType {
    Hls,
    Flv,
    Mpegts,
    Native,
}

#[derive(Deserialize)]
pub struct Candidate {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInput {
    pub candidates: Vec<Candidate>,
    pub source_id: Option<String>,
    #[serde(default)]
    pub network_mode: NetworkMode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackTarget {
    pub src: String,
    pub stream_type: StreamType,
    pub media_session_id: String,
    pub selected_candidate_id: String,
    pub selected_candidate_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub media_session_id: String,
    pub original_url: String,
    pub final_url: Option<String>,
    pub stream_type: StreamType,
    pub network: String,
    pub created_at: u64,
}
