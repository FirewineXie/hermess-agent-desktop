use crate::errors::DesktopFailure;
use reqwest::Client;
use std::sync::OnceLock;

static LOCAL_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

/// Reuses one connection pool for requests to the product-owned loopback Gateway.
/// Callers keep endpoint-specific timeouts on the request builder.
pub(super) fn client() -> Result<&'static Client, DesktopFailure> {
    if let Some(client) = LOCAL_HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DesktopFailure::operation_failed())?;
    let _ = LOCAL_HTTP_CLIENT.set(client);
    LOCAL_HTTP_CLIENT
        .get()
        .ok_or_else(DesktopFailure::operation_failed)
}

#[cfg(test)]
#[path = "tests/local_http.rs"]
mod tests;
