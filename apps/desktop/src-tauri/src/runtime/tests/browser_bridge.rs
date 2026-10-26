use crate::process_manager::process_job_for_test;
use std::{os::windows::process::CommandExt, process::Command, thread, time::Duration};

#[test]
fn process_job_ends_child_when_owner_handle_closes() {
    let mut child = Command::new("cmd.exe")
        .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
        .creation_flags(0x0800_0000)
        .spawn()
        .unwrap();
    let mut job = process_job_for_test().unwrap();
    job.assign(child.id()).unwrap();
    drop(job);
    for _ in 0..30 {
        if child.try_wait().unwrap().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    panic!("closing the browser job did not stop its child process");
}
