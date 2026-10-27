use std::{io, time::Instant};
use tokio::process::Command;

pub struct PlatformManager;
impl PlatformManager {
    pub fn new() -> io::Result<Self> {
        Ok(Self)
    }
}
pub fn configure_command(_command: &mut Command) {}
pub struct ProcessTree;
impl ProcessTree {
    pub fn new(_platform: &PlatformManager) -> io::Result<Self> {
        Ok(Self)
    }
    pub fn assign(&mut self, _pid: u32) -> io::Result<()> {
        Ok(())
    }
    pub fn terminate_and_wait(&mut self, _deadline: Instant) -> bool {
        false
    }
}
pub fn watch_exit(
    _pid: u32,
    _kind: &'static str,
    _on_exit: impl FnOnce() + Send + 'static,
) -> io::Result<()> {
    Ok(())
}
