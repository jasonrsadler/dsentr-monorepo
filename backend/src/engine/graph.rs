use std::collections::HashMap;

use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) struct Node {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) data: Value,
}

#[derive(Debug, Clone)]
pub(crate) struct Edge {
    pub(crate) id: String,
    pub(crate) source: String,
    pub(crate) target: String,
    pub(crate) source_handle: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Graph {
    pub(crate) nodes: HashMap<String, Node>,
    edges_out: HashMap<String, Vec<Edge>>, // source -> edges
}

impl Graph {
    pub(crate) fn from_snapshot(snapshot: &Value) -> Option<Self> {
        let mut nodes = HashMap::new();
        let mut edges_out: HashMap<String, Vec<Edge>> = HashMap::new();

        let nodes_val = snapshot.get("nodes").and_then(|v| v.as_array())?;
        let edges_val = snapshot.get("edges").and_then(|v| v.as_array())?;

        for n in nodes_val {
            let id = n.get("id")?.as_str()?.to_string();
            let kind = n.get("type")?.as_str()?.to_string();
            let data = n.get("data").cloned().unwrap_or(Value::Null);
            nodes.insert(id.clone(), Node { id, kind, data });
        }

        for e in edges_val {
            let id = e
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let source = e.get("source")?.as_str()?.to_string();
            let target = e.get("target")?.as_str()?.to_string();
            let source_handle = e
                .get("sourceHandle")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let edge = Edge {
                id,
                source: source.clone(),
                target,
                source_handle,
            };
            edges_out.entry(source).or_default().push(edge);
        }

        Some(Graph { nodes, edges_out })
    }

    pub(crate) fn outgoing(&self, node_id: &str) -> &[Edge] {
        self.edges_out
            .get(node_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }
}
