//! Public-API contract of `ccc-core` (what ZUS links).
use ccc_core::registry::Store;
use ccc_core::transcript::{row_json, scan_file, show_json, Fmt, Row, Status};
use std::path::PathBuf;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("ccc-core-api-{tag}-{}-{}", std::process::id(), ccc_core::registry::new_uuid()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn masks_prose_password() {
    let m = ccc_core::mask("sudo password của tôi là Fake9876 nhé");
    assert!(!m.contains("Fake9876"), "{m}");
}

#[test]
fn registry_round_trip() {
    let cfg = tmp("reg");
    let st = Store::new(&cfg, std::path::Path::new("/work/repo"), "claude-sessions", "ccc .");
    let s = st.touch("alpha", false).unwrap();
    assert_eq!(st.load().last_used.as_deref(), Some("alpha"));
    assert_eq!(st.touch("alpha", false).unwrap().conversation_id, s.conversation_id);
    assert!(st.touch("alpha", true).is_err(), "refuse_existing");
    assert!(st.touch("bad name", false).is_err());
    assert_eq!(st.remove("alpha").unwrap().unwrap().name, "alpha");
    assert!(st.load().sessions.is_empty());
    let _ = std::fs::remove_dir_all(&cfg);
}

#[test]
fn scan_fixture_to_schema_1_row() {
    let dir = tmp("scan");
    let f = dir.join("s.jsonl");
    std::fs::write(
        &f,
        concat!(
            r#"{"type":"custom-title","customTitle":"demo","sessionId":"s"}"#, "\n",
            r#"{"type":"user","message":{"role":"user","content":"hello password: Fake9876x"}}"#, "\n",
        ),
    )
    .unwrap();
    let digest = scan_file(&f, Fmt::Claude, true);
    assert_eq!(digest.user_msgs, 1);
    let row = Row {
        engine: "ccc",
        name: "demo".into(),
        is_last: true,
        status: Status::Idle,
        last_active: 1,
        branch: None,
        dirty: false,
        digest,
        resume: "8sync ccc . demo".into(),
        transcript: Some(f),
        inbox_id: Some("s".into()),
    };
    let j = row_json(&row);
    assert_eq!(j["schema"], ccc_core::SCHEMA);
    assert_eq!(j["schema"], 1);
    assert_eq!(j["sid"], "s");
    assert_eq!(j["inbox_id"], "s");
    assert!(!show_json(&row).to_string().contains("Fake9876x"));
    let _ = std::fs::remove_dir_all(&dir);
}
