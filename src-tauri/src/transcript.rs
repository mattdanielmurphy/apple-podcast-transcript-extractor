use quick_xml::events::Event;
use quick_xml::Reader;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub transcript_identifier: String,
    pub file_path: String,
    pub local_ttml_path: Option<String>,
    pub uuid: Option<String>,
    pub episode_title: Option<String>,
    pub podcast_title: Option<String>,
    pub author: Option<String>,
    pub category: Option<String>,
    pub pub_date: Option<f64>,
    pub import_date: Option<f64>,
    pub has_audio: bool,
    pub is_orphaned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paragraph {
    pub begin: Option<f64>,
    pub text: String,
}

pub fn get_podcasts_base_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable not set");
    PathBuf::from(home).join("Library/Group Containers/243LU875E5.groups.com.apple.podcasts")
}

pub fn get_cache_dir() -> PathBuf {
    get_podcasts_base_dir().join("Library/Cache")
}

pub fn get_ttml_dir() -> PathBuf {
    get_podcasts_base_dir().join("Library/Cache/Assets/TTML")
}

pub fn get_database_path() -> PathBuf {
    get_podcasts_base_dir().join("Documents/MTLibrary.sqlite")
}

pub fn get_audio_path(uuid: &str) -> Option<PathBuf> {
    let cache_dir = get_cache_dir();
    let mp3_path = cache_dir.join(format!("{}.mp3", uuid));
    if mp3_path.exists() {
        return Some(mp3_path);
    }
    let m4a_path = cache_dir.join(format!("{}.m4a", uuid));
    if m4a_path.exists() {
        return Some(m4a_path);
    }
    None
}

