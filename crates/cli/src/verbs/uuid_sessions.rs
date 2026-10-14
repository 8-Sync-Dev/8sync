//! Name → UUID registry: logic lives in `ccc-core` (`ccc_core::registry`); this
//! shim keeps the CLI-only terminal printer.

pub use ccc_core::registry::*;

pub(crate) fn print(reg: &Registry) {
    let n = ccc_core::transcript::now_secs();
    for s in &reg.sessions {
        let star = if reg.last_used.as_deref() == Some(&s.name) { "★ " } else { "  " };
        println!("{star}{:<16}  last active: {:<12}  id: {}", s.name, ccc_core::transcript::ago(s.last_active, n), s.conversation_id);
    }
}
