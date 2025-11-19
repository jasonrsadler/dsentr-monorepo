use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde_json::Value;
use sqlx::{PgPool, Row};
#[cfg(not(test))]
use tracing::{debug, warn};
use tracing::{error, info};
use uuid::Uuid;

use crate::utils::schedule::{offset_to_utc, utc_to_offset};

#[cfg(test)]
use std::sync::OnceLock;
#[derive(Clone, Debug)]
pub struct SessionData {
    pub user_id: Uuid,
    pub data: Value,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub is_verified: bool,
}

pub static SESSION_CACHE: Lazy<DashMap<Uuid, SessionData>> = Lazy::new(DashMap::new);

#[cfg(test)]
static TEST_SESSION_STORE: OnceLock<DashMap<Uuid, SessionData>> = OnceLock::new();

#[cfg(test)]
fn test_session_store() -> &'static DashMap<Uuid, SessionData> {
    TEST_SESSION_STORE.get_or_init(DashMap::new)
}

#[cfg(test)]
fn build_in_memory_session(user_id: Uuid, data: Value, ttl_hours: i64) -> SessionData {
    let now = Utc::now();
    SessionData {
        user_id,
        data,
        created_at: now,
        expires_at: now + Duration::hours(ttl_hours.max(1)),
        is_verified: true,
    }
}

#[cfg(test)]
fn cache_test_session(session_id: Uuid, session: SessionData) -> SessionData {
    test_session_store().insert(session_id, session.clone());
    SESSION_CACHE.insert(session_id, session.clone());
    session
}

#[cfg(test)]
fn get_in_memory_session(session_id: Uuid) -> Option<SessionData> {
    if let Some(cached) = SESSION_CACHE.get(&session_id) {
        if cached.expires_at > Utc::now() {
            return Some(cached.clone());
        }

        drop(cached);
        SESSION_CACHE.remove(&session_id);
    }

    let store = test_session_store();
    if let Some(entry) = store.get(&session_id) {
        if entry.expires_at > Utc::now() {
            let session = entry.clone();
            drop(entry);
            SESSION_CACHE.insert(session_id, session.clone());
            Some(session)
        } else {
            drop(entry);
            store.remove(&session_id);
            None
        }
    } else {
        None
    }
}

#[cfg(test)]
fn delete_in_memory_session(session_id: Uuid) -> bool {
    let mut removed = SESSION_CACHE.remove(&session_id).is_some();
    if let Some(store) = TEST_SESSION_STORE.get() {
        removed |= store.remove(&session_id).is_some();
    }
    removed
}

#[cfg(test)]
pub fn reset_test_sessions() {
    if let Some(store) = TEST_SESSION_STORE.get() {
        store.clear();
    }
    SESSION_CACHE.clear();
}

#[cfg(test)]
pub fn insert_test_session(session_id: Uuid, session: SessionData) {
    cache_test_session(session_id, session);
}

pub async fn create_session(
    pool: &PgPool,
    user_id: Uuid,
    data: Value,
    ttl_hours: i64,
) -> Result<(Uuid, SessionData), sqlx::Error> {
    #[cfg(test)]
    {
        let _ = pool;
        let session_id = Uuid::new_v4();
        let session = build_in_memory_session(user_id, data, ttl_hours);
        let session = cache_test_session(session_id, session);
        Ok((session_id, session))
    }

    #[cfg(not(test))]
    {
        let session_id = Uuid::new_v4();
        persist_session(pool, session_id, user_id, data, ttl_hours)
            .await
            .map(|session| (session_id, session))
    }
}

