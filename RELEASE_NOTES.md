**Transcript Extractor is now signed and notarized by Apple.** It opens like any other app: no more "damaged" warning, no Terminal command.

### New
- **Dated file names**: transcripts are saved as `<podcast> - YYYY-MM-DD - <episode>.txt`. Files saved by older versions keep their names.
- **Header in every transcript**: podcast, date, episode title and description at the top. Thanks @guilhermesimoes (#9).
- **Opens straight to your episodes** once you've given it the Podcasts folder.
- **Universal build**: runs natively on Apple silicon and Intel Macs.

### Fixed
- **Works with the newer Podcasts database** (seen on macOS 27), where every episode showed as "Unknown". Thanks @lucagattoni (#10).
- **Timestamps** now read every format Apple uses (seconds, minutes and clock times). Thanks @guilhermesimoes (#8).
- **"Can't find any podcasts" / "no TTML folder"** (#7, #2): the app now explains that Apple only saves a transcript after you open it, instead of failing.
- **Safer**: episode text from podcast feeds can no longer inject code into the app, the app opens the Podcasts database read-only, and it no longer has blanket access to your home folder. Thanks @lucagattoni (#10).

### Command-line script
- `--timestamps` works in single-file mode, every section of a transcript is kept (previously only the first), and `--podcasts-dir` reads a copied Podcasts folder.
