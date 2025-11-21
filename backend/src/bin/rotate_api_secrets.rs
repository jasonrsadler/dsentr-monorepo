use std::env;

use anyhow::{Context, Result};
use serde_json::{Map, Value};
use sqlx::postgres::PgPoolOptions;

use dsentr_backend::utils::encryption::decode_key;
use dsentr_backend::utils::secrets::{read_secret_store, write_secret_store};

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();

    let database_url =
        env::var("DATABASE_URL").context("DATABASE_URL is required to rotate API secrets")?;
    let old_key_b64 = env::var("OLD_API_SECRETS_ENCRYPTION_KEY")
        .context("OLD_API_SECRETS_ENCRYPTION_KEY must be set to the previous key")?;
    let new_key_b64 = env::var("API_SECRETS_ENCRYPTION_KEY")
        .context("API_SECRETS_ENCRYPTION_KEY must be set to the new key")?;

    let old_key =
        decode_key(&old_key_b64).context("failed to decode OLD_API_SECRETS_ENCRYPTION_KEY")?;
    let new_key =
        decode_key(&new_key_b64).context("failed to decode API_SECRETS_ENCRYPTION_KEY")?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to DATABASE_URL")?;

    let rows = sqlx::query!("SELECT id, settings FROM users")
        .fetch_all(&pool)
        .await
        .context("failed to load user settings")?;

    let mut updated = 0usize;

    for row in rows {
        let user_id = row.id;
        let mut settings = if row.settings.is_null() {
            Value::Object(Map::new())
        } else {
            row.settings
        };

        let (store, hint) = match read_secret_store(&settings, &old_key) {
            Ok(result) => result,
            Err(err) => {
                eprintln!("Skipping user {user_id} due to decrypt error: {err:?}");
                continue;
            }
        };

        if store.is_empty() && !hint.needs_rewrite {
            continue;
        }

        if let Err(err) = write_secret_store(&mut settings, &store, &new_key) {
            eprintln!("Skipping user {user_id} due to encrypt error: {err:?}");
            continue;
        }

        if let Err(err) = sqlx::query!(
            "UPDATE users SET settings = $2, updated_at = now() WHERE id = $1",
            user_id,
            settings
        )
        .execute(&pool)
        .await
        {
            eprintln!("Failed to update user {user_id}: {err:?}");
            continue;
        }

        updated += 1;
    }

    println!("Re-encrypted API secrets for {updated} users");

    Ok(())
}
