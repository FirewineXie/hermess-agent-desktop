use super::GatewayClient;
use std::sync::{atomic::AtomicBool, Arc};
use tokio::sync::mpsc;

/// A live connection identity without network/model traffic, for resource fencing tests.
pub(crate) fn idle_gateway(epoch: &str) -> Arc<GatewayClient> {
    let (sender, receiver) = mpsc::channel(1);
    let task = tokio::spawn(async move {
        let _receiver = receiver;
        std::future::pending::<()>().await;
    });
    Arc::new(GatewayClient {
        sender,
        task,
        events_enabled: Arc::new(AtomicBool::new(false)),
        replay_epoch: epoch.to_owned(),
    })
}