pub fn scan_ttml_files() -> Result<Vec<Episode>, String> {
    let ttml_dir = get_ttml_dir();
    
    if !ttml_dir.exists() {
        return Err(format!("TTML directory not found: {:?}", ttml_dir));
    }

    let db_path = get_database_path();
    if !db_path.exists() {
        return Err(format!("Database not found: {:?}", db_path));
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let mut episodes = Vec::new();
    find_ttml_files_recursive(&ttml_dir, &ttml_dir, &conn, &mut episodes)?;

    Ok(episodes)
}

fn find_ttml_files_recursive(
    dir: &Path,
    base_dir: &Path,
    conn: &Connection,
    episodes: &mut Vec<Episode>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {:?}: {}", dir, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            find_ttml_files_recursive(&path, base_dir, conn, episodes)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("ttml") {
            let relative_path = path
                .strip_prefix(base_dir)
                .map_err(|e| format!("Failed to get relative path: {}", e))?;

            let relative_str = relative_path.to_string_lossy().to_string();
            
            // Handle duplicate filename pattern (e.g., transcript_123.ttml-123.ttml -> transcript_123.ttml)
            let transcript_identifier = if relative_str.contains(".ttml-") {
                relative_str.split(".ttml-").next().unwrap_or(&relative_str).to_string() + ".ttml"
            } else {
                relative_str.clone()
            };

            let metadata = query_episode_metadata(conn, &transcript_identifier);

            let uuid = metadata.as_ref().and_then(|m| m.get("uuid").cloned().and_then(|v| v.as_str().map(|s| s.to_string())));
            let has_audio = uuid.as_ref().map(|u| get_audio_path(u).is_some()).unwrap_or(false);

            episodes.push(Episode {
                transcript_identifier: transcript_identifier.clone(),
                file_path: path.to_string_lossy().to_string(),
                local_ttml_path: None,
                uuid,
                episode_title: metadata.as_ref().and_then(|m| m.get("episode_title").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                podcast_title: metadata.as_ref().and_then(|m| m.get("podcast_title").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                author: metadata.as_ref().and_then(|m| m.get("author").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                category: metadata.as_ref().and_then(|m| m.get("category").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                                    pub_date: metadata.as_ref().and_then(|m| m.get("pub_date").cloned().and_then(|v| v.as_f64())),
                                    import_date: metadata.as_ref().and_then(|m| m.get("import_date").cloned().and_then(|v| v.as_f64())),
                                    has_audio,
                                    is_orphaned: false,
                                });        }
    }

    Ok(())
}

fn query_episode_metadata(
    conn: &Connection,
    transcript_identifier: &str,
) -> Option<HashMap<String, serde_json::Value>> {
    let query = "
        SELECT
            e.ZTITLE as episode_title,
            p.ZTITLE as podcast_title,
            p.ZAUTHOR as author,
            p.ZCATEGORY as category,
            e.ZPUBDATE as pub_date,
            e.ZIMPORTDATE as import_date,
            e.ZUUID as uuid
        FROM ZMTEPISODE e
        JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
        WHERE e.ZTRANSCRIPTIDENTIFIER = ?1
    ";

    conn.query_row(query, [transcript_identifier], |row| {
        let mut map = HashMap::new();
        
        if let Ok(title) = row.get::<_, String>(0) {
            map.insert("episode_title".to_string(), serde_json::Value::String(title));
        }
        if let Ok(podcast) = row.get::<_, String>(1) {
            map.insert("podcast_title".to_string(), serde_json::Value::String(podcast));
        }
        if let Ok(author) = row.get::<_, String>(2) {
            map.insert("author".to_string(), serde_json::Value::String(author));
        }
        if let Ok(category) = row.get::<_, String>(3) {
            map.insert("category".to_string(), serde_json::Value::String(category));
        }
        if let Ok(pub_date) = row.get::<_, f64>(4) {
            map.insert("pub_date".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(pub_date).unwrap()));
        }
        if let Ok(import_date) = row.get::<_, f64>(5) {
            map.insert("import_date".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(import_date).unwrap()));
        }
        if let Ok(uuid) = row.get::<_, String>(6) {
            map.insert("uuid".to_string(), serde_json::Value::String(uuid));
        }

        Ok(map)
    })
    .ok()
}

pub fn search_episodes_content(query: String, episodes: Vec<Episode>) -> Vec<usize> {
    let query = query.to_lowercase();
    let mut results = Vec::new();

    for (index, episode) in episodes.iter().enumerate() {
        if let Ok(content) = fs::read_to_string(&episode.file_path) {
            // Simple case-insensitive search in raw content for speed first
            // If it matches raw, then we can be more precise if needed, 
            // but for a "is this word here" check, a raw check usually works.
            if content.to_lowercase().contains(&query) {
                results.push(index);
            }
        }
    }

    results
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptMetadata {
    pub episode: Episode,
    pub include_timestamps: bool,
    pub extracted_at: f64,
}

pub fn extract_transcript(
    episode: &Episode,
    output_dir: &str,
    include_timestamps: bool,
) -> Result<(String, String), String> {
    // Try to read from local copy if original path doesn't exist or if it's already an orphaned episode
    let ttml_path = if episode.is_orphaned {
        episode.local_ttml_path.as_ref().ok_or("Orphaned episode has no local TTML path")?
    } else if !Path::new(&episode.file_path).exists() && episode.local_ttml_path.is_some() {
        episode.local_ttml_path.as_ref().unwrap()
    } else {
        &episode.file_path
    };

    let ttml_content = fs::read_to_string(ttml_path)
        .map_err(|e| format!("Failed to read TTML file: {}", e))?;

    let paragraphs = parse_ttml(&ttml_content)?;

    let transcript_text = if include_timestamps {
        paragraphs
            .iter()
            .map(|p| {
                if let Some(begin) = p.begin {
                    format!("[{}] {}", format_timestamp(begin), p.text)
                } else {
                    p.text.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        paragraphs
            .iter()
            .map(|p| p.text.clone())
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    // Create output directory if it doesn't exist
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Generate filenames
    let base_name = if let (Some(podcast), Some(episode_title)) = 
        (&episode.podcast_title, &episode.episode_title) {
        sanitize_filename(&format!("{} - {}", podcast, episode_title))
    } else {
        episode.transcript_identifier.replace("/", "_")
    };

    let filename = format!("{}.txt", base_name);
    let metadata_filename = format!("{}.json", base_name);
    let ttml_copy_filename = format!("{}.ttml", base_name);

    let output_path = PathBuf::from(output_dir).join(&filename);
    let metadata_dir = PathBuf::from(output_dir).join(".metadata");
    let metadata_path = metadata_dir.join(&metadata_filename);
    let local_ttml_dir = metadata_dir.join("ttml");
    let local_ttml_path = local_ttml_dir.join(&ttml_copy_filename);
    
    // Create metadata and ttml directories
    fs::create_dir_all(&metadata_dir)
        .map_err(|e| format!("Failed to create metadata directory: {}", e))?;
    fs::create_dir_all(&local_ttml_dir)
        .map_err(|e| format!("Failed to create local TTML directory: {}", e))?;

    // Copy TTML file if it's not already there
    if ttml_path != local_ttml_path.to_string_lossy().as_ref() {
        fs::copy(ttml_path, &local_ttml_path)
            .map_err(|e| format!("Failed to copy TTML file to local store: {}", e))?;
    }

    // Write transcript
    fs::write(&output_path, transcript_text)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    // Write metadata
    let mut updated_episode = episode.clone();
    updated_episode.local_ttml_path = Some(local_ttml_path.to_string_lossy().to_string());

    let metadata = TranscriptMetadata {
        episode: updated_episode,
        include_timestamps,
        extracted_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64(),
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    Ok((output_path.to_string_lossy().to_string(), filename))
}

pub fn load_extracted_metadata(output_dir: &str) -> Vec<TranscriptMetadata> {
    let mut metadata_list = Vec::new();
    let base_path = Path::new(output_dir);
    let metadata_path = base_path.join(".metadata");

    if !base_path.exists() || !base_path.is_dir() {
        return metadata_list;
    }

    // Scan .metadata folder if it exists
    if metadata_path.exists() && metadata_path.is_dir() {
        if let Ok(entries) = fs::read_dir(metadata_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(metadata) = serde_json::from_str::<TranscriptMetadata>(&content) {
                            metadata_list.push(metadata);
                        }
                    }
                }
            }
        }
    }

    // Also scan base folder for legacy/non-migrated metadata files
    if let Ok(entries) = fs::read_dir(base_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(metadata) = serde_json::from_str::<TranscriptMetadata>(&content) {
                        metadata_list.push(metadata);
                    }
                }
            }
        }
    }

    metadata_list
}

pub fn get_transcript_paragraphs(episode: &Episode) -> Result<Vec<Paragraph>, String> {
    let path = if episode.is_orphaned {
        episode.local_ttml_path.as_ref().ok_or("Orphaned episode has no local TTML path")?
    } else if !Path::new(&episode.file_path).exists() && episode.local_ttml_path.is_some() {
        episode.local_ttml_path.as_ref().unwrap()
    } else {
        &episode.file_path
    };

    let ttml_content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read TTML file: {}", e))?;

    parse_ttml(&ttml_content)
}

fn parse_ttml(content: &str) -> Result<Vec<Paragraph>, String> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut paragraphs = Vec::new();
    let mut current_paragraph: Option<Paragraph> = None;
    let mut current_text = String::new();
    let mut in_paragraph = false;

    let get_begin = |e: &quick_xml::events::BytesStart| {
        e.attributes()
            .filter_map(|a| a.ok())
            .find(|attr| attr.key.local_name().as_ref() == b"begin")
            .and_then(|attr| {
                String::from_utf8(attr.value.to_vec())
                    .ok()
                    .and_then(|s| parse_ttml_time(s.trim()))
            })
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                match e.local_name().as_ref() {
                    b"p" => {
                        in_paragraph = true;
                        current_paragraph = Some(Paragraph {
                            begin: get_begin(&e),
                            text: String::new(),
                        });
                        current_text.clear();
                    }
                    b"span" => {
                        if in_paragraph {
                            if let Some(ref mut para) = current_paragraph {
                                if para.begin.is_none() {
                                    para.begin = get_begin(&e);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == b"p" {
                    paragraphs.push(Paragraph {
                        begin: get_begin(&e),
                        text: String::new(),
                    });
                }
            }
            Ok(Event::Text(e)) => {
                if in_paragraph {
                    if let Ok(text) = e.unescape() {
                        current_text.push_str(&text);
                        current_text.push(' ');
                    }
                }
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == b"p" {
                    in_paragraph = false;
                    if let Some(mut para) = current_paragraph.take() {
                        para.text = current_text.trim().to_string();
                        if !para.text.is_empty() {
                            paragraphs.push(para);
                        }
                    }
                    current_text.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parsing error: {}", e)),
            _ => {}
        }
    }

    Ok(paragraphs)
}

fn parse_ttml_time(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }

    // Try parsing as raw seconds first
    if let Ok(secs) = s.parse::<f64>() {
        return Some(secs);
    }

    // Handle clock-time: [hh:]mm:ss[.mmm] or [hh:mm:]ss[.mmm]
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        match parts.len() {
            3 => {
                // H:M:S
                let h = parts[0].parse::<f64>().ok()?;
                let m = parts[1].parse::<f64>().ok()?;
                let s = parts[2].parse::<f64>().ok()?;
                return Some(h * 3600.0 + m * 60.0 + s);
            }
            2 => {
                // M:S
                let m = parts[0].parse::<f64>().ok()?;
                let s = parts[1].parse::<f64>().ok()?;
                return Some(m * 60.0 + s);
            }
            _ => {}
        }
    }

    // Handle offset-time: time(h|m|s|ms)
    if s.ends_with('s') {
        if s.ends_with("ms") {
            return s[..s.len() - 2].parse::<f64>().ok().map(|ms| ms / 1000.0);
        }
        return s[..s.len() - 1].parse::<f64>().ok();
    }
    if s.ends_with('m') {
        return s[..s.len() - 1].parse::<f64>().ok().map(|m| m * 60.0);
    }
    if s.ends_with('h') {
        return s[..s.len() - 1].parse::<f64>().ok().map(|h| h * 3600.0);
    }

    None
}

fn format_timestamp(seconds: f64) -> String {
    let h = (seconds / 3600.0).floor() as u32;
    let m = ((seconds % 3600.0) / 60.0).floor() as u32;
    let s = (seconds % 60.0).floor() as u32;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

use std::process::Command;

pub fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => c,
        })
        .collect::<String>()
        .chars()
        .take(200)
        .collect()
}

fn trash_file(path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let script = format!("tell application \"Finder\" to delete POSIX file \"{}\"", path_str);
    
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to execute osascript: {}", e))?;
    
    Ok(())
}

pub fn delete_episode_audio(episode: &Episode) -> Result<(), String> {
    let uuid = episode.uuid.as_ref().ok_or("Episode has no UUID")?;
    let audio_path = get_audio_path(uuid).ok_or("Audio file not found")?;

    trash_file(&audio_path).map_err(|e| format!("Failed to move audio file to trash: {}", e))?;
    Ok(())
}

pub fn delete_multiple_episodes_audio(episodes: &[Episode]) -> Result<usize, String> {
    let mut count = 0;
    for episode in episodes {
        if let Some(uuid) = &episode.uuid {
            if let Some(audio_path) = get_audio_path(uuid) {
                if trash_file(&audio_path).is_ok() {
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}
