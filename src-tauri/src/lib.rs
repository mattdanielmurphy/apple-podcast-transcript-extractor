mod transcript;

use transcript::{
    scan_ttml_files, extract_transcript, Episode, Paragraph, get_transcript_paragraphs,
    search_episodes_content as search_content, delete_episode_audio, delete_multiple_episodes_audio,
    get_audio_path, load_extracted_metadata, TranscriptMetadata
};
use std::process::Command;
use tauri::{Manager, Emitter};
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};

#[tauri::command]
fn get_default_transcript_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle.path().app_data_dir()
        .map(|path| path.join("transcripts").to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_metadata(output_dir: String) -> Vec<TranscriptMetadata> {
    load_extracted_metadata(&output_dir)
}

#[tauri::command]
fn get_transcript(episode: Episode) -> Result<Vec<Paragraph>, String> {
    get_transcript_paragraphs(&episode)
}

#[tauri::command]
fn scan_episodes() -> Result<Vec<Episode>, String> {
    println!("Command 'scan_episodes' invoked");
    match scan_ttml_files() {
        Ok(episodes) => {
            println!("Found {} episodes", episodes.len());
            Ok(episodes)
        }
        Err(e) => {
            println!("Error scanning episodes: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
fn extract_transcript_command(
    episode: Episode,
    output_dir: String,
    include_timestamps: bool,
) -> Result<String, String> {
    extract_transcript(&episode, &output_dir, include_timestamps).map(|(path, _)| path)
}

#[tauri::command]
fn search_episodes_content(query: String, episodes: Vec<Episode>) -> Vec<usize> {
    search_content(query, episodes)
}

#[tauri::command]
fn open_path(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }
    let mut cmd = Command::new("open");
    for path in paths {
        cmd.arg(path);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to open paths: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_audio(episode: Episode) -> Result<(), String> {
    delete_episode_audio(&episode)
}

#[tauri::command]
fn delete_multiple_audio(episodes: Vec<Episode>) -> Result<usize, String> {
    delete_multiple_episodes_audio(&episodes)
}

#[tauri::command]
fn get_audio_path_string(uuid: String) -> Option<String> {
    get_audio_path(&uuid).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_audio(episode: Episode) -> Result<(), String> {
    let uuid = episode.uuid.as_ref().ok_or("Episode has no UUID")?;
    let audio_path = get_audio_path(uuid).ok_or("Audio file not found")?;
    open_path(vec![audio_path.to_string_lossy().to_string()])
}

#[tauri::command]
fn open_audio_multiple(episodes: Vec<Episode>) -> Result<(), String> {
    let mut paths = Vec::new();
    for ep in episodes {
        if let Some(uuid) = &ep.uuid {
            if let Some(path) = get_audio_path(uuid) {
                paths.push(path.to_string_lossy().to_string());
            }
        }
    }
    open_path(paths)
}

#[tauri::command]
fn reveal_audio_multiple(episodes: Vec<Episode>) -> Result<(), String> {
    let mut paths = Vec::new();
    for ep in episodes {
        if let Some(uuid) = &ep.uuid {
            if let Some(path) = get_audio_path(uuid) {
                paths.push(path.to_string_lossy().to_string());
            }
        }
    }
    reveal_in_finder(paths)
}

#[tauri::command]
fn reveal_in_finder(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }

    if paths.len() == 1 {
        Command::new("open")
            .arg("-R")
            .arg(&paths[0])
            .spawn()
            .map_err(|e| format!("Failed to reveal path: {}", e))?;
        return Ok(());
    }

    // Use AppleScript for multiple selection
    let posix_files: Vec<String> = paths
        .iter()
        .map(|p| format!("POSIX file \"{}\"", p))
        .collect();
    
    let script = format!(
        "tell application \"Finder\"\n\treveal {{{}}}\n\tactivate\nend tell",
        posix_files.join(", ")
    );

    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to execute osascript for multi-reveal: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle();
            let select_all_i = MenuItem::with_id(handle, "select-all", "Select All", true, Some("CmdOrCtrl+A"))?;
            let select_none_i = MenuItem::with_id(handle, "select-none", "Select None", true, Some("Escape"))?;

            let menu = Menu::with_items(
                handle,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        handle,
                        "Transcript Extractor",
                        true,
                        &[
                            &PredefinedMenuItem::about(handle, None, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::services(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::hide(handle, None)?,
                            &PredefinedMenuItem::hide_others(handle, None)?,
                            &PredefinedMenuItem::show_all(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::quit(handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(handle, None)?,
                            &PredefinedMenuItem::redo(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::cut(handle, None)?,
                            &PredefinedMenuItem::copy(handle, None)?,
                            &PredefinedMenuItem::paste(handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "Selection",
                        true,
                        &[
                            &select_all_i,
                            &select_none_i,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "Window",
                        true,
                        &[
                            &PredefinedMenuItem::minimize(handle, None)?,
                            &PredefinedMenuItem::maximize(handle, None)?,
                            &PredefinedMenuItem::close_window(handle, None)?,
                        ],
                    )?,
                ],
            )?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "select-all" => {
                    let _ = app.emit("menu-select-all", ());
                }
                "select-none" => {
                    let _ = app.emit("menu-select-none", ());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_episodes,
            extract_transcript_command,
            open_path,
            reveal_in_finder,
            search_episodes_content,
            get_transcript,
            get_default_transcript_directory,
            delete_audio,
            delete_multiple_audio,
            open_audio,
            open_audio_multiple,
            reveal_audio_multiple,
            get_audio_path_string,
            load_metadata
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