pub async fn get_session(
    pool: &PgPool,
    session_id: Uuid,
) -> Result<Option<SessionData>, sqlx::Error> {
    #[cfg(test)]
    {
        let _ = pool;
        Ok(get_in_memory_session(session_id))
    }

    #[cfg(not(test))]
    {
        if let Some(cached) = SESSION_CACHE.get(&session_id) {
            if cached.expires_at > Utc::now() {
                debug!(%session_id, "Session cache hit");
                return Ok(Some(cached.clone()));
            }

            debug!(%session_id, "Cached session expired, evicting");
            SESSION_CACHE.remove(&session_id);
        } else {
            debug!(%session_id, "Session cache miss");
        }

        match sqlx::query(
            r#"
            SELECT user_id, data, expires_at, created_at
            FROM user_sessions
            WHERE id = $1
            "#,
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
        {
            Ok(Some(record)) => {
                let expires_at_offset: time::OffsetDateTime = match record.try_get("expires_at") {
                    Ok(value) => value,
                    Err(error) => {
                        error!(?error, %session_id, "Failed to read expires_at from session row");
                        return Err(error);
                    }
                };
                let expires_at = match offset_to_utc(expires_at_offset) {
                    Some(value) => value,
                    None => {
                        error!(%session_id, "Failed to convert stored expiration timestamp");
                        return Err(sqlx::Error::Protocol(
                            "failed to convert session expiration from Postgres".to_string(),
                        ));
                    }
                };

                if expires_at <= Utc::now() {
                    warn!(%session_id, "Session expired in storage, removing");
                    if let Err(error) = delete_session(pool, session_id).await {
                        error!(%session_id, error = ?error, "Failed to purge expired session");
                    }
                    return Ok(None);
                }

                let created_at_offset: time::OffsetDateTime = match record.try_get("created_at") {
                    Ok(value) => value,
                    Err(error) => {
                        error!(?error, %session_id, "Failed to read created_at from session row");
                        return Err(error);
                    }
                };
                let created_at = match offset_to_utc(created_at_offset) {
                    Some(value) => value,
                    None => {
                        error!(%session_id, "Failed to convert stored created_at timestamp");
                        return Err(sqlx::Error::Protocol(
                            "failed to convert session created_at from Postgres".to_string(),
                        ));
                    }
                };

                let user_id: Uuid = match record.try_get("user_id") {
                    Ok(value) => value,
                    Err(error) => {
                        error!(?error, %session_id, "Failed to read user_id from session row");
                        return Err(error);
                    }
                };

                let data: Value = match record.try_get("data") {
                    Ok(value) => value,
                    Err(error) => {
                        error!(?error, %session_id, "Failed to read session payload");
                        return Err(error);
                    }
                };

                let is_verified = data
                    .get("is_verified")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let session = SessionData {
                    user_id,
                    data,
                    expires_at,
                    created_at,
                    is_verified,
                };
                SESSION_CACHE.insert(session_id, session.clone());
                debug!(%session_id, "Session cache refreshed from Postgres");

                Ok(Some(session))
            }
            Ok(None) => Ok(None),
            Err(error) => {
                error!(%session_id, error = ?error, "Failed to load session from Postgres");
                Err(error)
            }
        }
    }
}

pub async fn upsert_session(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Uuid,
    data: Value,
    ttl_hours: i64,
) -> Result<SessionData, sqlx::Error> {
    #[cfg(test)]
    {
        let _ = pool;
        let session = build_in_memory_session(user_id, data, ttl_hours);
        let session = cache_test_session(session_id, session);
        Ok(session)
    }

    #[cfg(not(test))]
    {
        persist_session(pool, session_id, user_id, data, ttl_hours).await
    }
}

pub async fn delete_session(pool: &PgPool, session_id: Uuid) -> Result<bool, sqlx::Error> {
    #[cfg(test)]
    {
        let _ = pool;
        Ok(delete_in_memory_session(session_id))
    }

    #[cfg(not(test))]
    {
        let removed = SESSION_CACHE.remove(&session_id).is_some();

        match sqlx::query("DELETE FROM user_sessions WHERE id = $1")
            .bind(session_id)
            .execute(pool)
            .await
        {
            Ok(result) => {
                let deleted = result.rows_affected() > 0;

                if deleted {
                    info!(%session_id, "Deleted session from cache and Postgres");
                } else if removed {
                    warn!(%session_id, "Session missing from Postgres but removed from cache");
                } else {
                    debug!(%session_id, "No session found to delete");
                }

                Ok(deleted)
            }
            Err(error) => {
                error!(%session_id, error = ?error, "Failed to delete session");
                Err(error)
            }
        }
    }
}

#[cfg_attr(test, allow(dead_code))]
async fn persist_session(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Uuid,
    data: Value,
    ttl_hours: i64,
) -> Result<SessionData, sqlx::Error> {
    let expires_at = Utc::now() + Duration::hours(ttl_hours);
    let expires_at_offset = match utc_to_offset(expires_at) {
        Some(value) => value,
        None => {
            error!(
                %session_id,
                %user_id,
                "Failed to convert expiration timestamp to OffsetDateTime"
            );
            return Err(sqlx::Error::Protocol(
                "failed to convert expiration timestamp to OffsetDateTime".to_string(),
            ));
        }
    };

    match sqlx::query(
        r#"
        INSERT INTO user_sessions (id, user_id, data, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            data = EXCLUDED.data,
            expires_at = EXCLUDED.expires_at
        RETURNING user_id, data, expires_at, created_at
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(data.clone())
    .bind(expires_at_offset)
    .fetch_one(pool)
    .await
    {
        Ok(record) => {
            let expires_at_offset: time::OffsetDateTime = match record.try_get("expires_at") {
                Ok(value) => value,
                Err(error) => {
                    error!(
                        %session_id,
                        %user_id,
                        ?error,
                        "Failed to read expires_at from persisted session"
                    );
                    return Err(error);
                }
            };
            let expires_at = match offset_to_utc(expires_at_offset) {
                Some(value) => value,
                None => {
                    error!(
                        %session_id,
                        %user_id,
                        "Failed to convert stored expiration timestamp"
                    );
                    return Err(sqlx::Error::Protocol(
                        "failed to convert session expiration from Postgres".to_string(),
                    ));
                }
            };
            let created_at_offset: time::OffsetDateTime = match record.try_get("created_at") {
                Ok(value) => value,
                Err(error) => {
                    error!(
                        %session_id,
                        %user_id,
                        ?error,
                        "Failed to read created_at from persisted session"
                    );
                    return Err(error);
                }
            };
            let created_at = match offset_to_utc(created_at_offset) {
                Some(value) => value,
                None => {
                    error!(%session_id, %user_id, "Failed to convert stored created_at timestamp");
                    return Err(sqlx::Error::Protocol(
                        "failed to convert session created_at from Postgres".to_string(),
                    ));
                }
            };
            let db_user_id: Uuid = match record.try_get("user_id") {
                Ok(value) => value,
                Err(error) => {
                    error!(
                        %session_id,
                        %user_id,
                        ?error,
                        "Failed to read user_id from persisted session"
                    );
                    return Err(error);
                }
            };
            let db_data: Value = match record.try_get("data") {
                Ok(value) => value,
                Err(error) => {
                    error!(
                        %session_id,
                        %user_id,
                        ?error,
                        "Failed to read session payload from persisted session"
                    );
                    return Err(error);
                }
            };
            let is_verified = db_data
                .get("is_verified")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let session = SessionData {
                user_id: db_user_id,
                data: db_data,
                expires_at,
                created_at,
                is_verified,
            };

            SESSION_CACHE.insert(session_id, session.clone());
            info!(%session_id, %user_id, "Persisted session and cached value");

            Ok(session)
        }
        Err(error) => {
            error!(%session_id, %user_id, error = ?error, "Failed to persist session");
            Err(error)
        }
    }
}
