mod transcript;

use transcript::{
    scan_ttml_files, extract_transcript, Episode, Paragraph, get_transcript_paragraphs,
    search_episodes_content as search_content, delete_episode_audio, delete_multiple_episodes_audio,
    get_audio_path, load_extracted_metadata, TranscriptMetadata, trash_file
};
use std::process::Command;
use std::path::Path;
use tauri::{Manager, Emitter};
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
use objc2_foundation::{NSURL, NSString, NSArray};
use objc2_app_kit::NSWorkspace;

#[tauri::command]
fn trash_item(path: String, base_dir: String) -> Result<(), String> {
    let path = Path::new(&path);
    let base_path = Path::new(&base_dir);
    trash_file(path, base_path)
}

#[tauri::command]
fn open_podcasts_episode(podcast_id: Option<String>, episode_id: Option<String>) -> Result<(), String> {
    let url = match (podcast_id, episode_id) {
        (Some(pid), Some(eid)) => format!("podcasts://apple.com/podcast/id{}?i={}", pid, eid),
        (Some(pid), None) => format!("podcasts://apple.com/podcast/id{}", pid),
        (None, Some(eid)) => format!("podcasts://apple.com/podcast/id?i={}", eid), // Might work, or just open app
        (None, None) => "podcasts://".to_string(),
    };

    println!("Opening Podcasts URL: {}", url);

    Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| format!("Failed to open Podcasts: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn delete_transcript_bundle(
    episode: Episode,
    output_dir: String,
    podcasts_base_dir: String,
    delete_everything: bool,
) -> Result<(), String> {
    let output_path = Path::new(&output_dir);
    let podcasts_path = Path::new(&podcasts_base_dir);
    
    // 1. Delete the .txt transcript
    let transcript_filename = if episode.podcast_title.is_some() && episode.episode_title.is_some() {
        transcript::sanitize_filename(&format!(
            "{} - {}",
            episode.podcast_title.as_ref().unwrap(),
            episode.episode_title.as_ref().unwrap()
        )) + ".txt"
    } else {
        episode.transcript_identifier.replace("/", "_") + ".txt"
    };
    
    let transcript_path = output_path.join(&transcript_filename);
    if transcript_path.exists() {
        trash_file(&transcript_path, output_path)?;
    }
    
    // 2. Delete metadata (.json)
    let metadata_filename = transcript_filename.replace(".txt", ".json");
    let metadata_path = output_path.join(".metadata").join(&metadata_filename);
    if metadata_path.exists() {
        trash_file(&metadata_path, output_path)?;
    }
    
    if delete_everything {
        // 3. Delete audio file
        if let Some(uuid) = &episode.uuid {
            if let Some(audio_path) = transcript::get_audio_path(podcasts_path, uuid) {
                let _ = trash_file(&audio_path, podcasts_path);
            }
        }
        
        // 4. Delete local TTML copy
        let ttml_filename = transcript_filename.replace(".txt", ".ttml");
        let ttml_path = output_path.join(".metadata").join("ttml").join(&ttml_filename);
        if ttml_path.exists() {
            trash_file(&ttml_path, output_path)?;
        }
    }
    
    Ok(())
}

#[tauri::command]
fn get_suggested_podcasts_dir() -> String {
    transcript::get_podcasts_base_dir().to_string_lossy().to_string()
}

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
fn scan_episodes(podcasts_base_dir: String) -> Result<Vec<Episode>, String> {
    println!("Command 'scan_episodes' invoked with path: {}", podcasts_base_dir);
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    match scan_ttml_files(&base_path) {
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
fn delete_audio(podcasts_base_dir: String, episode: Episode) -> Result<(), String> {
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    delete_episode_audio(&base_path, &episode)
}

#[tauri::command]
fn delete_multiple_audio(podcasts_base_dir: String, episodes: Vec<Episode>) -> Result<usize, String> {
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    delete_multiple_episodes_audio(&base_path, &episodes)
}

#[tauri::command]
fn get_audio_path_string(podcasts_base_dir: String, uuid: String) -> Option<String> {
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    get_audio_path(&base_path, &uuid).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_audio(podcasts_base_dir: String, episode: Episode) -> Result<(), String> {
    let uuid = episode.uuid.as_ref().ok_or("Episode has no UUID")?;
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    let audio_path = get_audio_path(&base_path, uuid).ok_or("Audio file not found")?;
    open_path(vec![audio_path.to_string_lossy().to_string()])
}

#[tauri::command]
fn open_audio_multiple(podcasts_base_dir: String, episodes: Vec<Episode>) -> Result<(), String> {
    let mut paths = Vec::new();
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    for ep in episodes {
        if let Some(uuid) = &ep.uuid {
            if let Some(path) = get_audio_path(&base_path, uuid) {
                paths.push(path.to_string_lossy().to_string());
            }
        }
    }
    open_path(paths)
}

#[tauri::command]
fn reveal_audio_multiple(podcasts_base_dir: String, episodes: Vec<Episode>) -> Result<(), String> {
    let mut paths = Vec::new();
    let base_path = std::path::PathBuf::from(podcasts_base_dir);
    for ep in episodes {
        if let Some(uuid) = &ep.uuid {
            if let Some(path) = get_audio_path(&base_path, uuid) {
                paths.push(path.to_string_lossy().to_string());
            }
        }
    }
    reveal_in_finder(paths)
}

#[tauri::command]
fn reveal_in_finder(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }

    let workspace = NSWorkspace::sharedWorkspace();
    let mut urls = Vec::new();
    for p in paths {
        let ns_path = NSString::from_str(&p);
        urls.push(NSURL::fileURLWithPath(&ns_path));
    }
    
    let ns_urls = NSArray::from_retained_slice(&urls);
    workspace.activateFileViewerSelectingURLs(&ns_urls);

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
            trash_item,
            open_podcasts_episode,
            delete_transcript_bundle,
            open_audio,
            open_audio_multiple,
            reveal_audio_multiple,
            get_audio_path_string,
            load_metadata,
            get_suggested_podcasts_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
