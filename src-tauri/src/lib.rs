mod transcript;

use transcript::{
    scan_ttml_files, extract_transcript, Episode, Paragraph, get_transcript_paragraphs,
    search_episodes_content as search_content
};
use std::process::Command;

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
fn open_path(path: String) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("Failed to open path: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_episodes,
            extract_transcript_command,
            open_path,
            search_episodes_content,
            get_transcript
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
