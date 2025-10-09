use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatConfig {
    pub every: i64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub start_time: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    #[serde(default)]
    pub repeat: Option<RepeatConfig>,
}

fn default_timezone() -> String {
    "UTC".to_string()
}

fn parse_timezone(tz: &str) -> Option<Tz> {
    if tz.trim().is_empty() {
        return Some(chrono_tz::UTC);
    }
    tz.parse::<Tz>().ok()
}

fn parse_start_naive(config: &ScheduleConfig) -> Option<NaiveDateTime> {
    let date = NaiveDate::parse_from_str(config.start_date.trim(), "%Y-%m-%d").ok()?;
    let time_str = if config.start_time.trim().is_empty() {
        "00:00"
    } else {
        config.start_time.trim()
    };
    let time = NaiveTime::parse_from_str(time_str, "%H:%M").ok()?;
    Some(NaiveDateTime::new(date, time))
}

pub fn parse_start_datetime(config: &ScheduleConfig) -> Option<DateTime<Utc>> {
    let naive = parse_start_naive(config)?;
    let tz = parse_timezone(&config.timezone)?;
    // Handle ambiguous transitions by picking the earliest valid time
    let localized = tz
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| tz.from_local_datetime(&naive).latest())?;
    Some(localized.with_timezone(&Utc))
}

fn normalize_repeat(config: &ScheduleConfig) -> Option<(i64, RepeatUnit)> {
    let repeat = config.repeat.as_ref()?;
    if repeat.every <= 0 {
        return None;
    }
    let unit = RepeatUnit::from_str(&repeat.unit)?;
    Some((repeat.every, unit))
}

#[derive(Debug, Clone, Copy)]
enum RepeatUnit {
    Minutes,
    Hours,
    Days,
    Weeks,
}

impl RepeatUnit {
    fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "minute" | "minutes" => Some(Self::Minutes),
            "hour" | "hours" => Some(Self::Hours),
            "day" | "days" => Some(Self::Days),
            "week" | "weeks" => Some(Self::Weeks),
            _ => None,
        }
    }

    fn to_duration(self, every: i64) -> Option<Duration> {
        let every = every.max(1);
        Some(match self {
            Self::Minutes => Duration::minutes(every),
            Self::Hours => Duration::hours(every),
            Self::Days => Duration::days(every),
            Self::Weeks => Duration::weeks(every),
        })
    }
}

fn add_interval(dt: DateTime<Utc>, every: i64, unit: RepeatUnit) -> Option<DateTime<Utc>> {
    let duration = unit.to_duration(every)?;
    dt.checked_add_signed(duration)
}

pub fn compute_next_run(
    config: &ScheduleConfig,
    last_run: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let start = parse_start_datetime(config)?;
    if let Some(last) = last_run {
        if let Some((every, unit)) = normalize_repeat(config) {
            let mut candidate = add_interval(last, every, unit)?;
            if candidate < start {
                candidate = start;
            }
            while candidate < now {
                candidate = add_interval(candidate, every, unit)?;
            }
            Some(candidate)
        } else {
            None
        }
    } else {
        if start >= now {
            Some(start)
        } else if let Some((every, unit)) = normalize_repeat(config) {
            let mut candidate = start;
            while candidate < now {
                candidate = add_interval(candidate, every, unit)?;
            }
            Some(candidate)
        } else {
            Some(start)
        }
    }
}

pub fn parse_schedule_config(value: &serde_json::Value) -> Option<ScheduleConfig> {
    serde_json::from_value(value.clone()).ok()
}

pub fn offset_to_utc(dt: OffsetDateTime) -> Option<DateTime<Utc>> {
    let seconds = dt.unix_timestamp();
    let nano_part = dt.nanosecond();
    let naive = NaiveDateTime::from_timestamp_opt(seconds, nano_part)?;
    Some(DateTime::<Utc>::from_utc(naive, Utc))
}

pub fn utc_to_offset(dt: DateTime<Utc>) -> Option<OffsetDateTime> {
    let seconds = dt.timestamp();
    let nanos = dt.timestamp_subsec_nanos();
    let base = OffsetDateTime::from_unix_timestamp(seconds).ok()?;
    base.replace_nanosecond(nanos).ok()
}
