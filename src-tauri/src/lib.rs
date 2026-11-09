mod cli;
mod config;
mod paths;
mod platform;
mod plugins;
mod preview;
mod sessions;
mod skills;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(cli::CliRegistry::default())
        .setup(|_app| {
            // 预热 PATH 解析（macOS/Linux 会读一次登录 shell，可能耗时数百毫秒）
            std::thread::spawn(|| {
                let _ = cli::locate::search_path();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cli::commands::cli_locate,
            cli::commands::cli_start,
            cli::commands::cli_send,
            cli::commands::cli_stop,
            platform::system_fonts,
            paths::app_info,
            config::config_get,
            config::config_save,
            sessions::commands::session_list,
            sessions::commands::session_messages,
            sessions::commands::session_delete,
            sessions::commands::session_set_flag,
            skills::commands::skills_list,
            skills::commands::skill_doc,
            skills::commands::skill_save,
            skills::commands::skill_toggle,
            skills::commands::skill_create,
            plugins::plugins_list,
            plugins::plugin_add_dir,
            plugins::plugin_remove_dir,
            plugins::plugin_toggle,
            preview::preview_file,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Loom")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<cli::CliRegistry>().shutdown();
            }
        });
}
