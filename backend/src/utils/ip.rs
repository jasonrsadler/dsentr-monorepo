use axum::http::HeaderMap;
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tracing::warn;

#[derive(Debug, Clone)]
pub struct ClientIp {
    pub primary: IpAddr,
    pub ipv4: Option<IpAddr>,
    pub ipv6: Option<IpAddr>,
}

#[derive(Debug, Clone)]
pub struct IpLookup {
    pub city: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub is_proxy: Option<bool>,
    pub is_vpn: Option<bool>,
    pub raw: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct IpWhoisSecurity {
    vpn: Option<bool>,
    proxy: Option<bool>,
    tor: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct IpWhoisResponse {
    success: Option<bool>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    security: Option<IpWhoisSecurity>,
}

pub fn extract_client_ip(
    headers: &HeaderMap,
    connect_info: Option<SocketAddr>,
) -> Option<ClientIp> {
    let mut first: Option<IpAddr> = None;
    let mut first_ipv4: Option<IpAddr> = None;
    let mut first_ipv6: Option<IpAddr> = None;

    if let Some(raw) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        for part in raw.split(',').map(str::trim).filter(|v| !v.is_empty()) {
            if let Ok(ip) = part.parse::<IpAddr>() {
                if first.is_none() {
                    first = Some(ip);
                }
                match ip {
                    IpAddr::V4(_) if first_ipv4.is_none() => first_ipv4 = Some(ip),
                    IpAddr::V6(_) if first_ipv6.is_none() => first_ipv6 = Some(ip),
                    _ => {}
                }
            }
        }
    }

    if first.is_none() {
        let real_ip = headers
            .get("x-real-ip")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<IpAddr>().ok());
        if let Some(ip) = real_ip {
            first = Some(ip);
            match ip {
                IpAddr::V4(_) => first_ipv4 = Some(ip),
                IpAddr::V6(_) => first_ipv6 = Some(ip),
            }
        }
    }

    if first.is_none() {
        if let Some(addr) = connect_info {
            let ip = addr.ip();
            first = Some(ip);
            match ip {
                IpAddr::V4(_) => first_ipv4 = Some(ip),
                IpAddr::V6(_) => first_ipv6 = Some(ip),
            }
        }
    }

    let primary = first_ipv4.or(first)?;
    Some(ClientIp {
        primary,
        ipv4: first_ipv4,
        ipv6: first_ipv6,
    })
}

pub async fn lookup_ip_metadata(client: &Client, ip: IpAddr) -> Option<IpLookup> {
    if !is_public_routable(&ip) {
        return None;
    }

    let url = format!("https://ipwho.is/{ip}");
    let response = client
        .get(url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;

    let raw_value: Value = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            warn!(?err, %ip, "failed to decode ipwho.is response");
            return None;
        }
    };

    let parsed: IpWhoisResponse = match serde_json::from_value(raw_value.clone()) {
        Ok(value) => value,
        Err(err) => {
            warn!(?err, %ip, "failed to parse ipwho.is payload");
            return None;
        }
    };

    if let Some(false) = parsed.success {
        return None;
    }

    let is_proxy = parsed.security.as_ref().and_then(|s| {
        if s.proxy.is_some() {
            s.proxy
        } else if s.tor.is_some() {
            s.tor
        } else {
            None
        }
    });

    let is_vpn = parsed.security.as_ref().and_then(|s| s.vpn);

    Some(IpLookup {
        city: parsed.city,
        region: parsed.region,
        country: parsed.country,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        is_proxy,
        is_vpn,
        raw: Some(raw_value),
    })
}

fn is_public_routable(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified())
        }
        IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_multicast()
                || v6.is_unicast_link_local())
        }
    }
}
