use serde::ser::{Serialize, SerializeStruct, Serializer};
use std::collections::HashMap;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{code}")]
    Coded {
        code: &'static str,
        params: HashMap<String, serde_json::Value>,
        detail: Option<String>,
    },
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("BackendError", 3)?;
        match self {
            Self::Coded {
                code,
                params,
                detail,
            } => {
                state.serialize_field("code", code)?;
                if !params.is_empty() {
                    state.serialize_field("params", params)?;
                }
                state.serialize_field("detail", detail)?;
            }
            _ => {
                state.serialize_field("code", "backend")?;
                state.serialize_field("detail", &self.to_string())?;
            }
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }

    pub fn coded(code: &'static str, detail: Option<String>) -> Self {
        Self::Coded {
            code,
            params: HashMap::new(),
            detail,
        }
    }

    pub fn coded_with_params(
        code: &'static str,
        params: HashMap<String, serde_json::Value>,
        detail: Option<String>,
    ) -> Self {
        Self::Coded {
            code,
            params,
            detail,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coded_errors_serialize_as_stable_payloads() {
        let mut params = HashMap::new();
        params.insert("name".into(), serde_json::json!("demo"));
        let value =
            serde_json::to_value(AppError::coded_with_params("projectNotFound", params, None))
                .unwrap();
        assert_eq!(value["code"], "projectNotFound");
        assert_eq!(value["params"]["name"], "demo");
        assert!(value["detail"].is_null());
    }
}
