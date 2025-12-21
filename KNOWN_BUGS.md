# Known Bugs to Fix

## Context Menu "Click-Through" Selection
**Description**: When the custom context menu is open, clicking anywhere else on the screen (e.g., on another podcast row) should *only* close the context menu. Currently, it closes the menu but also triggers the action on the element clicked (like selecting a different podcast).

**Attempts to Fix**:
1.  **Attempt 1**: Added a `mousedown` listener on `document` to hide the menu. 
    *   *Result*: Menu closed, but propagation continued to the underlying element.
2.  **Attempt 2**: Added explicit `elements.contextMenu.classList.add("hidden")` inside the `toggleEpisode` function.
    *   *Result*: Menu closed, but selection still occurred because `toggleEpisode` was still being called.
3.  **Attempt 3**: Implemented a `mousedown` listener on `window` using the **Capture Phase** (`true`) with `e.stopPropagation()` and `e.stopImmediatePropagation()`.
    *   *Result*: Failed to block the selection, likely because the browser-level checkbox toggle or other event types (like `click`) were still firing.
4.  **Attempt 4**: Shared the capture-phase logic between both `mousedown` and `click` events to catch and consume the interaction at the earliest possible stage.
    *   *Result*: User reports the issue still persists.

**Hypothesis**: The episode selection logic might be triggered by an event we aren't yet intercepting in the capture phase (perhaps `pointerdown` or a specific interaction within the Tauri/WebView environment), or the DOM structure of the `episode-item` is capturing the event in a way that bypasses the window-level interceptor.
