use quick_xml::events::Event;
use quick_xml::Reader;
use rusqlite::{Connection, OpenFlags};
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
    pub store_id: Option<String>,
    pub podcast_store_id: Option<String>,
    pub has_audio: bool,
    pub is_orphaned: bool,
    /// Plain-text episode description. Older saved metadata files don't have it.
    #[serde(default)]
    pub description: Option<String>,
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

pub fn get_cache_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("Library/Cache")
}

pub fn get_ttml_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("Library/Cache/Assets/TTML")
}

pub fn get_database_path(base_dir: &Path) -> PathBuf {
    base_dir.join("Documents/MTLibrary.sqlite")
}

pub fn get_audio_path(base_dir: &Path, uuid: &str) -> Option<PathBuf> {
    let cache_dir = get_cache_dir(base_dir);
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

/// Opens Apple's live Podcasts library read-only. We only ever SELECT from it,
/// so a read-write handle would just risk touching (or checkpointing) a
/// database that belongs to another app.
fn open_podcasts_db(db_path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open database: {}", e))
}

pub fn scan_ttml_files(base_dir: &Path) -> Result<Vec<Episode>, String> {
    let ttml_dir = get_ttml_dir(base_dir);

    let db_path = get_database_path(base_dir);
    if !db_path.exists() {
        return Err(format!(
            "Apple Podcasts library not found in {:?}. Choose the folder named \
             243LU875E5.groups.com.apple.podcasts, and open the Podcasts app at least once.",
            base_dir
        ));
    }

    // Podcasts creates the TTML folder the first time it downloads a transcript
    // (when you play an episode or open its transcript). No folder yet simply
    // means no transcripts yet: the UI explains what to do.
    if !ttml_dir.exists() {
        return Ok(Vec::new());
    }

    let conn = open_podcasts_db(&db_path)?;
    let metadata_sql = metadata_query(&conn)?;

    let mut episodes = Vec::new();
    find_ttml_files_recursive(&ttml_dir, &ttml_dir, &conn, &metadata_sql, &mut episodes, base_dir)?;

    Ok(episodes)
}

fn find_ttml_files_recursive(
    dir: &Path,
    base_dir: &Path,
    conn: &Connection,
    metadata_sql: &str,
    episodes: &mut Vec<Episode>,
    podcasts_base_dir: &Path,
) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {:?}: {}", dir, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            find_ttml_files_recursive(&path, base_dir, conn, metadata_sql, episodes, podcasts_base_dir)?;
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

            let metadata = query_episode_metadata(conn, metadata_sql, &transcript_identifier)?;

            let uuid = metadata.as_ref().and_then(|m| m.get("uuid").cloned().and_then(|v| v.as_str().map(|s| s.to_string())));
            let has_audio = uuid.as_ref().map(|u| get_audio_path(podcasts_base_dir, u).is_some()).unwrap_or(false);

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
                store_id: metadata.as_ref().and_then(|m| m.get("store_id").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                podcast_store_id: metadata.as_ref().and_then(|m| m.get("podcast_store_id").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
                has_audio,
                is_orphaned: false,
                description: metadata.as_ref().and_then(|m| m.get("description").cloned().and_then(|v| v.as_str().map(|s| s.to_string()))),
            });
        }
    }

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> bool {
    // PRAGMA arguments can't be bound; `table` is always one of our own constants.
    let names: Result<Vec<String>, rusqlite::Error> = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.collect::<Result<Vec<String>, _>>()
        });
    names.map(|cols| cols.iter().any(|c| c == column)).unwrap_or(false)
}

/// The SELECT list shared by both layouts. The plain-text description column
/// is optional so an unexpected schema can't break the whole scan.
fn metadata_columns(conn: &Connection) -> String {
    let description = if table_has_column(conn, "ZMTEPISODE", "ZITEMDESCRIPTIONWITHOUTHTML") {
        "e.ZITEMDESCRIPTIONWITHOUTHTML"
    } else {
        "NULL"
    };
    format!(
        "
        SELECT
            e.ZTITLE as episode_title,
            p.ZTITLE as podcast_title,
            p.ZAUTHOR as author,
            p.ZCATEGORY as category,
            e.ZPUBDATE as pub_date,
            e.ZIMPORTDATE as import_date,
            e.ZUUID as uuid,
            e.ZSTORETRACKID as store_id,
            p.ZSTORECOLLECTIONID as podcast_store_id,
            {description} as description"
    )
}

