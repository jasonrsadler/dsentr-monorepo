use serde_json::Value;

pub(crate) fn templ_str(s: &str, ctx: &Value) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("{{") {
        let (head, tail) = rest.split_at(start);
        out.push_str(head);
        if let Some(end_rel) = tail.find("}}") {
            let (expr_with, new_rest) = tail.split_at(end_rel + 2);
            let expr = expr_with
                .trim_start_matches("{{")
                .trim_end_matches("}}")
                .trim();
            let val = lookup_ctx(expr, ctx).unwrap_or_default();
            out.push_str(&val);
            rest = new_rest;
        } else {
            out.push_str(tail);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

pub(crate) fn lookup_ctx(path: &str, ctx: &Value) -> Option<String> {
    let mut cur = ctx;
    for part in path.split('.') {
        if part.is_empty() {
            continue;
        }
        match cur {
            Value::Object(map) => {
                cur = map.get(part)?;
            }
            Value::Array(arr) => {
                let idx: usize = part.parse().ok()?;
                cur = arr.get(idx)?;
            }
            _ => {
                return Some(cur.to_string().trim_matches('"').to_string());
            }
        }
    }
    Some(match cur {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}
