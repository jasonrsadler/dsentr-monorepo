use async_trait::async_trait;

use crate::services::oauth::google::client::GoogleOAuthClient;

#[derive(Clone)]
pub struct MockGoogleOAuthClient;

impl MockGoogleOAuthClient {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl GoogleOAuthClient for MockGoogleOAuthClient {
    async fn list_worksheets(
        &self,
        _access_token: &str,
        _spreadsheet_id: &str,
    ) -> Result<Vec<String>, String> {
        Ok(vec![]) // harmless no-op
    }
}
