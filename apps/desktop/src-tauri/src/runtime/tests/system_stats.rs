use super::system_stats_path;
use serde_json::json;

#[test]
#[ignore = "Print the production path for the locked Dashboard receiver probe"]
fn print_production_system_stats_shape() {
    println!(
        "SYSTEM_STATS_SHAPE={}",
        json!({"method":"GET","path":system_stats_path()})
    );
}
