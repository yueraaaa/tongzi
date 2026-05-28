use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Config {
    secret_key: String,
    room: String,
    server_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            room: "1班".to_string(),
            server_url: "http://localhost:3000".to_string(),
            secret_key: "".to_string(),
        }
    }
}

struct AppState {
    config: Mutex<Config>,
    config_path: PathBuf,
    app_handle: AppHandle,
}

#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(state: tauri::State<AppState>, room: String, server_url: String, secret_key: String) -> Config {
    let mut config = state.config.lock().unwrap();
    config.room = room.clone();
    config.server_url = server_url.clone();
    config.secret_key = secret_key.clone();
    let _ = fs::write(
        &state.config_path,
        serde_json::to_string_pretty(&*config).unwrap(),
    );
    let app = state.app_handle.clone();
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(format!("教室通知 - {} (已连接)", room)));
    }
    config.clone()
}

#[tauri::command]
fn show_notification(app: AppHandle, message: String) {
    // Close existing notification window first
    if let Some(window) = app.get_webview_window("notification") {
        let _ = window.close();
    }

    let msg = message.clone();

    match WebviewWindowBuilder::new(
        &app,
        "notification",
        WebviewUrl::App("display.html".into()),
    )
    .title("通知")
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .build()
    {
        Ok(window) => {
            let window_clone = window.clone();
            window.once("notification-ready", move |_| {
                let _ = window_clone.emit("notification-message", msg.clone());
            });
        }
        Err(e) => {
            eprintln!("Failed to create notification window: {}", e);
        }
    }
}

#[tauri::command]
fn close_notification(app: AppHandle) {
    if let Some(window) = app.get_webview_window("notification") {
        let _ = window.close();
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&config_dir);
            let config_path = config_dir.join("config.json");

            let config = if config_path.exists() {
                fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default()
            } else {
                let c = Config::default();
                let _ = fs::write(&config_path, serde_json::to_string_pretty(&c).unwrap());
                c
            };

            let room = config.room.clone();
            let app_handle = app.handle().clone();

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                app_handle: app_handle.clone(),
            });

            // Build tray menu
            let reconnect = MenuItemBuilder::with_id("reconnect", "重新连接").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "设置...").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let room_info =
                MenuItemBuilder::with_id("room_info", format!("教室: {}", room))
                    .enabled(false)
                    .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&room_info)
                .separator()
                .item(&reconnect)
                .item(&settings)
                .separator()
                .item(&quit)
                .build()?;

            let app_handle2 = app_handle.clone();
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip(format!("教室通知 - {}", room))
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "reconnect" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("reconnect", ());
                        }
                    }
                    "settings" => {
                        let _ = WebviewWindowBuilder::new(
                            app,
                            "settings",
                            WebviewUrl::App("settings.html".into()),
                        )
                        .title("设置")
                        .inner_size(420.0, 280.0)
                        .resizable(false)
                        .build();
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("reconnect", ());
                        }
                    }
                })
                .build(app)?;

            // Hidden main window for Socket.IO connection
            let _main_window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("教室通知接收端")
            .inner_size(1.0, 1.0)
            .visible(false)
            .skip_taskbar(true)
            .build()?;

            // Suppress unused warning
            let _ = &app_handle2;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            show_notification,
            close_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