/// Picks the metadata query that matches this database. Newer Podcasts
/// versions keep the transcript identifier in ZMTMEDIAENCLOSURE (linked to the
/// episode through ZEPISODE); older ones had it as a column of ZMTEPISODE.
fn metadata_query(conn: &Connection) -> Result<String, String> {
    let columns = metadata_columns(conn);
    if table_has_column(conn, "ZMTMEDIAENCLOSURE", "ZTRANSCRIPTIDENTIFIER")
        && table_has_column(conn, "ZMTMEDIAENCLOSURE", "ZEPISODE")
    {
        Ok(format!(
            "{columns}
        FROM ZMTMEDIAENCLOSURE m
        JOIN ZMTEPISODE e ON e.Z_PK = m.ZEPISODE
        JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
        WHERE m.ZTRANSCRIPTIDENTIFIER = ?1"
        ))
    } else if table_has_column(conn, "ZMTEPISODE", "ZTRANSCRIPTIDENTIFIER") {
        Ok(format!(
            "{columns}
        FROM ZMTEPISODE e
        JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
        WHERE e.ZTRANSCRIPTIDENTIFIER = ?1"
        ))
    } else {
        Err("Unsupported Apple Podcasts database: could not find where transcripts are linked \
             to episodes (neither ZMTMEDIAENCLOSURE.ZTRANSCRIPTIDENTIFIER nor \
             ZMTEPISODE.ZTRANSCRIPTIDENTIFIER exists). Apple probably changed the schema."
            .to_string())
    }
}

