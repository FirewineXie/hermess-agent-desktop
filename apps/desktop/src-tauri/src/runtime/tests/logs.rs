use super::request_path;
use serde_json::json;

#[test]
fn log_request_rejects_unsupported_filters() {
    let valid = json!({"file":"agent","lines":100,"level":"ALL","component":"all"});
    assert!(request_path("default", &valid).is_ok());
    for payload in [
        json!({"file":"../agent","lines":100,"level":"ALL","component":"all"}),
        json!({"file":"agent","lines":10000,"level":"ALL","component":"all"}),
        json!({"file":"agent","lines":100,"level":"TRACE","component":"all"}),
        json!({"file":"agent","lines":100,"level":"ALL","component":"unknown"}),
    ] {
        assert!(request_path("default", &payload).is_err());
    }
}

#[test]
#[ignore = "run by the isolated locked Dashboard receiver probe"]
fn print_production_log_request_shapes() {
    for (profile, payload) in [
        (
            "default",
            json!({"file":"agent","lines":100,"level":"ALL","component":"all"}),
        ),
        (
            "default",
            json!({"file":"agent","lines":50,"level":"WARNING","component":"tools","search":"needle"}),
        ),
        (
            "ghost",
            json!({"file":"agent","lines":100,"level":"ALL","component":"all"}),
        ),
    ] {
        let path = request_path(profile, &payload).unwrap();
        println!(
            "LOG_SHAPE={}",
            json!({"method":"GET","path":path,"profile":profile})
        );
    }
}
