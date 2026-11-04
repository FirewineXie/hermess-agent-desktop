use super::{path, run_args};

#[test]
#[ignore = "request shapes for isolated locked Gateway receiver"]
fn print_production_curator_shapes() {
    let list = path(1, "default", false).unwrap();
    let pause = path(1, "default", true).unwrap();
    println!("CURATOR_SHAPE={{\"method\":\"GET\",\"path\":\"{list}\"}}");
    println!(
        "CURATOR_SHAPE={{\"method\":\"PUT\",\"path\":\"{pause}\",\"body\":{{\"paused\":true}}}}"
    );
    let named_list = path(1, "worker_beta", false).unwrap();
    let named_pause = path(1, "worker_beta", true).unwrap();
    println!("CURATOR_SHAPE={{\"method\":\"GET\",\"path\":\"{named_list}\"}}");
    println!("CURATOR_SHAPE={{\"method\":\"PUT\",\"path\":\"{named_pause}\",\"body\":{{\"paused\":true}}}}");
    println!(
        "CURATOR_CLI={}",
        serde_json::to_string(&run_args("default")).unwrap()
    );
    println!(
        "CURATOR_CLI={}",
        serde_json::to_string(&run_args("worker_beta")).unwrap()
    );
}
