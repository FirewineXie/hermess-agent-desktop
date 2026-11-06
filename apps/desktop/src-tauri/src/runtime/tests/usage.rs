use super::usage_paths;
use serde_json::json;

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_usage_request_shapes() {
    let [usage, models] = usage_paths("default", 30);
    for path in [usage, models] {
        println!("USAGE_SHAPE={}", json!({"method":"GET","path":path}));
    }
}
