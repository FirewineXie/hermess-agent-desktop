#[cfg(windows)]
#[test]
fn default_windows_shell_keeps_startup_output_until_reader_starts() {
    use super::{default_shell, terminal_size};
    use portable_pty::{native_pty_system, CommandBuilder};
    use std::{io::Read, sync::mpsc, time::Duration};

    let pair = native_pty_system().openpty(terminal_size(80, 24)).unwrap();
    let mut child = pair
        .slave
        .spawn_command(CommandBuilder::new(default_shell()))
        .unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    // The UI subscribes after process creation; startup bytes must still be readable.
    std::thread::sleep(Duration::from_millis(150));
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let result = reader.read(&mut buffer).map(|size| buffer[..size].to_vec());
        let _ = sender.send(result);
    });
    let output = receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    assert!(!output.is_empty());
    child.kill().unwrap();
}
