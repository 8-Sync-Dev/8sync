// Desktop entry, only for previewing the connect screen with `tauri dev`/`cargo run`;
// the Android app enters through `hq_lib::run` (`tauri::mobile_entry_point`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hq_lib::run()
}
