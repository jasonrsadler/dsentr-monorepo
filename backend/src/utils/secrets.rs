use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value};
use uuid::Uuid;

pub type SecretStore = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

pub type SecretResponseStore =
    BTreeMap<String, BTreeMap<String, BTreeMap<String, SecretResponseEntry>>>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SecretResponseEntry {
    pub value: String,
    #[serde(rename = "owner_id")]
    pub owner_id: Uuid,
}

const SECRET_PLACEHOLDER: &str = "*****************";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SecretIdentifier {
    pub group: String,
    pub service: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretValidationError {
    EmptyName,
    EmptyValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SecretStoreRead {
    /// True when legacy/plaintext secrets were encountered and should be re-encrypted.
    pub needs_rewrite: bool,
}

const ENCRYPTED_PREFIX: &str = "enc:";

fn decrypt_secret_value(
    key: &[u8],
    value: &str,
) -> Result<(String, SecretStoreRead), crate::utils::encryption::EncryptionError> {
    if let Some(ciphertext) = value.strip_prefix(ENCRYPTED_PREFIX) {
        let decrypted = crate::utils::encryption::decrypt_secret(key, ciphertext)?;
        return Ok((
            decrypted,
            SecretStoreRead {
                needs_rewrite: false,
            },
        ));
    }

    Ok((
        value.to_string(),
        SecretStoreRead {
            needs_rewrite: true,
        },
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretUpsertOutcome {
    Created,
    Updated,
    Unchanged,
}

pub fn read_secret_store(
    settings: &Value,
    key: &[u8],
) -> Result<(SecretStore, SecretStoreRead), crate::utils::encryption::EncryptionError> {
    let mut out: SecretStore = BTreeMap::new();
    let mut needs_rewrite = false;
    let Some(obj) = settings.as_object() else {
        return Ok((out, SecretStoreRead { needs_rewrite }));
    };

    if let Some(secrets) = obj.get("secrets").and_then(Value::as_object) {
        for (group_key, group_value) in secrets {
            let mut group_map: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
            if let Some(service_map) = group_value.as_object() {
                for (service_key, service_value) in service_map {
                    let mut entries: BTreeMap<String, String> = BTreeMap::new();
                    if let Some(entry_obj) = service_value.as_object() {
                        for (name, value) in entry_obj {
                            if let Some(val_str) = value.as_str() {
                                let (plaintext, hint) = decrypt_secret_value(key, val_str)?;
                                needs_rewrite |= hint.needs_rewrite;
                                entries.insert(name.clone(), plaintext);
                            }
                        }
                    }
                    group_map.insert(service_key.clone(), entries);
                }
            }
            out.insert(group_key.clone(), group_map);
        }
    }

    Ok((out, SecretStoreRead { needs_rewrite }))
}

pub fn extend_response_store(
    target: &mut SecretResponseStore,
    store: &SecretStore,
    owner_id: Uuid,
) {
    for (group, services) in store {
        let group_map = target.entry(group.clone()).or_default();
        for (service, entries) in services {
            let service_map = group_map.entry(service.clone()).or_default();
            for name in entries.keys() {
                service_map.insert(
                    name.clone(),
                    SecretResponseEntry {
                        value: SECRET_PLACEHOLDER.to_string(),
                        owner_id,
                    },
                );
            }
        }
    }
}

pub fn to_response_store(store: &SecretStore, owner_id: Uuid) -> SecretResponseStore {
    let mut response = SecretResponseStore::new();
    extend_response_store(&mut response, store, owner_id);
    response
}

pub fn collect_secret_identifiers(store: &SecretStore) -> Vec<SecretIdentifier> {
    let mut identifiers = Vec::new();
    for (group, services) in store {
        for (service, entries) in services {
            for name in entries.keys() {
                identifiers.push(SecretIdentifier {
                    group: group.clone(),
                    service: service.clone(),
                    name: name.clone(),
                });
            }
        }
    }
    identifiers
}

pub fn write_secret_store(
    settings: &mut Value,
    store: &SecretStore,
    key: &[u8],
) -> Result<(), crate::utils::encryption::EncryptionError> {
    if !settings.is_object() {
        *settings = Value::Object(Map::new());
    }
    let obj = settings
        .as_object_mut()
        .expect("settings object initialized");

    let mut groups = Map::new();
    for (group, services) in store {
        let mut service_map = Map::new();
        for (service, entries) in services {
            let mut entry_map = Map::new();
            for (name, value) in entries {
                let ciphertext = crate::utils::encryption::encrypt_secret(key, value)?;
                entry_map.insert(
                    name.clone(),
                    Value::String(format!("{ENCRYPTED_PREFIX}{ciphertext}")),
                );
            }
            service_map.insert(service.clone(), Value::Object(entry_map));
        }
        groups.insert(group.clone(), Value::Object(service_map));
    }

    obj.insert("secrets".to_string(), Value::Object(groups));
    Ok(())
}

pub fn upsert_named_secret(
    store: &mut SecretStore,
    group: &str,
    service: &str,
    name: &str,
    value: &str,
) -> Result<SecretUpsertOutcome, SecretValidationError> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(SecretValidationError::EmptyName);
    }
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return Err(SecretValidationError::EmptyValue);
    }

    let service_map = store
        .entry(group.to_string())
        .or_default()
        .entry(service.to_string())
        .or_default();

    match service_map.get(trimmed_name) {
        Some(existing) if existing == trimmed_value => Ok(SecretUpsertOutcome::Unchanged),
        Some(_) => {
            service_map.insert(trimmed_name.to_string(), trimmed_value.to_string());
            Ok(SecretUpsertOutcome::Updated)
        }
        None => {
            service_map.insert(trimmed_name.to_string(), trimmed_value.to_string());
            Ok(SecretUpsertOutcome::Created)
        }
    }
}

pub fn remove_named_secret(
    store: &mut SecretStore,
    group: &str,
    service: &str,
    name: &str,
) -> bool {
    if let Some(service_map) = store.get_mut(group) {
        if let Some(entries) = service_map.get_mut(service) {
            if entries.remove(name).is_some() {
                if entries.is_empty() {
                    service_map.remove(service);
                }
                if service_map.is_empty() {
                    store.remove(group);
                }
                return true;
            }
        }
        if service_map.is_empty() {
            store.remove(group);
        }
    }
    false
}

pub fn ensure_secret_exists(
    store: &mut SecretStore,
    group: &str,
    service: &str,
    value: &str,
) -> bool {
    let trimmed_value = value.trim();
    if trimmed_value.is_empty() {
        return false;
    }
    let entries = store
        .entry(group.to_string())
        .or_default()
        .entry(service.to_string())
        .or_default();

    if entries.values().any(|existing| existing == trimmed_value) {
        return false;
    }

    let base = format!("auto-{}", slugify(service));
    let mut counter = 1usize;
    loop {
        let candidate = format!("{}-{}", base, counter);
        if let std::collections::btree_map::Entry::Vacant(e) = entries.entry(candidate) {
            e.insert(trimmed_value.to_string());
            return true;
        }
        counter += 1;
    }
}

fn slugify(service: &str) -> String {
    let mut slug: String = service
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if slug.is_empty() {
        slug = "secret".to_string();
    }
    slug
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MessagingSecretKind {
    Slack,
    Teams,
}

fn detect_messaging_secret_kind(candidate: &str) -> Option<MessagingSecretKind> {
    let normalized = candidate.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("slack") {
        return Some(MessagingSecretKind::Slack);
    }
    if normalized.contains("teams") || normalized.contains("microsoft") {
        return Some(MessagingSecretKind::Teams);
    }
    None
}

fn infer_messaging_secret_kind(
    node: &Value,
    data_obj: &Map<String, Value>,
    params: &Map<String, Value>,
) -> Option<MessagingSecretKind> {
    let mut candidates: Vec<&str> = Vec::new();

    for key in ["platform", "service", "provider"] {
        if let Some(value) = params.get(key).and_then(Value::as_str) {
            candidates.push(value);
        }
    }

    for key in ["nodeType", "actionKey", "actionType", "label"] {
        if let Some(value) = data_obj.get(key).and_then(Value::as_str) {
            candidates.push(value);
        }
    }

    if let Some(kind) = node.get("type").and_then(Value::as_str) {
        candidates.push(kind);
    }

    candidates
        .into_iter()
        .find_map(detect_messaging_secret_kind)
}

pub fn collect_workflow_secrets(data: &Value) -> Vec<(String, String, String)> {
    let mut collected: Vec<(String, String, String)> = Vec::new();
    let Some(nodes) = data.get("nodes").and_then(Value::as_array) else {
        return collected;
    };

    for node in nodes {
        let node_type = node.get("type").and_then(Value::as_str).unwrap_or("");
        if node_type != "action" {
            continue;
        }
        let Some(data_obj) = node.get("data").and_then(Value::as_object) else {
            continue;
        };
        let params = data_obj.get("params").and_then(Value::as_object);
        let action_type = data_obj
            .get("actionType")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();

        match action_type.as_str() {
            "email" => {
                if let Some(params) = params {
                    if let Some(service) = params
                        .get("service")
                        .and_then(Value::as_str)
                        .map(|s| s.to_lowercase())
                    {
                        match service.as_str() {
                            "mailgun" => push_if_some(
                                &mut collected,
                                "email",
                                "mailgun",
                                params.get("apiKey"),
                            ),
                            "sendgrid" => push_if_some(
                                &mut collected,
                                "email",
                                "sendgrid",
                                params.get("apiKey"),
                            ),
                            "smtp" => push_if_some(
                                &mut collected,
                                "email",
                                "smtp",
                                params.get("smtpPassword"),
                            ),
                            "amazon ses" => push_if_some(
                                &mut collected,
                                "email",
                                "amazon_ses",
                                params.get("awsSecretKey"),
                            ),
                            _ => {}
                        }
                    }
                }
            }
            "messaging" => {
                if let Some(params) = params {
                    match infer_messaging_secret_kind(node, data_obj, params) {
                        Some(MessagingSecretKind::Slack) => {
                            push_if_some(&mut collected, "messaging", "slack", params.get("token"));
                        }
                        Some(MessagingSecretKind::Teams) => {
                            if params
                                .get("workflowOption")
                                .and_then(Value::as_str)
                                .map(|s| s.eq_ignore_ascii_case("Header Secret Auth"))
                                .unwrap_or(false)
                            {
                                push_if_some(
                                    &mut collected,
                                    "messaging",
                                    "teams",
                                    params.get("workflowHeaderSecret"),
                                );
                            }
                        }
                        None => {}
                    }
                }
            }
            "webhook" => {
                if let Some(params) = params {
                    let auth_type = params
                        .get("authType")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_lowercase();
                    match auth_type.as_str() {
                        "basic" => push_if_some(
                            &mut collected,
                            "webhook",
                            "basic_auth",
                            params.get("authPassword"),
                        ),
                        "bearer" => push_if_some(
                            &mut collected,
                            "webhook",
                            "bearer_token",
                            params.get("authToken"),
                        ),
                        _ => {}
                    }
                }
            }
            "http" => {
                if let Some(params) = params {
                    let auth_type = params
                        .get("authType")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_lowercase();
                    match auth_type.as_str() {
                        "basic" => push_if_some(
                            &mut collected,
                            "http",
                            "basic_auth",
                            params.get("password"),
                        ),
                        "bearer" => push_if_some(
                            &mut collected,
                            "http",
                            "bearer_token",
                            params.get("token"),
                        ),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    collected
}

fn push_if_some(
    collected: &mut Vec<(String, String, String)>,
    group: &str,
    service: &str,
    value: Option<&Value>,
) {
    if let Some(val) = value.and_then(Value::as_str) {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            collected.push((group.to_string(), service.to_string(), trimmed.to_string()));
        }
    }
}

pub fn hydrate_secrets_into_snapshot(snapshot: &mut Value, secret_store: &SecretStore) {
    fn hydrate_value(v: &mut Value, store: &SecretStore) {
        match v {
            Value::String(s) => {
                // Must match EXACTLY group:service:name with no extra parts.
                let mut parts = s.split(':');
                let g = parts.next();
                let s2 = parts.next();
                let n = parts.next();
                let extra = parts.next();

                if let (Some(group), Some(service), Some(name), None) = (g, s2, n, extra) {
                    if let Some(svc_map) = store.get(group) {
                        if let Some(entries) = svc_map.get(service) {
                            if let Some(plaintext) = entries.get(name) {
                                *v = Value::String(plaintext.clone());
                            }
                        }
                    }
                }
            }
            Value::Object(map) => {
                for (_k, val) in map.iter_mut() {
                    hydrate_value(val, store);
                }
            }
            Value::Array(arr) => {
                for elem in arr.iter_mut() {
                    hydrate_value(elem, store);
                }
            }
            _ => {}
        }
    }

    hydrate_value(snapshot, secret_store);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypts_and_decrypts_secret_store() {
        let key = vec![7u8; 32];
        let mut store = SecretStore::new();
        store
            .entry("email".into())
            .or_default()
            .entry("smtp".into())
            .or_default()
            .insert("primary".into(), "secret".into());

        let mut settings = Value::Null;
        write_secret_store(&mut settings, &store, &key).expect("encryption should succeed");

        let stored_value = settings["secrets"]["email"]["smtp"]["primary"]
            .as_str()
            .expect("ciphertext persisted");
        assert!(
            stored_value.starts_with("enc:"),
            "value should be encrypted"
        );
        assert_ne!(stored_value, "secret");

        let (round_tripped, hint) =
            read_secret_store(&settings, &key).expect("decryption should succeed");
        assert!(!hint.needs_rewrite);
        assert_eq!(
            round_tripped
                .get("email")
                .and_then(|grp| grp.get("smtp"))
                .and_then(|svc| svc.get("primary"))
                .map(String::as_str),
            Some("secret")
        );
    }

    #[test]
    fn plaintext_secrets_signal_rewrite() {
        let key = vec![9u8; 32];
        let settings = serde_json::json!({
            "secrets": {
                "messaging": {
                    "slack": { "primary": "token" }
                }
            }
        });

        let (store, hint) =
            read_secret_store(&settings, &key).expect("plaintext parsing should not fail");
        assert!(hint.needs_rewrite);
        assert_eq!(
            store
                .get("messaging")
                .and_then(|svc| svc.get("slack"))
                .and_then(|entries| entries.get("primary"))
                .map(String::as_str),
            Some("token")
        );
    }

    #[test]
    fn ensure_secret_exists_generates_unique_names() {
        let mut store = SecretStore::new();
        assert!(ensure_secret_exists(
            &mut store, "email", "mailgun", "abc123"
        ));
        assert!(ensure_secret_exists(
            &mut store, "email", "mailgun", "def456"
        ));
        assert!(!ensure_secret_exists(
            &mut store, "email", "mailgun", "abc123"
        ));
        let names: Vec<_> = store
            .get("email")
            .unwrap()
            .get("mailgun")
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(names.len(), 2);
        assert!(names.iter().any(|k| k.starts_with("auto-mailgun")));
    }

    #[test]
    fn upsert_named_secret_handles_updates() {
        let mut store = SecretStore::new();
        let outcome =
            upsert_named_secret(&mut store, "messaging", "slack", "primary", "token1").unwrap();
        assert_eq!(outcome, SecretUpsertOutcome::Created);
        let outcome =
            upsert_named_secret(&mut store, "messaging", "slack", "primary", "token1").unwrap();
        assert_eq!(outcome, SecretUpsertOutcome::Unchanged);
        let outcome =
            upsert_named_secret(&mut store, "messaging", "slack", "primary", "token2").unwrap();
        assert_eq!(outcome, SecretUpsertOutcome::Updated);
        let value = store
            .get("messaging")
            .unwrap()
            .get("slack")
            .unwrap()
            .get("primary")
            .unwrap();
        assert_eq!(value, "token2");
    }

    #[test]
    fn to_response_store_masks_values_and_preserves_owner() {
        let mut store = SecretStore::new();
        store
            .entry("email".into())
            .or_default()
            .entry("smtp".into())
            .or_default()
            .insert("primary".into(), "secret".into());

        let owner = Uuid::new_v4();
        let response = to_response_store(&store, owner);

        let entry = response
            .get("email")
            .and_then(|group| group.get("smtp"))
            .and_then(|svc| svc.get("primary"))
            .expect("entry exists");
        assert_eq!(entry.value, "*****************");
        assert_eq!(entry.owner_id, owner);
    }

    #[test]
    fn collect_secret_identifiers_returns_all_entries() {
        let mut store = SecretStore::new();
        let services = store.entry("email".into()).or_default();
        services
            .entry("smtp".into())
            .or_default()
            .extend([("primary".into(), "secret".into())]);
        services
            .entry("sendgrid".into())
            .or_default()
            .extend([("secondary".into(), "value".into())]);

        let identifiers = collect_secret_identifiers(&store);
        assert_eq!(identifiers.len(), 2);
        assert!(identifiers
            .iter()
            .any(|id| { id.group == "email" && id.service == "smtp" && id.name == "primary" }));
        assert!(identifiers.iter().any(|id| {
            id.group == "email" && id.service == "sendgrid" && id.name == "secondary"
        }));
    }

    #[test]
    fn collect_workflow_secrets_finds_values() {
        let workflow = serde_json::json!({
            "nodes": [
                {
                    "type": "action",
                    "data": {
                        "actionType": "email",
                        "params": { "service": "Mailgun", "apiKey": "key-1" }
                    }
                },
                {
                    "type": "action",
                    "data": {
                        "actionType": "messaging",
                        "params": {
                            "service": "Slack",
                            "token": "slack-token"
                        }
                    }
                },
                {
                    "type": "action",
                    "data": {
                        "actionType": "webhook",
                        "params": {
                            "authType": "basic",
                            "authPassword": "secret"
                        }
                    }
                }
            ]
        });

        let mut secrets = collect_workflow_secrets(&workflow);
        secrets.sort();
        assert_eq!(secrets.len(), 3);
        assert!(secrets.contains(&(
            "email".to_string(),
            "mailgun".to_string(),
            "key-1".to_string()
        )));
        assert!(secrets.contains(&(
            "messaging".to_string(),
            "slack".to_string(),
            "slack-token".to_string()
        )));
        assert!(secrets.contains(&(
            "webhook".to_string(),
            "basic_auth".to_string(),
            "secret".to_string()
        )));
    }

    #[test]
    fn collect_workflow_secrets_detects_messaging_service_without_platform() {
        let workflow = serde_json::json!({
            "nodes": [
                {
                    "type": "action",
                    "data": {
                        "actionType": "messaging",
                        "label": "Teams alert",
                        "params": {
                            "service": "Microsoft Teams",
                            "workflowOption": "Header Secret Auth",
                            "workflowHeaderSecret": "teams-secret"
                        }
                    }
                }
            ]
        });

        let secrets = collect_workflow_secrets(&workflow);
        assert_eq!(secrets.len(), 1);
        assert!(secrets.contains(&(
            "messaging".to_string(),
            "teams".to_string(),
            "teams-secret".to_string()
        )));
    }
}
