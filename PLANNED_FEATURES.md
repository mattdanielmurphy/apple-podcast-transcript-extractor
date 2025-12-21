# Planned Features

## 1. Interactive Transcript Playback
Allow users to click timestamps within the Transcript View to play the audio from that specific moment.

### Phase 1: External Deep Linking (Quick Win)
- **Description**: Clicking a timestamp (e.g., `[00:12:34]`) opens the macOS Podcasts app and jumps to that time.
- **Implementation**:
    - Update `renderTranscriptContent` to wrap timestamps in a clickable element.
    - Use the `https://podcasts.apple.com/...` URL scheme with the `?t=seconds` parameter.
    - MacOS will automatically handle these links by opening the native Podcasts app at the requested position.

### Phase 2: Built-in Audio Player
- **Description**: Add a native audio player directly within the Transcript View.
- **Implementation**:
    - Use the HTML5 `<audio>` tag or a custom player UI.
    - Point the source to the cached audio file already discovered by the backend.
    - Highlight the currently playing paragraph in real-time as the audio progresses.
    - Clicking a paragraph or timestamp updates the `currentTime` of the local player.
