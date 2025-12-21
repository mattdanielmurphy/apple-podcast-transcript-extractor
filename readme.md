<p align="center">
  <img width="128" alt="app-icon" src="https://github.com/user-attachments/assets/1191747e-1034-4eef-ae1b-eb55fc06e3e2" />
</p>

# Apple Podcasts Transcript Extractor

This tool extracts transcripts from the Podcasts app on macOS.

### Important Notes
- In order to extract a podcast transcript, you must **download** the podcast episode in the Apple Podcasts app.
- Apple does not generate transcripts for podcasts in private feeds (ie a premium podcast feed with no ads), and so obviously this app cannot extract a transcript from them.

## 🚀 Recommended: macOS Application

<p align="center">
  <img width="900" alt="image" src="https://github.com/user-attachments/assets/921dcfca-a9f0-4f5d-838a-456798a06417" />
  <img width="900" alt="image" src="https://github.com/user-attachments/assets/0731f40f-68f5-4e08-b316-b5800e5b618b" />
</p>

### Installation (macOS)

1.  Download the latest `Transcript-Extractor.zip` from the [Releases](https://github.com/mattdanielmurphy/apple-podcast-transcript-extractor/releases) page.
2.  Unzip and drag `Transcript Extractor.app` to your `/Applications` folder.
3.  **Note for macOS Users**: I currently do not have a paid Apple developer account. As a result, macOS may treat the app as unsafe or "damaged" because it is not notarized. In order to open it, you must run the following command in Terminal after dragging the app to your Applications folder:
    ```bash
    xattr -cr /Applications/Transcript\ Extractor.app
    ```
    I should have a paid developer account soon so that this won't be an issue.

## Features
- **Native macOS Interface**: A polished, easy-to-use GUI.
- **Enhanced Browsing**: Easily search and filter through your downloaded podcast transcripts.
- **Delete Podcast Audio**: Clean up your disk if you would rather not have the audio downloaded.
- **One-Click Export**: Quickly save transcripts to your preferred location.
- **No Setup Required**: Just download and run—no need to install Node.js or run scripts.

### Download
👉 **[Download the latest version of Transcript Extractor](https://github.com/mattdanielmurphy/apple-podcast-transcript-extractor/releases/latest)**

---

## 💻 Developer Tool (CLI)

For developers or those who prefer the terminal, a command-line script is also available.

## Installation

1. Clone the repository
2. Install dependencies: `npm install`

## Usage

### Batch Mode
To process all TTML files in your Apple Podcasts cache:
```bash
node extractTranscript.js [--timestamps]
```

This will:
1. Find all TTML files in `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML`
2. Create a `./transcripts` directory
3. Save each transcript as `./transcripts/<podcast_name> - <episode_title>.txt`

Note the podcast name and episode title are extracted from the SQLite database at `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite`.

**Duplicate handling**: If multiple episodes have the same podcast name and episode title, the script will add a suffix like `(1)`, `(2)`, etc. to avoid overwriting files.

Sample output is:
```
$ ls ./transcripts
Secret Leaders - Hermann Hauser- The Man Who Saved Apple from Bankruptcy.txt
Secret Leaders - How to Earn Millions by charging $0.txt
Secret Leaders - I built a $2bn Company By Paying Everybody The Same As Me - Nicola Kilner.txt
Secret Leaders - Spencer Matthews- How pushing my body to the limit changed my life.txt
The BugBash Podcast - Ergonomics, reliability, durability.txt
The BugBash Podcast - Every map is wrong, but we made one anyway.txt
The BugBash Podcast - FoundationDB- From Idea to Apple Acquisition.txt
The Intelligence from The Economist - Against the clock- Gaza peace talks.txt
The Intelligence from The Economist - All the president’s money men- the Trumponomics team.txt
The Intelligence from The Economist - Billions of voices heard- a year of elections.txt
```

### Timestamps Option
Add `--timestamps` to include timestamps for each paragraph in the format `[HH:MM:SS]`.

For example:
```
[00:01:23] This is what the speaker said
[00:01:25] And then they said this
```

### Single File Mode
```bash
node extractTranscript.js <input_file> <output_file> [--timestamps]
```

## Where does the input file come from?

The input file comes from the `transcript_<long_episode_id>.ttml` file in the `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML/PodcastContent<short_episode_id>` directory.

## How does the script find episodes?

The script automatically discovers all TTML transcript files in the Apple Podcasts cache directory and matches them with episode metadata from the SQLite database. If metadata cannot be found for a particular transcript, the script falls back to using the episode ID from the file path.

## SQLite Database Reference

The script uses the Apple Podcasts SQLite database to retrieve episode and podcast metadata.

**Database location**: `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite`

### Key Tables

**`ZMTEPISODE`** (episodes):
  - `ZTITLE` - Episode title
  - `ZITEMDESCRIPTION` - Episode description
  - `ZPUBDATE` - Publication date
  - `ZDURATION` - Episode duration
  - `ZPODCASTUUID` - Links to podcast
  - `ZTRANSCRIPTIDENTIFIER` - Matches the TTML file path (e.g., `PodcastContent112/v4/aa/35/30/aa35304c-cf37-97f4-fe9f-08cc3aee2c86/transcript_1000415837465.ttml`)

**`ZMTPODCAST`** (podcasts/shows):
  - `ZTITLE` - Podcast title
  - `ZAUTHOR` - Podcast author
  - `ZCATEGORY` - Podcast category
  - `ZUUID` - Podcast UUID (matches `ZPODCASTUUID` in episodes)

**`ZMTCHANNEL`** (channels):
  - `ZNAME` - Channel name
  - Linked via `ZCHANNEL` field in `ZMTPODCAST`

### Example Queries

**Finding transcript identifiers:**
```bash
sqlite3 ~/Library/Group\ Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite
sqlite> SELECT ZTRANSCRIPTIDENTIFIER FROM ZMTEPISODE LIMIT 5;
PodcastContent112/v4/aa/35/30/aa35304c-cf37-97f4-fe9f-08cc3aee2c86/transcript_1000415837465.ttml
PodcastContent122/v4/f4/1a/aa/f41aaa81-24f0-b259-9870-9b1e48e676f6/transcript_1000427522064.ttml

**Getting episode metadata:**
```bash
sqlite> SELECT e.ZTITLE as episode_title, e.ZPUBDATE, e.ZDURATION,
   ...>        p.ZTITLE as podcast_title, p.ZAUTHOR, p.ZCATEGORY
   ...>   FROM ZMTEPISODE e
   ...>   JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
   ...>   WHERE e.ZTRANSCRIPTIDENTIFIER = "PodcastContent112/v4/aa/35/30/aa35304c-cf37-97f4-fe9f-08cc3aee2c86/transcript_1000415837465.ttml";
Supernova in the East I|553291535|16097.0|Dan Carlin's Hardcore History|Dan Carlin|History
```

**Example: Finding metadata for a specific TTML file**

For a file like `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML/PodcastContent221/v4/02/af/94/02af94ae-1dd8-3aea-44c4-24c467bdddfd/transcript_1000740205141.ttml-1000740205141.ttml`, the `ZTRANSCRIPTIDENTIFIER` is `PodcastContent221/v4/02/af/94/02af94ae-1dd8-3aea-44c4-24c467bdddfd/transcript_1000740205141.ttml`:

```bash
sqlite> SELECT ZTRANSCRIPTIDENTIFIER FROM ZMTEPISODE 
   ...> WHERE ZTRANSCRIPTIDENTIFIER LIKE "%02af94ae-1dd8-3aea-44c4-24c467bdddfd/transcript_1000740205141.ttml%";
PodcastContent221/v4/02/af/94/02af94ae-1dd8-3aea-44c4-24c467bdddfd/transcript_1000740205141.ttml

sqlite> SELECT e.ZTITLE as episode_title, e.ZPUBDATE, e.ZDURATION, 
   ...>        p.ZTITLE as podcast_title, p.ZAUTHOR, p.ZCATEGORY 
   ...>   FROM ZMTEPISODE e 
   ...>   JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID 
   ...>   WHERE e.ZTRANSCRIPTIDENTIFIER = "PodcastContent221/v4/02/af/94/02af94ae-1dd8-3aea-44c4-24c467bdddfd/transcript_1000740205141.ttml";
Transitional injustice: Syria one year after Assad|786884509|1486.0|The Intelligence from The Economist|The Economist|Daily News
```

### Generating Schema File

To generate a complete schema file for reference:
```bash
sqlite3 ~/Library/Group\ Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite .schema > schema.sql
```