/// `Ok(None)` means the transcript has no library entry (e.g. the episode was
/// removed but its cached transcript is still there). A real SQL error is
/// returned instead of being mistaken for "unknown episode".
fn query_episode_metadata(
    conn: &Connection,
    sql: &str,
    transcript_identifier: &str,
) -> Result<Option<HashMap<String, serde_json::Value>>, String> {
    let result = conn.query_row(sql, [transcript_identifier], |row| {
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
        
        if let Ok(store_id) = row.get::<_, i64>(7) {
            if store_id != 0 {
                map.insert("store_id".to_string(), serde_json::Value::String(store_id.to_string()));
            }
        }

        if let Ok(podcast_store_id) = row.get::<_, i64>(8) {
            if podcast_store_id != 0 {
                map.insert("podcast_store_id".to_string(), serde_json::Value::String(podcast_store_id.to_string()));
            }
        }

        if let Ok(Some(description)) = row.get::<_, Option<String>>(9) {
            let description = description.trim();
            if !description.is_empty() {
                map.insert("description".to_string(), serde_json::Value::String(description.to_string()));
            }
        }

        Ok(map)
    });

    match result {
        Ok(map) => Ok(Some(map)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Episode metadata lookup failed: {}", e)),
    }
}

pub fn search_episodes_content(query: String, episodes: Vec<Episode>) -> Vec<usize> {
    let query = query.to_lowercase();
    let mut results = Vec::new();

    for (index, episode) in episodes.iter().enumerate() {
        let path = if let Some(local_path) = &episode.local_ttml_path {
            if Path::new(local_path).exists() {
                local_path
            } else {
                &episode.file_path
            }
        } else {
            &episode.file_path
        };

        if let Ok(content) = fs::read_to_string(path) {
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
    // Try to read from local copy if it exists, otherwise use original path
    let ttml_path = if let Some(local_path) = &episode.local_ttml_path {
        if Path::new(local_path).exists() {
            local_path
        } else {
            &episode.file_path
        }
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

    let transcript_text = format!("{}{}", metadata_header(episode), transcript_text);

    // Create output directory if it doesn't exist
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Generate filenames
    let base_name = resolve_base_name(episode, Path::new(output_dir));

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
    let path = if let Some(local_path) = &episode.local_ttml_path {
        if Path::new(local_path).exists() {
            local_path
        } else {
            &episode.file_path
        }
    } else {
        &episode.file_path
    };

    let ttml_content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read TTML file: {}", e))?;

    parse_ttml(&ttml_content)
}

/// One piece of a text node: raw text from the document (`true`) or the
/// output of an entity/character reference (`false`).
type TextPiece = (bool, String);

/// Ends the current text node and appends it to the paragraph text followed by
/// a single space. Like the old `trim_text(true)`, only XML whitespace
/// (space, tab, CR, LF) is trimmed, only from the *raw* text at the two ends
/// of the node; whitespace produced by a reference (e.g. `&#32;`) is kept.
/// Nodes that end up empty are skipped.
fn flush_text_node(node: &mut Vec<TextPiece>, paragraph_text: &mut String) {
    const XML_WS: &[char] = &[' ', '\t', '\r', '\n'];
    if let Some((true, first)) = node.first_mut() {
        *first = first.trim_start_matches(XML_WS).to_string();
    }
    if let Some((true, last)) = node.last_mut() {
        *last = last.trim_end_matches(XML_WS).to_string();
    }
    let text: String = node.drain(..).map(|(_, s)| s).collect();
    if !text.is_empty() {
        paragraph_text.push_str(&text);
        paragraph_text.push(' ');
    }
}

/// Appends the character an entity or character reference stands for.
/// Unknown entities are skipped instead of discarding the surrounding text.
fn push_entity(out: &mut String, reference: &quick_xml::events::BytesRef) {
    if reference.is_char_ref() {
        if let Ok(Some(c)) = reference.resolve_char_ref() {
            out.push(c);
        }
    } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(reference) {
        out.push_str(s);
    }
}

fn parse_ttml(content: &str) -> Result<Vec<Paragraph>, String> {
    let mut reader = Reader::from_str(content);

    let mut paragraphs = Vec::new();
    let mut current_paragraph: Option<Paragraph> = None;
    let mut current_text = String::new();
    let mut in_paragraph = false;

    let get_begin = |e: &quick_xml::events::BytesStart| {
        e.attributes()
            .filter_map(|a| a.ok())
            .find(|attr| attr.key.local_name().as_ref() == "begin")
            .and_then(|attr| parse_ttml_time(attr.value.trim()))
    };

    let mut node: Vec<TextPiece> = Vec::new();

    loop {
        let event = reader.read_event();

        // quick-xml reports entity references (&amp;, &#39;, ...) as separate
        // events, so one text node can arrive in several pieces. Collect the
        // whole node here and finish it when the next tag/comment/end shows
        // up, which reproduces what a single text event used to give us.
        match &event {
            Ok(Event::Text(t)) => {
                if in_paragraph {
                    let raw: &str = t;
                    node.push((true, raw.to_string()));
                }
                continue;
            }
            Ok(Event::GeneralRef(r)) => {
                if in_paragraph {
                    let mut resolved = String::new();
                    push_entity(&mut resolved, r);
                    node.push((false, resolved));
                }
                continue;
            }
            _ => {}
        }
        flush_text_node(&mut node, &mut current_text);

        match event {
            Ok(Event::Start(e)) => {
                match e.local_name().as_ref() {
                    "p" => {
                        in_paragraph = true;
                        current_paragraph = Some(Paragraph {
                            begin: get_begin(&e),
                            text: String::new(),
                        });
                        current_text.clear();
                    }
                    "span" => {
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
                if e.local_name().as_ref() == "p" {
                    paragraphs.push(Paragraph {
                        begin: get_begin(&e),
                        text: String::new(),
                    });
                }
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == "p" {
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

use objc2_foundation::{NSFileManager, NSURL, NSString};

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

/// Local calendar date (YYYY-MM-DD) for an Apple "Mac absolute time" value
/// (seconds since 2001-01-01 UTC). Uses the Mac's time zone, like the UI does.
pub fn format_episode_date(mac_time: f64) -> Option<String> {
    if !mac_time.is_finite() {
        return None;
    }
    let unix = (mac_time + 978_307_200.0).floor() as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let ok = unsafe { !libc::localtime_r(&unix, &mut tm).is_null() };
    if !ok {
        return None;
    }
    Some(format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday))
}

/// The header written above every transcript whose episode is known.
pub fn metadata_header(episode: &Episode) -> String {
    let (Some(podcast), Some(title)) = (&episode.podcast_title, &episode.episode_title) else {
        return String::new();
    };
    let date = episode
        .pub_date
        .and_then(format_episode_date)
        .unwrap_or_else(|| "Unknown Date".to_string());
    let mut header = format!("Podcast: {}\nDate: {}\nEpisode: {}\n", podcast, date, title);
    if let Some(description) = episode.description.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        header.push_str("\nDescription:\n");
        header.push_str(description);
        header.push('\n');
    }
    header.push('\n');
    header
}

/// File name (without extension) for an episode's transcript:
/// "<podcast> - <YYYY-MM-DD> - <episode>", so a show's files sort by date.
/// Keep in sync with `getExpectedFilename` in src/main.js.
pub fn transcript_base_name(episode: &Episode) -> String {
    match (&episode.podcast_title, &episode.episode_title) {
        (Some(podcast), Some(title)) => {
            match episode.pub_date.and_then(format_episode_date) {
                Some(date) => sanitize_filename(&format!("{} - {} - {}", podcast, date, title)),
                None => sanitize_filename(&format!("{} - {}", podcast, title)),
            }
        }
        _ => episode.transcript_identifier.replace("/", "_"),
    }
}

/// The name used before dates were added (v0.1.x): "<podcast> - <episode>".
pub fn legacy_transcript_base_name(episode: &Episode) -> String {
    match (&episode.podcast_title, &episode.episode_title) {
        (Some(podcast), Some(title)) => sanitize_filename(&format!("{} - {}", podcast, title)),
        _ => episode.transcript_identifier.replace("/", "_"),
    }
}

/// The name to use in `output_dir`: an episode extracted by an older version
/// keeps its old file name, so re-extracting or deleting it never leaves a
/// duplicate behind.
pub fn resolve_base_name(episode: &Episode, output_dir: &Path) -> String {
    let current = transcript_base_name(episode);
    let legacy = legacy_transcript_base_name(episode);
    if current != legacy
        && !output_dir.join(format!("{}.txt", current)).exists()
        && output_dir.join(format!("{}.txt", legacy)).exists()
    {
        legacy
    } else {
        current
    }
}

pub fn is_within_dir(path: &Path, base_dir: &Path) -> bool {
    let path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let base_dir = match base_dir.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    path.starts_with(base_dir)
}

pub fn trash_file(path: &Path, base_dir: &Path) -> Result<(), String> {
    if !is_within_dir(path, base_dir) {
        return Err(format!(
            "Access denied: Path {:?} is outside of approved directory {:?}",
            path, base_dir
        ));
    }

    let file_manager = NSFileManager::defaultManager();
    let path_str = path.to_str().ok_or("Invalid path encoding")?;
    let ns_path = NSString::from_str(path_str);
    let url = NSURL::fileURLWithPath(&ns_path);
    
    file_manager.trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| format!("Failed to move to Trash: {}", e))?;
    
    Ok(())
}

pub fn delete_episode_audio(base_dir: &Path, episode: &Episode) -> Result<(), String> {
    let uuid = episode.uuid.as_ref().ok_or("Episode has no UUID")?;
    let audio_path = get_audio_path(base_dir, uuid).ok_or("Audio file not found")?;

    trash_file(&audio_path, base_dir).map_err(|e| format!("Failed to move audio file to trash: {}", e))?;
    Ok(())
}

pub fn delete_multiple_episodes_audio(base_dir: &Path, episodes: &[Episode]) -> Result<usize, String> {
    let mut count = 0;
    for episode in episodes {
        if let Some(uuid) = &episode.uuid {
            if let Some(audio_path) = get_audio_path(base_dir, uuid) {
                if trash_file(&audio_path, base_dir).is_ok() {
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

/// Names of the entries directly inside `dir` (files and folders, hidden ones
/// included). The UI uses this to tell which transcripts were already
/// extracted, so the webview itself needs no filesystem permission.
pub fn list_dir_names(dir: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {:?}: {}", dir, e))?;
    Ok(entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch directory under the system temp dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "pte-test-{}-{}-{}",
                tag,
                std::process::id(),
                nanos
            ));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn list_dir_names_returns_files_and_folders_including_hidden() {
        let t = TempDir::new("list");
        fs::write(t.path().join("Show - It's an episode.txt"), "x").unwrap();
        fs::create_dir(t.path().join(".metadata")).unwrap();

        let mut names = list_dir_names(t.path()).unwrap();
        names.sort();

        assert_eq!(
            names,
            vec![".metadata".to_string(), "Show - It's an episode.txt".to_string()]
        );
    }

    #[test]
    fn list_dir_names_errors_on_missing_dir() {
        let t = TempDir::new("missing");
        assert!(list_dir_names(&t.path().join("does-not-exist")).is_err());
    }

    const TRANSCRIPT_ID: &str = "PodcastContent1/v4/aa/bb/cc/x/transcript_1.ttml";

    /// Minimal stand-in for Apple's MTLibrary.sqlite (WAL mode, like the real
    /// one) plus one TTML file for the scanner to find. Returns the base dir.
    fn podcasts_fixture(t: &TempDir) -> PathBuf {
        let base = t.path().to_path_buf();
        let ttml_dir = get_ttml_dir(&base).join("PodcastContent1/v4/aa/bb/cc/x");
        fs::create_dir_all(&ttml_dir).unwrap();
        fs::write(
            ttml_dir.join("transcript_1.ttml"),
            r#"<tt><body><div><p begin="1.0">hi</p></div></body></tt>"#,
        )
        .unwrap();
        fs::create_dir_all(base.join("Documents")).unwrap();

        let conn = Connection::open(get_database_path(&base)).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        conn.execute_batch(&format!(
            "CREATE TABLE ZMTPODCAST (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
                 ZAUTHOR VARCHAR, ZCATEGORY VARCHAR, ZSTORECOLLECTIONID INTEGER);
             CREATE TABLE ZMTEPISODE (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
                 ZPODCASTUUID VARCHAR, ZTRANSCRIPTIDENTIFIER VARCHAR, ZPUBDATE FLOAT,
                 ZIMPORTDATE FLOAT, ZSTORETRACKID INTEGER);
             INSERT INTO ZMTPODCAST (ZUUID, ZTITLE, ZAUTHOR, ZCATEGORY, ZSTORECOLLECTIONID)
                 VALUES ('P1', 'Dan''s Show', 'Dan', 'Comedy', 123);
             INSERT INTO ZMTEPISODE (ZUUID, ZTITLE, ZPODCASTUUID, ZTRANSCRIPTIDENTIFIER,
                 ZPUBDATE, ZIMPORTDATE, ZSTORETRACKID)
                 VALUES ('E1', 'Say \"hi\" <b>', 'P1', '{}', 700000000.0, 700000001.0, 456);",
            TRANSCRIPT_ID
        ))
        .unwrap();
        base
    }

    #[test]
    fn podcasts_db_is_opened_read_only() {
        let t = TempDir::new("ro");
        let base = podcasts_fixture(&t);

        let conn = open_podcasts_db(&get_database_path(&base)).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM ZMTEPISODE", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "reads must work on a WAL-mode database");
        assert!(conn.execute("DELETE FROM ZMTEPISODE", []).is_err(), "writes must be refused");
        assert!(conn.execute("CREATE TABLE evil (x)", []).is_err(), "schema changes must be refused");
    }

    #[test]
    fn scan_finds_episode_with_metadata_and_does_not_modify_the_db() {
        let t = TempDir::new("scan");
        let base = podcasts_fixture(&t);
        let db = get_database_path(&base);
        let before = fs::read(&db).unwrap();

        let episodes = scan_ttml_files(&base).unwrap();

        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].transcript_identifier, TRANSCRIPT_ID);
        assert_eq!(episodes[0].podcast_title.as_deref(), Some("Dan's Show"));
        assert_eq!(episodes[0].episode_title.as_deref(), Some("Say \"hi\" <b>"));
        assert_eq!(fs::read(&db).unwrap(), before, "scanning must not modify the database file");
    }

    #[test]
    fn reads_rows_still_in_the_wal_while_podcasts_has_the_db_open() {
        let t = TempDir::new("wal");
        let base = podcasts_fixture(&t);

        // Stand-in for the running Podcasts app: a writer that keeps the WAL "hot"
        // (committed rows not yet checkpointed into the main database file).
        let writer = Connection::open(get_database_path(&base)).unwrap();
        writer
            .execute("UPDATE ZMTEPISODE SET ZTITLE = 'Fresh title'", [])
            .unwrap();

        let episodes = scan_ttml_files(&base).unwrap();
        assert_eq!(episodes[0].episode_title.as_deref(), Some("Fresh title"));
        drop(writer);
    }

    #[test]
    fn parse_ttml_reads_paragraph_text_and_start_times() {
        let xml = r#"<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="1.5" end="4"><span>Hello</span> <span>world</span></p>
  <p begin="00:01:02.5"><span begin="62.5">Second</span></p>
</div></body></tt>"#;

        let paragraphs = parse_ttml(xml).unwrap();

        assert_eq!(paragraphs.len(), 2);
        assert_eq!(paragraphs[0].text, "Hello world");
        assert_eq!(paragraphs[0].begin, Some(1.5));
        assert_eq!(paragraphs[1].text, "Second");
        assert_eq!(paragraphs[1].begin, Some(62.5));
    }

    #[test]
    fn parse_ttml_handles_namespace_prefixes_and_entities() {
        let xml = r#"<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
  <tt:p begin="10"><tt:span>Tom &amp; Jerry&#39;s &lt;show&gt;</tt:span></tt:p>
</tt:div></tt:body></tt:tt>"#;

        let paragraphs = parse_ttml(xml).unwrap();

        assert_eq!(paragraphs.len(), 1);
        assert_eq!(paragraphs[0].text, "Tom & Jerry's <show>");
        assert_eq!(paragraphs[0].begin, Some(10.0));
    }

    #[test]
    fn parse_ttml_keeps_spacing_around_entities() {
        let xml = r#"<tt><body><div>
  <p begin="1">Tom &amp; Jerry</p>
  <p begin="2">AT&amp;T &#x41;&#66;C</p>
  <p begin="3"><span>one</span><span>two</span></p>
</div></body></tt>"#;

        let paragraphs = parse_ttml(xml).unwrap();

        // spaces around a reference survive
        assert_eq!(paragraphs[0].text, "Tom & Jerry");
        // no separator is invented inside one text node; hex and decimal char refs work
        assert_eq!(paragraphs[1].text, "AT&T ABC");
        // separate spans are still joined by exactly one space
        assert_eq!(paragraphs[2].text, "one two");
    }

    #[test]
    fn parse_ttml_rejects_mismatched_tags() {
        let xml = r#"<tt><body><div><p begin="1">a</span></div></body></tt>"#;
        assert!(parse_ttml(xml).is_err());
    }

    fn write_ttml(base: &Path, id: &str) {
        let file = get_ttml_dir(base).join(id);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, r#"<tt><body><div><p begin="1.0">hi</p></div></body></tt>"#).unwrap();
    }

    /// WAL-mode database built from `sql`, plus the TTML file for TRANSCRIPT_ID.
    fn fixture_with_sql(t: &TempDir, sql: &str) -> PathBuf {
        let base = t.path().to_path_buf();
        write_ttml(&base, TRANSCRIPT_ID);
        fs::create_dir_all(base.join("Documents")).unwrap();
        let conn = Connection::open(get_database_path(&base)).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        conn.execute_batch(sql).unwrap();
        base
    }

    /// Layout written by current Podcasts versions: the transcript identifier is
    /// in ZMTMEDIAENCLOSURE (linked through ZEPISODE), not in ZMTEPISODE. The row
    /// numbers are chosen so that joining on the wrong key (enclosure Z_PK =
    /// episode Z_PK) would return the decoy episode instead of the right one.
    const CURRENT_SCHEMA_SQL: &str = r#"
        CREATE TABLE ZMTPODCAST (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
            ZAUTHOR VARCHAR, ZCATEGORY VARCHAR, ZSTORECOLLECTIONID INTEGER);
        CREATE TABLE ZMTEPISODE (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
            ZPODCASTUUID VARCHAR, ZPUBDATE FLOAT, ZIMPORTDATE FLOAT, ZSTORETRACKID INTEGER,
            ZCURRENTMEDIAENCLOSURE INTEGER);
        CREATE TABLE ZMTMEDIAENCLOSURE (Z_PK INTEGER PRIMARY KEY, ZEPISODE INTEGER,
            ZTRANSCRIPTIDENTIFIER VARCHAR);
        INSERT INTO ZMTPODCAST (ZUUID, ZTITLE, ZAUTHOR, ZCATEGORY, ZSTORECOLLECTIONID)
            VALUES ('P1', 'Dan''s Show', 'Dan', 'Comedy', 123);
        INSERT INTO ZMTEPISODE (Z_PK, ZUUID, ZTITLE, ZPODCASTUUID, ZPUBDATE, ZIMPORTDATE,
            ZSTORETRACKID, ZCURRENTMEDIAENCLOSURE) VALUES
            (1, 'E0', 'Decoy episode', 'P1', 1.0, 1.0, 111, 2),
            (2, 'E1', 'Say "hi" <b>', 'P1', 700000000.0, 700000001.0, 456, 1);
        INSERT INTO ZMTMEDIAENCLOSURE (Z_PK, ZEPISODE, ZTRANSCRIPTIDENTIFIER) VALUES
            (1, 2, 'PodcastContent1/v4/aa/bb/cc/x/transcript_1.ttml'),
            (2, 1, 'PodcastContent9/v4/zz/zz/zz/x/transcript_9.ttml');
    "#;

    /// A schema where the transcript identifier can't be found anywhere.
    const UNSUPPORTED_SCHEMA_SQL: &str = r#"
        CREATE TABLE ZMTPODCAST (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR);
        CREATE TABLE ZMTEPISODE (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZTITLE VARCHAR,
            ZPODCASTUUID VARCHAR);
    "#;

    #[test]
    fn scan_finds_metadata_in_the_current_apple_schema() {
        let t = TempDir::new("current");
        let base = fixture_with_sql(&t, CURRENT_SCHEMA_SQL);

        let episodes = scan_ttml_files(&base).unwrap();

        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].transcript_identifier, TRANSCRIPT_ID);
        assert_eq!(episodes[0].podcast_title.as_deref(), Some("Dan's Show"));
        assert_eq!(episodes[0].episode_title.as_deref(), Some("Say \"hi\" <b>"));
        assert_eq!(episodes[0].store_id.as_deref(), Some("456"));
    }

    #[test]
    fn transcript_without_a_library_entry_is_listed_without_metadata() {
        let t = TempDir::new("orphan");
        let base = fixture_with_sql(&t, CURRENT_SCHEMA_SQL);
        write_ttml(&base, "PodcastContent2/v4/aa/bb/cc/y/transcript_2.ttml");

        let mut episodes = scan_ttml_files(&base).unwrap();
        episodes.sort_by(|a, b| a.transcript_identifier.cmp(&b.transcript_identifier));

        assert_eq!(episodes.len(), 2);
        assert_eq!(episodes[0].episode_title.as_deref(), Some("Say \"hi\" <b>"));
        assert!(episodes[1].episode_title.is_none() && episodes[1].podcast_title.is_none());
    }

    #[test]
    fn unsupported_schema_is_an_error_not_unknown_episodes() {
        let t = TempDir::new("unsupported");
        let base = fixture_with_sql(&t, UNSUPPORTED_SCHEMA_SQL);

        let err = scan_ttml_files(&base).unwrap_err();

        assert!(err.contains("Unsupported Apple Podcasts database"), "{err}");
    }

    fn sample_episode() -> Episode {
        Episode {
            transcript_identifier: "PodcastContent1/v4/x/transcript_1.ttml".into(),
            file_path: String::new(),
            local_ttml_path: None,
            uuid: None,
            episode_title: Some("Who's \"next\"?".into()),
            podcast_title: Some("Dan's Show".into()),
            author: None,
            category: None,
            // 2026-06-15 12:00 UTC: midday, so the local date is the same in every time zone
            pub_date: Some(803_217_600.0),
            import_date: None,
            store_id: None,
            podcast_store_id: None,
            has_audio: false,
            is_orphaned: false,
            description: Some("  About the show.  ".into()),
        }
    }

    #[test]
    fn file_name_has_the_episode_date_between_show_and_title() {
        let ep = sample_episode();
        assert_eq!(transcript_base_name(&ep), "Dan's Show - 2026-06-15 - Who's -next--");
        assert_eq!(legacy_transcript_base_name(&ep), "Dan's Show - Who's -next--");

        let mut undated = ep.clone();
        undated.pub_date = None;
        assert_eq!(transcript_base_name(&undated), "Dan's Show - Who's -next--");

        let mut unknown = ep.clone();
        unknown.podcast_title = None;
        assert_eq!(transcript_base_name(&unknown), "PodcastContent1_v4_x_transcript_1.ttml");
    }

    #[test]
    fn already_extracted_files_keep_their_old_name() {
        let t = TempDir::new("names");
        let ep = sample_episode();
        assert_eq!(resolve_base_name(&ep, t.path()), transcript_base_name(&ep));

        fs::write(t.path().join(format!("{}.txt", legacy_transcript_base_name(&ep))), "old").unwrap();
        assert_eq!(resolve_base_name(&ep, t.path()), legacy_transcript_base_name(&ep));

        fs::write(t.path().join(format!("{}.txt", transcript_base_name(&ep))), "new").unwrap();
        assert_eq!(resolve_base_name(&ep, t.path()), transcript_base_name(&ep));
    }

    #[test]
    fn header_lists_show_date_episode_and_description() {
        let ep = sample_episode();
        assert_eq!(
            metadata_header(&ep),
            "Podcast: Dan's Show\nDate: 2026-06-15\nEpisode: Who's \"next\"?\n\nDescription:\nAbout the show.\n\n"
        );
        let mut no_desc = ep.clone();
        no_desc.description = None;
        assert_eq!(
            metadata_header(&no_desc),
            "Podcast: Dan's Show\nDate: 2026-06-15\nEpisode: Who's \"next\"?\n\n"
        );
        let mut unknown = ep;
        unknown.episode_title = None;
        assert_eq!(metadata_header(&unknown), "");
    }

    #[test]
    fn extraction_writes_header_and_dated_file_name() {
        let t = TempDir::new("extract");
        let ttml = t.path().join("in.ttml");
        fs::write(
            &ttml,
            r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1:02.5"><span>Hello</span> <span>there</span></p></div><div><p begin="3723.0"><span>Bye &amp; thanks</span></p></div></body></tt>"#,
        )
        .unwrap();
        let mut ep = sample_episode();
        ep.file_path = ttml.to_string_lossy().to_string();
        let out = t.path().join("out");
        let (path, name) = extract_transcript(&ep, out.to_str().unwrap(), true).unwrap();
        assert_eq!(name, "Dan's Show - 2026-06-15 - Who's -next--.txt");
        let text = fs::read_to_string(path).unwrap();
        assert!(text.starts_with("Podcast: Dan's Show\nDate: 2026-06-15\n"), "{text}");
        assert!(text.ends_with("[00:01:02] Hello there\n\n[01:02:03] Bye & thanks"), "{text}");
    }

    /// Runs the whole scan + extract pipeline against a copied Podcasts
    /// folder: `FIXTURE_PODCASTS_DIR=<dir> cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn end_to_end_against_fixture_library() {
        let Ok(dir) = std::env::var("FIXTURE_PODCASTS_DIR") else { return };
        let episodes = scan_ttml_files(Path::new(&dir)).expect("scan");
        assert!(!episodes.is_empty(), "no episodes found in {dir}");
        let out = TempDir::new("e2e");
        for ep in &episodes {
            let (path, name) = extract_transcript(ep, out.path().to_str().unwrap(), true).expect("extract");
            let text = fs::read_to_string(path).unwrap();
            println!("=== {name}\n{}\n", text.chars().take(400).collect::<String>());
        }
    }
}
