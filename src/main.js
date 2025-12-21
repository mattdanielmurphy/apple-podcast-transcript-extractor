// State
let episodes = []
let existingTranscripts = new Set()
let selectedEpisodes = new Set()
let activeTab = "new" // "new" or "existing"
let searchQuery = ""
let contentSearchQuery = ""
let filterBySelection = false
let sortOption = "podcast-date-desc"
let contentSearchResults = new Set() // Set of indices that match content search
let transcriptTimestampState = new Map() // episode.transcript_identifier -> boolean (last extracted with timestamps)
let anchorIndex = null // A: anchor index used for Shift ranges
let lastShiftTarget = null // E: last Shift-click target
let selectionOverrides = new Map() // T: manual overrides (index -> 'selected' | 'deselected')
let isScanning = false // Whether a scan is currently in progress
let podcastsDataDir = "" // Path to the Podcasts group container

// Modal Search State
let modalSearchQuery = ""
let modalSearchResults = []
let currentMatchIndex = -1

// DOM Elements
const elements = {
	totalCount: document.getElementById("total-count"),
	selectedCount: document.getElementById("selected-count"),
	outputDir: document.getElementById("output-dir"),
	chooseDirBtn: document.getElementById("choose-dir-btn"),
	scanBtn: document.getElementById("scan-btn"),
	selectAllBtn: document.getElementById("select-all-btn"),
	deselectAllBtn: document.getElementById("deselect-all-btn"),
	emptyState: document.getElementById("empty-state"),
	episodesList: document.getElementById("episodes-list"),
	progressSection: document.getElementById("progress-section"),
	progressBar: document.getElementById("progress-bar"),
	progressCount: document.getElementById("progress-count"),
	progressCurrent: document.getElementById("progress-current"),
	successSection: document.getElementById("success-section"),
	successMessageLarge: document.getElementById("success-message-large"),
	successOpenFolderBtn: document.getElementById("success-open-folder-btn"),
	successOkBtn: document.getElementById("success-ok-btn"),
	successCloseBtn: document.getElementById("success-close-btn"),
	statusBar: document.getElementById("status-bar"),
	statusMessage: document.getElementById("status-message"),
	openFolderBtn: document.getElementById("open-folder-btn"),
	resetDirBtn: document.getElementById("reset-dir-btn"),
	openPodcastsBtn: document.getElementById("open-podcasts-btn"),
	countNew: document.getElementById("count-new"),
	countExisting: document.getElementById("count-existing"),
	searchInput: document.getElementById("search-input"),
	contentSearchInput: document.getElementById("content-search-input"),
	filterSelectionBtn: document.getElementById("filter-selection-btn"),
	sortSelect: document.getElementById("sort-select"),

	// Modal
	modal: document.getElementById("transcript-modal"),
	modalOverlay: document.getElementById("modal-overlay"),
	modalCloseBtn: document.getElementById("modal-close-btn"),
	modalContent: document.getElementById("transcript-content"),
	modalEpisodeTitle: document.getElementById("modal-episode-title"),
	modalPodcastTitle: document.getElementById("modal-podcast-title"),
	modalSearchInfo: document.getElementById("modal-search-info"),
	modalExtractBtn: document.getElementById("modal-extract-btn"),
	modalOpenBtn: document.getElementById("modal-open-btn"),
	modalRevealBtn: document.getElementById("modal-reveal-btn"),
	modalDeleteTranscriptBtn: document.getElementById("modal-delete-transcript-btn"),
	modalOpenPodcastsBtn: document.getElementById("modal-open-podcasts-btn"),
	modalOpenAudioBtn: document.getElementById("modal-open-audio-btn"),
	modalRevealAudioBtn: document.getElementById("modal-reveal-audio-btn"),
	modalCopyBtn: document.getElementById("modal-copy-btn"),
	modalDeleteAudioBtn: document.getElementById("modal-delete-audio-btn"),
	modalAudioDivider: document.getElementById("modal-audio-divider"),
	modalAudioGroup: document.getElementById("modal-audio-group"),
	modalSearchInput: document.getElementById("modal-search-input"),
	modalSearchCount: document.getElementById("modal-search-count"),
	modalSearchPrev: document.getElementById("modal-search-prev"),
	modalSearchNext: document.getElementById("modal-search-next"),

	// Context Menu
	contextMenu: document.getElementById("context-menu"),
	cmView: document.getElementById("cm-view"),
	cmOpenPodcasts: document.getElementById("cm-open-podcasts"),
	cmOpen: document.getElementById("cm-open"),
	cmReveal: document.getElementById("cm-reveal"),
	cmDeleteTranscript: document.getElementById("cm-delete-transcript"),
	cmSelect: document.getElementById("cm-select"),
	cmDeselect: document.getElementById("cm-deselect"),
	cmExtract: document.getElementById("cm-extract"),
	cmDeleteAudio: document.getElementById("cm-delete-audio"),
	cmCopyTitle: document.getElementById("cm-copy-title"),

	// Delete Modal
	deleteModal: document.getElementById("delete-modal"),
	deleteModalOverlay: document.getElementById("delete-modal-overlay"),
	deleteModalCloseBtn: document.getElementById("delete-modal-close-btn"),
	deleteModalCancelBtn: document.getElementById("delete-modal-cancel-btn"),
	deleteModalConfirmBtn: document.getElementById("delete-modal-confirm-btn"),
	deleteEverythingCheckbox: document.getElementById("delete-everything-checkbox"),

	// Selection Bar
	selectionBar: document.getElementById("selection-bar"),
	barSelectedCount: document.getElementById("bar-selected-count"),
	barExtractBtn: document.getElementById("bar-extract-btn"),
	barExtractDropdownBtn: document.getElementById("bar-extract-dropdown-btn"),
	barExtractDropdownMenu: document.getElementById("bar-extract-dropdown-menu"),
	barExtractNoTimestampsBtn: document.getElementById("bar-extract-no-timestamps-btn"),
	barRevealTranscriptsBtn: document.getElementById("bar-reveal-transcripts-btn"),
	barOpenTranscriptsBtn: document.getElementById("bar-open-transcripts-btn"),
	barTranscriptsGroup: document.getElementById("bar-transcripts-group"),
	barTranscriptsDivider: document.getElementById("bar-transcripts-divider"),
	barRevealAudioBtn: document.getElementById("bar-reveal-audio-btn"),
	barOpenAudioBtn: document.getElementById("bar-open-audio-btn"),
	barDeleteAudioBtn: document.getElementById("bar-delete-audio-btn"),
	barCloseBtn: document.getElementById("bar-close-btn"),
}

// Initialize
async function init() {
	if (!window.__TAURI__) {
		console.error("Tauri not found. This app must be run within Tauri.")
		setStatus("Error: Tauri not found", "error")
		return
	}
	setupEventListeners()
	setupContextMenu()

	// Load saved settings
	await loadSettings()

	updateUI()
}

// Settings management
async function loadSettings() {
	try {
		const tauri = getTauri()
		if (!tauri || !tauri.store) {
			console.warn("Tauri Store plugin not available, using default path")
			const defaultPath = await invokeTauri("get_default_transcript_directory")
			elements.outputDir.value = defaultPath
			return
		}

		const store = await tauri.store.load("settings.json")
		let savedPath = await store.get("output_directory")
		let savedPodcastsPath = await store.get("podcasts_directory")

		if (!savedPath) {
			savedPath = await invokeTauri("get_default_transcript_directory")
			await store.set("output_directory", savedPath)
		}
		
		elements.outputDir.value = savedPath
		
		if (savedPodcastsPath) {
			podcastsDataDir = savedPodcastsPath
		}

		await store.save()
	} catch (error) {
		console.error("Error loading settings:", error)
		try {
			const defaultPath = await invokeTauri("get_default_transcript_directory")
			elements.outputDir.value = defaultPath
		} catch (e) {
			elements.outputDir.value = "./transcripts"
		}
	}
}

async function saveSettings() {
	try {
		const tauri = getTauri()
		if (tauri && tauri.store) {
			const store = await tauri.store.load("settings.json")
			await store.set("output_directory", elements.outputDir.value)
			await store.set("podcasts_directory", podcastsDataDir)
			await store.save()
		}
	} catch (error) {
		console.error("Error saving settings:", error)
	}
}

async function resetDirectory() {
	try {
		const defaultPath = await invokeTauri("get_default_transcript_directory")
		elements.outputDir.value = defaultPath
		await saveSettings()
		setStatus("Reset to default directory")
	} catch (error) {
		console.error("Error resetting directory:", error)
		setStatus("Error resetting directory", "error")
	}
}

// Make header draggable
const noDragSelector = "button, input, select, textarea, a, label, [data-no-drag]"

let dragStartX = 0
let dragStartY = 0

const makeDraggable = async (e) => {
	if (e.buttons !== 1) return // left button only

	dragStartX = e.screenX
	dragStartY = e.screenY

	// Allow dragging on modal-overlay even though it's a button
	const isModalOverlay = e.target.id === "modal-overlay"
	if (!isModalOverlay && e.target.closest(noDragSelector)) return

	try {
		const tauri = getTauri()
		if (tauri && tauri.window) {
			const appWindow = tauri.window.getCurrentWindow()
			await appWindow.startDragging()
		}
	} catch (err) {
		console.error("Failed to start dragging:", err)
	}
}

document.getElementById("titlebar")?.addEventListener("mousedown", makeDraggable)
document.getElementById("modal-overlay")?.addEventListener("mousedown", makeDraggable)

// Event Listeners
function setupEventListeners() {
	elements.chooseDirBtn.addEventListener("click", chooseDirectory)
	elements.resetDirBtn.addEventListener("click", resetDirectory)
	elements.openPodcastsBtn.addEventListener("click", () => openPath("/System/Applications/Podcasts.app"))
	elements.outputDir.addEventListener("change", saveSettings)
	elements.scanBtn.addEventListener("click", scanForEpisodes)
	elements.selectAllBtn.addEventListener("click", selectAllInTab)
	elements.deselectAllBtn.addEventListener("click", deselectAllInTab)
	elements.openFolderBtn.addEventListener("click", () => openPath(elements.outputDir.value))
	elements.successOpenFolderBtn.addEventListener("click", () => openPath(elements.outputDir.value))
	elements.successOkBtn.addEventListener("click", dismissSuccessSection)
	elements.successCloseBtn.addEventListener("click", dismissSuccessSection)
	elements.searchInput.addEventListener("input", (e) => {
		searchQuery = e.target.value.toLowerCase()
		renderEpisodes()
	})
	elements.filterSelectionBtn.addEventListener("click", () => {
		filterBySelection = !filterBySelection
		elements.filterSelectionBtn.classList.toggle("active", filterBySelection)
		renderEpisodes()
	})
	elements.contentSearchInput.addEventListener("input", (e) => {
		debounceSearch(e.target.value)
	})
	elements.sortSelect.addEventListener("change", (e) => {
		sortOption = e.target.value
		renderEpisodes()
	})

	// Selection Bar listeners
	elements.barExtractBtn.addEventListener("click", () => extractTranscripts(true))

	elements.barExtractDropdownBtn.addEventListener("click", (e) => {
		e.stopPropagation()
		elements.barExtractDropdownMenu.classList.toggle("hidden")
	})

	elements.barExtractNoTimestampsBtn.addEventListener("click", () => extractTranscripts(false))

	// Close dropdown when clicking elsewhere
	document.addEventListener("click", () => {
		if (elements.barExtractDropdownMenu) {
			elements.barExtractDropdownMenu.classList.add("hidden")
		}
	})

	elements.barRevealTranscriptsBtn.addEventListener("click", revealSelectedTranscripts)
	elements.barOpenTranscriptsBtn.addEventListener("click", openSelectedTranscripts)
	elements.barRevealAudioBtn.addEventListener("click", revealSelectedAudio)
	elements.barOpenAudioBtn.addEventListener("click", openSelectedAudio)
	elements.barDeleteAudioBtn.addEventListener("click", deleteSelectedAudio)
	elements.barCloseBtn.addEventListener("click", deselectAll)

	// Modal listeners
	elements.modalCloseBtn.addEventListener("click", closeTranscriptViewer)
	elements.modalOverlay.addEventListener("click", (e) => {
		// If the user was dragging the window, don't close the modal
		const deltaX = Math.abs(e.screenX - dragStartX)
		const deltaY = Math.abs(e.screenY - dragStartY)
		if (deltaX > 5 || deltaY > 5) return

		closeTranscriptViewer()
	})

	elements.modalSearchInput.addEventListener("input", (e) => {
		modalSearchQuery = e.target.value.toLowerCase().trim()
		updateModalSearch()
	})

	elements.modalSearchPrev.addEventListener("click", () => navigateModalSearch(-1))
	elements.modalSearchNext.addEventListener("click", () => navigateModalSearch(1))

	elements.modalSearchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			if (e.shiftKey) navigateModalSearch(-1)
			else navigateModalSearch(1)
		}
	})

	// Delete Modal listeners
	elements.deleteModalCloseBtn.addEventListener("click", closeDeleteModal)
	elements.deleteModalCancelBtn.addEventListener("click", closeDeleteModal)
	elements.deleteModalOverlay.addEventListener("click", closeDeleteModal)
	elements.deleteModalConfirmBtn.addEventListener("click", confirmDeleteTranscript)

	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			handleEscape(e)
		}

		// Handle Cmd+A (Mac) or Ctrl+A (others)
		if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
			// Only intercept if not in an input/textarea
			const activeElement = document.activeElement
			const isInput = activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable

			if (!isInput) {
				e.preventDefault()
				selectAllInTab()
			}
		}

		// Handle Cmd+F (Mac) or Ctrl+F (others)
		if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
			if (!elements.modal.classList.contains("hidden")) {
				e.preventDefault()
				elements.modalSearchInput.focus()
				elements.modalSearchInput.select()
			} else {
				e.preventDefault()
				elements.searchInput.focus()
				elements.searchInput.select()
			}
		}
	})

	// Menu events
	if (window.__TAURI__ && window.__TAURI__.event) {
		const { listen } = window.__TAURI__.event
		listen("menu-select-all", () => {
			const activeElement = document.activeElement
			const isInput = activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable

			if (isInput) {
				if (typeof activeElement.select === "function") {
					activeElement.select()
				} else if (activeElement.isContentEditable) {
					const range = document.createRange()
					range.selectNodeContents(activeElement)
					const sel = window.getSelection()
					sel.removeAllRanges()
					sel.addRange(range)
				}
			} else {
				selectAllInTab()
			}
		})
		listen("menu-select-none", () => {
			handleEscape()
		})
	}

	// Hide context menu on click elsewhere
	const hideContextMenu = (e) => {
		if (elements.contextMenu && !elements.contextMenu.classList.contains("hidden")) {
			if (!elements.contextMenu.contains(e.target)) {
				elements.contextMenu.classList.add("hidden")
				// Intercept and consume the event so it doesn't trigger selection or other actions
				e.stopPropagation()
				e.stopImmediatePropagation()
				e.preventDefault()
				return true // Was handled
			}
		}
		return false
	}

	window.addEventListener("mousedown", hideContextMenu, true)
	window.addEventListener("click", hideContextMenu, true)

	window.addEventListener("blur", () => {
		elements.contextMenu.classList.add("hidden")
	})

	// Dynamic tooltips for truncated text
	document.addEventListener("mouseover", (e) => {
		const target = e.target.closest(".episode-title, .episode-podcast, .modal-episode-title, .modal-podcast-title")
		if (!target) return

		if (target.scrollWidth > target.clientWidth) {
			target.title = target.textContent
		} else {
			target.removeAttribute("title")
		}
	})
}

let contextMenuTargetIndex = -1

function setupContextMenu() {
	elements.episodesList.addEventListener("contextmenu", (e) => {
		const item = e.target.closest(".episode-item")
		if (!item) return

		e.preventDefault()
		contextMenuTargetIndex = parseInt(item.dataset.index)

		const episode = episodes[contextMenuTargetIndex]
		const filename = getExpectedFilename(episode)
		const isExisting = existingTranscripts.has(filename)
		const isSelected = selectedEpisodes.has(contextMenuTargetIndex)

		// Update menu item visibility/state
		const canViewSource = !episode.is_orphaned || episode.local_ttml_path
		elements.cmView.style.display = canViewSource ? "flex" : "none"
		elements.cmOpenPodcasts.style.display = episode.store_id || !episode.is_orphaned ? "flex" : "none"
		elements.cmOpen.style.display = isExisting ? "flex" : "none"
		elements.cmReveal.style.display = isExisting ? "flex" : "none"
		elements.cmDeleteTranscript.style.display = isExisting ? "flex" : "none"
		elements.cmSelect.style.display = isSelected ? "none" : "flex"
		elements.cmDeselect.style.display = isSelected ? "flex" : "none"
		elements.cmExtract.style.display = canViewSource ? "flex" : "none"
		elements.cmExtract.querySelector("span").textContent = isExisting ? "Re-extract Transcript" : "Extract Transcript"
		elements.cmDeleteAudio.style.display = episode.has_audio ? "flex" : "none"

		// Position menu
		const menu = elements.contextMenu
		menu.classList.remove("hidden")

		const x = e.clientX
		const y = e.clientY

		const menuWidth = menu.offsetWidth || 180
		const menuHeight = menu.offsetHeight || 200

		let posX = x
		let posY = y

		if (x + menuWidth > window.innerWidth) {
			posX = x - menuWidth
		}
		if (y + menuHeight > window.innerHeight) {
			posY = y - menuHeight
		}

		menu.style.left = `${posX}px`
		menu.style.top = `${posY}px`
	})

	elements.cmView.onclick = () => {
		if (contextMenuTargetIndex !== -1) viewTranscript(contextMenuTargetIndex)
	}

	elements.cmOpenPodcasts.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			const episode = episodes[contextMenuTargetIndex]
			openInPodcasts(episode)
		}
	}

	elements.cmOpen.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			const episode = episodes[contextMenuTargetIndex]
			const filename = getExpectedFilename(episode)
			const filePath = `${elements.outputDir.value}/${filename}`
			openExisting(filePath)
		}
	}

	elements.cmReveal.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			const episode = episodes[contextMenuTargetIndex]
			const filename = getExpectedFilename(episode)
			const filePath = `${elements.outputDir.value}/${filename}`
			revealInFinder(filePath)
		}
	}

	elements.cmDeleteTranscript.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			const episode = episodes[contextMenuTargetIndex]
			openDeleteModal(episode)
		}
	}

	elements.cmSelect.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			selectedEpisodes.add(contextMenuTargetIndex)
			renderEpisodes()
			updateUI()
		}
	}

	elements.cmDeselect.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			selectedEpisodes.delete(contextMenuTargetIndex)
			renderEpisodes()
			updateUI()
		}
	}

	elements.cmExtract.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			selectedEpisodes.clear()
			selectedEpisodes.add(contextMenuTargetIndex)
			renderEpisodes()
			updateUI()
			extractTranscripts()
		}
	}

	elements.cmDeleteAudio.onclick = () => {
		if (contextMenuTargetIndex !== -1) deleteAudioForEpisode(contextMenuTargetIndex)
	}

	elements.cmCopyTitle.onclick = () => {
		if (contextMenuTargetIndex !== -1) {
			const episode = episodes[contextMenuTargetIndex]
			const text = `${episode.podcast_title} - ${episode.episode_title}`
			navigator.clipboard.writeText(text)
			showToast("Copied to clipboard")
		}
	}
}

async function revealInFinder(path) {
	try {
		await invokeTauri("reveal_in_finder", { paths: [path] })
	} catch (error) {
		console.error("Error revealing path:", error)
		setStatus("Error revealing path", "error")
	}
}

async function revealSelectedTranscripts() {
	const paths = Array.from(selectedEpisodes)
		.map((idx) => episodes[idx])
		.map((ep) => getExpectedFilename(ep))
		.filter((name) => existingTranscripts.has(name))
		.map((name) => `${elements.outputDir.value}/${name}`)

	if (paths.length === 0) return
	try {
		await invokeTauri("reveal_in_finder", { paths })
	} catch (error) {
		console.error("Error revealing transcripts:", error)
		setStatus("Error revealing transcripts", "error")
	}
}

async function openSelectedTranscripts() {
	const paths = Array.from(selectedEpisodes)
		.map((idx) => episodes[idx])
		.map((ep) => getExpectedFilename(ep))
		.filter((name) => existingTranscripts.has(name))
		.map((name) => `${elements.outputDir.value}/${name}`)

	if (paths.length === 0) return

	if (paths.length > 1) {
		const tauri = getTauri()
		const confirmed = await tauri.dialog.ask(`Are you sure you want to open ${paths.length} transcript files?`, { title: "Open Transcripts", type: "warning" })
		if (!confirmed) return
	}

	try {
		await invokeTauri("open_path", { paths })
	} catch (error) {
		console.error("Error opening transcripts:", error)
		setStatus("Error opening transcripts", "error")
	}
}

async function revealSelectedAudio() {
	const selectedIndices = Array.from(selectedEpisodes)
	const paths = []

	for (const idx of selectedIndices) {
		const ep = episodes[idx]
		if (ep.has_audio && ep.uuid) {
			// We don't have the full path on frontend easily, but we know the pattern
			// Actually, let's just use the backend to resolve paths if needed,
			// but reveal_in_finder on backend can be called with the cache path.
			// For simplicity, let's assume we need to find them.
			// Wait, the backend already has get_audio_path.
			// Let's add a backend command to reveal audio.
		}
	}
	// Better: call a backend command that handles the logic
	try {
		const selectedEpisodesData = Array.from(selectedEpisodes)
			.map((idx) => episodes[idx])
			.filter((ep) => ep.has_audio)

		await invokeTauri("reveal_audio_multiple", { 
			podcastsBaseDir: podcastsDataDir,
			episodes: selectedEpisodesData 
		})
	} catch (error) {
		console.error("Error revealing audio:", error)
		setStatus("Error revealing audio", "error")
	}
}

async function openSelectedAudio() {
	try {
		const selectedEpisodesData = Array.from(selectedEpisodes)
			.map((idx) => episodes[idx])
			.filter((ep) => ep.has_audio)

		if (selectedEpisodesData.length === 0) return

		if (selectedEpisodesData.length > 1) {
			const tauri = getTauri()
			const confirmed = await tauri.dialog.ask(`Are you sure you want to open ${selectedEpisodesData.length} audio files?`, { title: "Open Audio", type: "warning" })
			if (!confirmed) return
		}

		await invokeTauri("open_audio_multiple", { 
			podcastsBaseDir: podcastsDataDir,
			episodes: selectedEpisodesData 
		})
	} catch (error) {
		console.error("Error opening audio:", error)
		setStatus("Error opening audio", "error")
	}
}

async function deleteSelectedAudio() {
	const selectedEpisodesData = Array.from(selectedEpisodes)
		.map((idx) => episodes[idx])
		.filter((ep) => ep.has_audio)

	if (selectedEpisodesData.length === 0) return

	const tauri = getTauri()
	const confirmed = await tauri.dialog.ask(`Are you sure you want to move the audio files for ${selectedEpisodesData.length} episode(s) to the Trash?`, { title: "Delete Audio", type: "warning" })

	if (!confirmed) return

	try {
		setStatus("Moving audio to Trash...")
		const count = await invokeTauri("delete_multiple_audio", { 
			podcastsBaseDir: podcastsDataDir,
			episodes: selectedEpisodesData 
		})

		// Update local state
		selectedEpisodesData.forEach((ep) => (ep.has_audio = false))

		renderEpisodes()
		updateUI()
		setStatus(`Moved ${count} audio files to Trash`, "success")
		showToast(`${count} audio files trashed`)
	} catch (error) {
		console.error("Error deleting audio:", error)
		setStatus(`Error: ${error}`, "error")
	}
}

/**
 * Generic helper to move a file to trash with safety check
 * @param {string} filePath Absolute path to the file
 * @param {string} baseDir The approved base directory the file must be within
 */
async function openInPodcasts(episode) {
	try {
		console.log("Opening in Podcasts. PodcastStoreID:", episode.podcast_store_id, "EpisodeStoreID:", episode.store_id);
		await invokeTauri("open_podcasts_episode", { 
			podcastId: episode.podcast_store_id, 
			episodeId: episode.store_id 
		})
	} catch (error) {
		console.error("Error opening Podcasts:", error)
		setStatus("Error opening Podcasts", "error")
	}
}

let currentDeleteEpisode = null

function openDeleteModal(episode) {
	currentDeleteEpisode = episode
	elements.deleteEverythingCheckbox.checked = false
	elements.deleteModal.classList.remove("hidden")
}

function closeDeleteModal() {
	elements.deleteModal.classList.add("hidden")
	currentDeleteEpisode = null
}

async function confirmDeleteTranscript() {
	if (!currentDeleteEpisode) return
	
	const deleteEverything = elements.deleteEverythingCheckbox.checked
	const episode = currentDeleteEpisode
	const filename = getExpectedFilename(episode)
	
	try {
		setStatus("Deleting transcript bundle...")
		await invokeTauri("delete_transcript_bundle", {
			episode: episode,
			outputDir: elements.outputDir.value,
			podcastsBaseDir: podcastsDataDir,
			deleteEverything: deleteEverything,
		})
		
		existingTranscripts.delete(filename)
		if (deleteEverything) {
			episode.has_audio = false
		}
		
		renderEpisodes()
		updateUI()
		
		// Close transcript viewer if it's open
		if (!elements.modal.classList.contains("hidden")) {
			closeTranscriptViewer()
		}
		
		closeDeleteModal()
		setStatus("Transcript deleted", "success")
		showToast(deleteEverything ? "Episode bundle deleted" : "Transcript deleted")
	} catch (error) {
		console.error("Error deleting transcript bundle:", error)
		setStatus(`Error: ${error}`, "error")
	}
}

async function trashItem(filePath, baseDir) {
	try {
		await invokeTauri("trash_item", { path: filePath, baseDir: baseDir })
		return true
	} catch (error) {
		console.error("Error trashing item:", error)
		setStatus(`Error: ${error}`, "error")
		return false
	}
}

let searchTimeout
function debounceSearch(query) {
	clearTimeout(searchTimeout)
	searchTimeout = setTimeout(() => {
		performContentSearch(query)
	}, 400)
}

async function performContentSearch(query) {
	contentSearchQuery = query.toLowerCase().trim()
	if (!contentSearchQuery) {
		contentSearchResults = new Set()
		renderEpisodes()
		return
	}

	try {
		setStatus("Searching content...")
		// We'll need to implement this in Rust
		const results = await invokeTauri("search_episodes_content", {
			query: contentSearchQuery,
			episodes: episodes,
		})
		contentSearchResults = new Set(results)
		setStatus(`Found ${results.length} episodes with matching content`)
		renderEpisodes()
	} catch (error) {
		console.error("Content search error:", error)
		setStatus("Error searching content", "error")
	}
}

// Choose output directory
async function chooseDirectory() {
	try {
		const tauri = getTauri()
		if (!tauri || !tauri.dialog) {
			throw new Error("Tauri dialog API not available")
		}

		const selected = await tauri.dialog.open({
			directory: true,
			multiple: false,
			defaultPath: elements.outputDir.value,
		})

		if (selected) {
			elements.outputDir.value = selected
			await saveSettings()
			setStatus("Output directory updated")
		}
	} catch (error) {
		console.error("Error choosing directory:", error)
		setStatus("Error choosing directory", "error")
	}
}

// Scan for episodes
async function scanForEpisodes() {
	try {
		const tauri = getTauri()

		if (!podcastsDataDir) {
			const confirmed = await tauri.dialog.ask(
				"To extract transcripts, the app needs access to the Apple Podcasts data folder.\n\n" +
				"In the next step, please select the folder named '243LU875E5.groups.com.apple.podcasts' (it should be selected by default in the picker).\n\n" +
				"You should only need to do this once.",
				{ title: "Access Permission Required", type: "info", okLabel: "Select Folder" }
			)

			if (!confirmed) return

			const suggested = await invokeTauri("get_suggested_podcasts_dir")
			const selected = await tauri.dialog.open({
				directory: true,
				multiple: false,
				defaultPath: suggested,
				title: "Select Apple Podcasts Group Container"
			})

			if (!selected) return

			podcastsDataDir = selected
			await saveSettings()
		}

		needPermission = false
		isScanning = true
		elements.scanBtn.disabled = true
		elements.scanBtn.classList.add("is-scanning")
		
		// If list is empty, render immediately to show main spinner
		if (episodes.length === 0) {
			renderEpisodes()
		}

		elements.successSection.classList.add("hidden")
		elements.openFolderBtn.classList.add("hidden")
		setStatus("Scanning...")

		// Give the browser a moment to paint the spinner before starting the scan
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Check output directory for existing files
		await checkExistingTranscripts()

		// Call Tauri backend to scan for episodes
		const foundEpisodes = await invokeTauri("scan_episodes", { 
			podcastsBaseDir: podcastsDataDir 
		})

		// Load orphaned metadata
		const metadataList = await invokeTauri("load_metadata", { outputDir: elements.outputDir.value })

		// Create a map of found episode identifiers
		const foundIdentifiers = new Set(foundEpisodes.map((ep) => ep.transcript_identifier))

		// Merge orphaned episodes
		const allEpisodes = [...foundEpisodes]
		const foundMap = new Map(foundEpisodes.map((ep) => [ep.transcript_identifier, ep]))

		metadataList.forEach((meta) => {
			if (!foundIdentifiers.has(meta.episode.transcript_identifier)) {
				const orphanedEpisode = {
					...meta.episode,
					is_orphaned: true,
					has_audio: false, // Assume audio is gone if TTML is gone
				}
				allEpisodes.push(orphanedEpisode)
				// Pre-populate the timestamp state since we have it in metadata
				transcriptTimestampState.set(orphanedEpisode.transcript_identifier, meta.include_timestamps)
			} else {
				// Update timestamp state for existing episodes too
				transcriptTimestampState.set(meta.episode.transcript_identifier, meta.include_timestamps)
				
				// Update local_ttml_path for the found episode if we have it in metadata
				const foundEpisode = foundMap.get(meta.episode.transcript_identifier)
				if (foundEpisode && meta.episode.local_ttml_path) {
					foundEpisode.local_ttml_path = meta.episode.local_ttml_path
				}
			}
		})

		episodes = allEpisodes

		// Default selection logic:
		// 1. If there are unextracted episodes, select only those.
		// 2. Otherwise, select all (which will be the extracted ones).
		const unextractedIndices = episodes
			.map((ep, index) => ({ ep, index }))
			.filter(({ ep }) => !existingTranscripts.has(getExpectedFilename(ep)))
			.map(({ index }) => index)

		if (unextractedIndices.length > 0) {
			selectedEpisodes = new Set(unextractedIndices)
		} else {
			selectedEpisodes = new Set(episodes.map((_, index) => index))
		}

		renderEpisodes()
		updateUI()

		setStatus(`Found ${foundEpisodes.length} live episodes and ${episodes.length - foundEpisodes.length} orphaned transcripts`)

		// Auto-switch to Extracted tab if Unextracted is empty but there are extracted episodes
		const hasUnextracted = episodes.some((ep) => !existingTranscripts.has(getExpectedFilename(ep)))
		if (activeTab === "new" && !hasUnextracted && existingTranscripts.size > 0) {
			setActiveTab("existing")
		}
	} catch (error) {
		console.error("Error scanning episodes:", error)
		setStatus(`Error: ${error}`, "error")
	} finally {
		isScanning = false
		elements.scanBtn.disabled = false
		elements.scanBtn.classList.remove("is-scanning")
	}
}

window.scanForEpisodes = scanForEpisodes

async function checkExistingTranscripts() {
	try {
		// In Tauri 2.0, plugins are often under window.__TAURI__.pluginName or window.__TAURI__[pluginName]
		const fsPlugin = window.__TAURI__.fs || window.__TAURI__.pluginFs
		if (!fsPlugin || !fsPlugin.readDir) {
			console.warn("Tauri FS plugin not found in window.__TAURI__")
			return
		}

		const { readDir } = fsPlugin
		const dir = elements.outputDir.value

		try {
			const entries = await readDir(dir)
			console.log(`Found ${entries.length} files in output directory`)
			existingTranscripts = new Set(entries.map((e) => e.name))
		} catch (e) {
			console.warn("Could not read output directory (might not exist):", e)
			existingTranscripts = new Set()
		}
	} catch (error) {
		console.error("Error in checkExistingTranscripts:", error)
	}
}

async function openPath(path) {
	try {
		const paths = Array.isArray(path) ? path : [path]
		await invokeTauri("open_path", { paths })
	} catch (error) {
		console.error("Error opening path:", error)
		setStatus("Error opening path", "error")
	}
}

// Render episodes list
function renderEpisodes() {
	if (episodes.length === 0) {
		elements.emptyState.style.display = "flex"
		if (isScanning) {
			elements.emptyState.innerHTML = `
				<div class="main-spinner"></div>
				<p class="empty-description">Scanning for episodes…</p>
			`
		} else {
			elements.emptyState.innerHTML = `
				<h3 class="empty-title">No Episodes Found</h3>
				<p class="empty-description">Click <button type="button" class="btn-text" style="vertical-align: baseline; padding: 0 4px;" onclick="scanForEpisodes()">Scan for Episodes</button> to find podcast transcripts.</p>
			`
		}
		elements.episodesList.innerHTML = ""
		updateTabCounts(0, 0)
		return
	}

	elements.emptyState.style.display = "none"

	const newEpisodes = []
	const existingEpisodes = []

	episodes.forEach((episode, index) => {
		const filename = getExpectedFilename(episode)
		if (existingTranscripts.has(filename)) {
			existingEpisodes.push({ ...episode, index, filename })
		} else {
			newEpisodes.push({ ...episode, index })
		}
	})

	updateTabCounts(newEpisodes.length, existingEpisodes.length)

	const currentList = getFilteredAndSortedEpisodes(activeTab === "new" ? newEpisodes : existingEpisodes)
	const isCompact = currentList.length > 7
	const showSeparators = sortOption === "podcast-date-desc" || sortOption === "podcast-asc"

	let html = ""
	if (currentList.length === 0) {
		const emptyMsg = searchQuery ? `No episodes found matching "${searchQuery}"` : "No episodes found"
		html = `<div class="empty-state">
            <h3 class="empty-title">${emptyMsg}</h3>`

		if (activeTab === "new" && existingEpisodes.length > 0) {
			const matchingExisting = getFilteredAndSortedEpisodes(existingEpisodes).length
			if (matchingExisting > 0) {
				html += `
                <p class="empty-description">
                    Found ${matchingExisting} episode${matchingExisting === 1 ? "" : "s"} in 
                    <button type="button" class="btn-text" style="vertical-align: baseline; padding: 0 4px;" onclick="setActiveTab('existing')">Extracted</button>
                </p>`
			}
		}

		html += `</div>`
	} else {
		let lastPodcast = null
		let groupHtml = ""

		currentList.forEach((ep, i) => {
			const isFirstInGroup = showSeparators && ep.podcast_title !== lastPodcast

			if (isFirstInGroup) {
				// Close previous group if it exists
				if (lastPodcast !== null) {
					html += `<section class="podcast-group">${groupHtml}</section>`
					groupHtml = ""
				}

				const podcastTitle = ep.podcast_title || "Unknown Podcast"
				const escapedPodcast = escapeHtml(podcastTitle)
				groupHtml += `
					<div class="podcast-separator">
						<span>${escapedPodcast}</span>
						<div class="podcast-separator-actions">
							<button type="button" class="podcast-separator-btn" onclick="togglePodcastSelection('${escapedPodcast.replace(/'/g, "\\\\'")}', true)">Select All</button>
							<button type="button" class="podcast-separator-btn" onclick="togglePodcastSelection('${escapedPodcast.replace(/'/g, "\\\\'")}', false)">Deselect All</button>
						</div>
					</div>`
				lastPodcast = podcastTitle
			}

			groupHtml += renderEpisodeItem(ep, ep.index, activeTab === "existing", isCompact)

			// If it's the last item, close the group
			if (i === currentList.length - 1) {
				if (showSeparators) {
					html += `<section class="podcast-group">${groupHtml}</section>`
				} else {
					html += groupHtml
				}
			}
		})
	}

	elements.episodesList.innerHTML = html
}

function getFilteredAndSortedEpisodes(list) {
	let filtered = [...list]

	// Filter
	if (searchQuery) {
		const isPodcastSearch = searchQuery.startsWith("p:")
		const isTitleSearch = searchQuery.startsWith("t:")
		const query = isPodcastSearch || isTitleSearch ? searchQuery.substring(2).trim() : searchQuery

		filtered = filtered.filter((ep) => {
			if (isPodcastSearch) {
				return fuzzyMatch(query, (ep.podcast_title || "").toLowerCase())
			}
			if (isTitleSearch) {
				return fuzzyMatch(query, (ep.episode_title || "").toLowerCase())
			}
			const text = `${ep.episode_title} ${ep.podcast_title}`.toLowerCase()
			return fuzzyMatch(query, text)
		})
	}

	// Selection Filter
	if (filterBySelection) {
		filtered = filtered.filter((ep) => selectedEpisodes.has(ep.index))
	}

	// Content Search Filter
	if (contentSearchQuery) {
		filtered = filtered.filter((ep) => contentSearchResults.has(ep.index))
	}

	// Sort
	filtered.sort((a, b) => {
		switch (sortOption) {
			case "podcast-date-desc": {
				const podcastCompare = (a.podcast_title || "").localeCompare(b.podcast_title || "")
				if (podcastCompare !== 0) return podcastCompare
				return (b.pub_date || 0) - (a.pub_date || 0)
			}
			case "date-desc":
				return (b.pub_date || 0) - (a.pub_date || 0)
			case "date-asc":
				return (a.pub_date || 0) - (b.pub_date || 0)
			case "download-desc":
				return (b.import_date || 0) - (a.import_date || 0)
			case "download-asc":
				return (a.import_date || 0) - (b.import_date || 0)
			case "podcast-asc":
				return (a.podcast_title || "").localeCompare(b.podcast_title || "")
			case "title-asc":
				return (a.episode_title || "").localeCompare(b.episode_title || "")
			default:
				return 0
		}
	})

	return filtered
}

function fuzzyMatch(query, text) {
	if (!query) return true
	if (!text) return false
	return text.includes(query)
}

function updateTabCounts(newCount, existingCount) {
	if (elements.countNew) elements.countNew.textContent = newCount
	if (elements.countExisting) elements.countExisting.textContent = existingCount
}

function setActiveTab(tab) {
	activeTab = tab

	// Update UI classes
	document.getElementById("tab-new").classList.toggle("active", tab === "new")
	document.getElementById("tab-existing").classList.toggle("active", tab === "existing")

	renderEpisodes()
	updateUI()
}

function getExpectedFilename(episode) {
	if (episode.podcast_title && episode.episode_title) {
		// Mock the logic from Rust - we can't perfectly replicate sanitize_filename here
		// but we can try common patterns. The real solution is to check after extraction.
		const base = `${episode.podcast_title} - ${episode.episode_title}`
		return base.replace(/[<>\:"\/\\|?*]/g, "-").substring(0, 200) + ".txt"
	}
	return (episode.transcript_identifier || "").replace(/\//g, "_") + ".txt"
}

function renderEpisodeItem(episode, index, isExisting = false, isCompact = false) {
	const isSelected = selectedEpisodes.has(index)
	const filename = isExisting ? episode.filename : getExpectedFilename(episode)
	const filePath = `${elements.outputDir.value}/${filename}`

	const pubDate = episode.pub_date ? formatDate(episode.pub_date) : "Unknown Date"
	const importDate = episode.import_date ? formatDate(episode.import_date) : null

	return `
	        <div class="episode-item ${isSelected ? "selected" : ""} ${isExisting ? "existing" : ""} ${isCompact ? "compact" : ""}" data-index="${index}">
	            <input 
	                type="checkbox" 
	                class="checkbox-input episode-checkbox" 
	                ${isSelected ? "checked" : ""}
	                onclick="toggleEpisode(${index}, event)"
	            >
	            <div class="episode-info" onclick="toggleEpisode(${index}, event)">
	                <div class="episode-title">
                        ${escapeHtml(episode.episode_title || "Unknown Episode")}
                        ${episode.has_audio ? '<span class="audio-badge" title="Audio available in Podcasts cache">Audio</span>' : ""}
                        ${
													episode.is_orphaned
														? '<span class="audio-badge" style="background: rgba(255, 69, 58, 0.12); color: var(--error);" title="Original transcript source was deleted from Podcasts cache">Orphaned</span>'
														: ""
												}
                    </div>
	                <div class="episode-metadata">
	                    <div class="episode-podcast">${escapeHtml(episode.podcast_title || "Unknown Podcast")}</div>
	                    <div class="episode-date" title="Published Date">
	                        <span class="date-label">Published: </span>${pubDate}
	                    </div>                    ${
												importDate
													? `
                        <div class="episode-date" title="Downloaded Date">
                            <span class="date-label">Downloaded: </span>${importDate}
                        </div>
                    `
													: ""
											}
                </div>
            </div>
            <div class="episode-actions">
                <button class="btn-text btn-small" onclick="event.stopPropagation(); viewTranscript(${index})">
                    View
                </button>
                ${
									isExisting
										? `
                    <button class="btn-text btn-small" onclick="event.stopPropagation(); openExisting('${filePath.replace(/'/g, "\\\\'")}')">
                        Open File
                    </button>
                `
										: ""
								}
            </div>
        </div>
    `
}

async function deleteAudioForEpisode(index) {
	const episode = episodes[index]
	if (!episode || !episode.has_audio) return

	const tauri = getTauri()
	if (!tauri || !tauri.dialog) {
		console.warn("Tauri dialog API not available")
		return
	}

	const confirmed = await tauri.dialog.ask(`Are you sure you want to delete the audio for this episode?\n\n"${episode.episode_title}"\n\nThis will remove the file from the Podcasts cache.`, {
		title: "Delete Audio",
		type: "warning",
	})

	if (!confirmed) return

	try {
		setStatus("Deleting audio...")
		await invokeTauri("delete_audio", { 
			podcastsBaseDir: podcastsDataDir,
			episode: episode 
		})

		// Update local state
		episode.has_audio = false

		// Update UI
		renderEpisodes()

		// If modal is open, update its buttons
		if (!elements.modal.classList.contains("hidden")) {
			elements.modalAudioDivider.style.display = "none"
			elements.modalAudioGroup.style.display = "none"
			elements.modalOpenAudioBtn.style.display = "none"
			elements.modalRevealAudioBtn.style.display = "none"
			elements.modalDeleteAudioBtn.style.display = "none"
		}

		setStatus("Audio deleted successfully", "success")
		showToast("Audio deleted")
	} catch (error) {
		console.error("Error deleting audio:", error)
		setStatus(`Error: ${error}`, "error")
	}
}

async function viewTranscript(index) {
	const episode = episodes[index]
	if (!episode) return

	if (episode.is_orphaned && !episode.local_ttml_path) {
		const tauri = getTauri()
		await tauri.dialog.message("The original transcript source (TTML) has been deleted from the Podcasts cache.\n\nYou can still open the extracted text file using the 'Open File' button.", {
			title: "Source Deleted",
			type: "info",
		})
		return
	}

	try {
		setStatus("Loading transcript...")
		elements.modalEpisodeTitle.textContent = episode.episode_title || "Unknown Episode"
		elements.modalPodcastTitle.textContent = episode.podcast_title || "Unknown Podcast"
		elements.modalContent.innerHTML = '<div class="empty-state">Loading...</div>'
		elements.modalSearchInfo.textContent = ""

		// Reset search state
		elements.modalSearchInput.value = contentSearchQuery || ""
		modalSearchQuery = contentSearchQuery || ""
		modalSearchResults = []
		currentMatchIndex = -1
		elements.modalSearchCount.textContent = "0/0"

		elements.modal.classList.remove("hidden")

		const paragraphs = await invokeTauri("get_transcript", { episode })
		renderTranscriptContent(paragraphs)

		if (modalSearchQuery) {
			updateModalSearch()
		}

		// Setup modal buttons
		const filename = getExpectedFilename(episode)
		const isExisting = existingTranscripts.has(filename)
		const filePath = `${elements.outputDir.value}/${filename}`

		elements.modalOpenPodcastsBtn.style.display = episode.store_id || !episode.is_orphaned ? "flex" : "none"
		elements.modalOpenBtn.style.display = isExisting ? "flex" : "none"
		elements.modalRevealBtn.style.display = isExisting ? "flex" : "none"
		elements.modalDeleteTranscriptBtn.style.display = isExisting ? "flex" : "none"
		
		const showAudio = episode.has_audio
		elements.modalAudioDivider.style.display = showAudio ? "block" : "none"
		elements.modalAudioGroup.style.display = showAudio ? "flex" : "none"
		elements.modalOpenAudioBtn.style.display = showAudio ? "flex" : "none"
		elements.modalRevealAudioBtn.style.display = showAudio ? "flex" : "none"
		elements.modalDeleteAudioBtn.style.display = showAudio ? "flex" : "none"

		const lastState = transcriptTimestampState.get(episode.transcript_identifier)
		// If we know what it is, offer the opposite. Otherwise default to offering with timestamps.
		const currentlyHasTimestamps = lastState !== undefined ? lastState : false
		const offerTimestamps = !currentlyHasTimestamps

		elements.modalExtractBtn.disabled = false
		elements.modalExtractBtn.dataset.offerTimestamps = offerTimestamps
		elements.modalExtractBtn.innerHTML = `
			<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
				<polyline points="7 10 12 15 17 10" />
				<line x1="12" y1="15" x2="12" y2="3" />
			</svg>
			            <span>${offerTimestamps ? "Extract with Timestamps" : "Extract without Timestamps"}</span>
					`
			
		elements.modalOpenBtn.onclick = () => openExisting(filePath)
		elements.modalRevealBtn.onclick = () => revealInFinder(filePath)
		elements.modalDeleteTranscriptBtn.onclick = () => openDeleteModal(episode)
		elements.modalOpenPodcastsBtn.onclick = () => openInPodcasts(episode)
		elements.modalCopyBtn.onclick = () => {
			const text = `${episode.podcast_title} - ${episode.episode_title}`
			navigator.clipboard.writeText(text)
			showToast("Copied to clipboard")
		}
		elements.modalOpenAudioBtn.onclick = async () => {
			try {
				await invokeTauri("open_audio", { 
					podcastsBaseDir: podcastsDataDir,
					episode 
				})
			} catch (error) {
				console.error("Error opening audio:", error)
				setStatus("Error opening audio", "error")
			}
		}
		elements.modalRevealAudioBtn.onclick = async () => {
			try {
				const uuid = episode.uuid
				if (!uuid) return
				const path = await invokeTauri("get_audio_path_string", { 
					podcastsBaseDir: podcastsDataDir,
					uuid 
				})
				if (path) {
					await revealInFinder(path)
				}
			} catch (error) {
				console.error("Error revealing audio:", error)
				setStatus("Error revealing audio", "error")
			}
		}
		elements.modalDeleteAudioBtn.onclick = () => {
			deleteAudioForEpisode(index)
		}

		elements.modalExtractBtn.onclick = async () => {
			const originalContent = elements.modalExtractBtn.innerHTML
			try {
				const includeTimestamps = elements.modalExtractBtn.dataset.offerTimestamps === "true"
				elements.modalExtractBtn.disabled = true

				setStatus("Extracting...")

				await invokeTauri("extract_transcript_command", {
					episode: episode,
					outputDir: elements.outputDir.value,
					includeTimestamps: includeTimestamps,
				})

				transcriptTimestampState.set(episode.transcript_identifier, includeTimestamps)
				await checkExistingTranscripts()

				// Update modal buttons
				const filename = getExpectedFilename(episode)
				const isExistingNow = existingTranscripts.has(filename)
				const newFilePath = `${elements.outputDir.value}/${filename}`

				elements.modalOpenBtn.style.display = isExistingNow ? "flex" : "none"
				elements.modalRevealBtn.style.display = isExistingNow ? "flex" : "none"
				elements.modalOpenBtn.onclick = () => openExisting(newFilePath)
				elements.modalRevealBtn.onclick = () => revealInFinder(newFilePath)

				renderEpisodes()
				updateUI()
				setStatus("Transcript extracted", "success")
				showToast("Transcript extracted")

				// Show checkmark state
				elements.modalExtractBtn.innerHTML = `
					<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12"></polyline>
					</svg>
					<span>Extracted</span>
				`
			} catch (error) {
				console.error("Error extracting transcript:", error)
				setStatus(`Error: ${error}`, "error")
				elements.modalExtractBtn.disabled = false
				elements.modalExtractBtn.innerHTML = originalContent
			}
		}

		setStatus("Transcript loaded")
	} catch (error) {
		console.error("Error loading transcript:", error)
		setStatus("Error loading transcript", "error")
		elements.modalContent.innerHTML = `<div class="empty-state">Error: ${error}</div>`
	}
}

function renderTranscriptContent(paragraphs) {
	const html = paragraphs
		.map((p) => {
			const text = escapeHtml(p.text)
			const time = p.begin !== null ? formatTime(p.begin) : ""
			return `
			<div class="transcript-para">
				<div class="transcript-time">${time}</div>
				<div class="transcript-text">${text}</div>
			</div>
		`
		})
		.join("")
	elements.modalContent.innerHTML = html
}

function updateModalSearch() {
	// Re-render content to clear old highlights
	// Note: In a real app we'd just replace the text nodes, but for a prototype this is fine
	const paras = Array.from(elements.modalContent.querySelectorAll(".transcript-text"))
	let matchCount = 0
	modalSearchResults = []

	if (!modalSearchQuery) {
		paras.forEach((p) => {
			p.innerHTML = escapeHtml(p.textContent)
		})
		elements.modalSearchCount.textContent = "0/0"
		return
	}

	const escapedQueryForRegex = modalSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const regex = new RegExp(`(${escapedQueryForRegex})`, "gi")

	paras.forEach((p, paraIndex) => {
		const textContent = p.textContent
		if (textContent.toLowerCase().includes(modalSearchQuery)) {
			const parts = textContent.split(regex)
			p.innerHTML = parts
				.map((part) => {
					if (part.toLowerCase() === modalSearchQuery) {
						const id = `match-${matchCount}`
						modalSearchResults.push(id)
						matchCount++
						return `<span id="${id}" class="highlight">${escapeHtml(part)}</span>`
					}
					return escapeHtml(part)
				})
				.join("")
		} else {
			p.innerHTML = escapeHtml(textContent)
		}
	})

	currentMatchIndex = matchCount > 0 ? 0 : -1
	updateSearchUI()
	if (currentMatchIndex !== -1) {
		scrollToMatch(currentMatchIndex)
	}
}

function navigateModalSearch(direction) {
	if (modalSearchResults.length === 0) return

	currentMatchIndex += direction
	if (currentMatchIndex >= modalSearchResults.length) currentMatchIndex = 0
	if (currentMatchIndex < 0) currentMatchIndex = modalSearchResults.length - 1

	updateSearchUI()
	scrollToMatch(currentMatchIndex)
}

function updateSearchUI() {
	const count = modalSearchResults.length
	const current = currentMatchIndex + 1
	elements.modalSearchCount.textContent = `${count > 0 ? current : 0}/${count}`

	// Update active highlight class
	elements.modalContent.querySelectorAll(".highlight.active").forEach((el) => el.classList.remove("active"))
	if (currentMatchIndex !== -1) {
		const activeEl = document.getElementById(modalSearchResults[currentMatchIndex])
		if (activeEl) activeEl.classList.add("active")
	}
}

function scrollToMatch(index) {
	const matchId = modalSearchResults[index]
	const element = document.getElementById(matchId)
	if (element) {
		element.scrollIntoView({ behavior: "smooth", block: "center" })
	}
}

function closeTranscriptViewer() {
	elements.modal.classList.add("hidden")
}

function formatTime(seconds) {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)

	const parts = []
	if (h > 0) parts.push(h.toString().padStart(2, "0"))
	parts.push(m.toString().padStart(2, "0"))
	parts.push(s.toString().padStart(2, "0"))

	return parts.join(":")
}

window.viewTranscript = viewTranscript
window.closeTranscriptViewer = closeTranscriptViewer

function formatDate(macTimestamp) {
	if (!macTimestamp) return ""
	// Mac Absolute Time is seconds since 2001-01-01
	const date = new Date((macTimestamp + 978307200) * 1000)
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	})
}

async function openExisting(path) {
	await openPath(path)
}

window.openExisting = openExisting

// Helper to get range of indices based on displayed order
function getRangeIndices(start, end, displayedIndices) {
	const startIdx = displayedIndices.indexOf(start)
	const endIdx = displayedIndices.indexOf(end)
	const set = new Set()
	if (startIdx === -1 || endIdx === -1) return set

	const min = Math.min(startIdx, endIdx)
	const max = Math.max(startIdx, endIdx)
	for (let i = min; i <= max; i++) {
		set.add(displayedIndices[i])
	}
	return set
}

// Toggle episode selection
function toggleEpisode(index, event) {
	if (event) {
		event.stopPropagation()
		// For modifier clicks on checkbox/info, prevent default toggle to use our custom logic
		if (event.shiftKey || event.metaKey || event.ctrlKey) {
			event.preventDefault()
		}
	}

	const isCmd = event && (event.metaKey || event.ctrlKey)
	const isShift = event && event.shiftKey

	// Get displayed indices for range calculations
	const episodeItems = Array.from(elements.episodesList.querySelectorAll(".episode-item"))
	const displayedIndices = episodeItems.map((item) => parseInt(item.dataset.index))

	if (!isCmd && !isShift) {
		// Plain click (no modifiers)
		selectedEpisodes = new Set([index])
		anchorIndex = index
		lastShiftTarget = index
		selectionOverrides.clear()
	} else if (isCmd && !isShift) {
		// Cmd-click (toggle)
		if (selectedEpisodes.has(index)) {
			selectedEpisodes.delete(index)
			selectionOverrides.set(index, "deselected")
		} else {
			selectedEpisodes.add(index)
			selectionOverrides.set(index, "selected")
		}

		// Cleanup override if it matches implied range state
		if (anchorIndex !== null && lastShiftTarget !== null) {
			const range = getRangeIndices(anchorIndex, lastShiftTarget, displayedIndices)
			const isCurrentlyInRange = range.has(index)
			const nowSelected = selectedEpisodes.has(index)
			if (nowSelected === isCurrentlyInRange) {
				selectionOverrides.delete(index)
			}
		}
		anchorIndex = index
		lastShiftTarget = index
	} else if (isShift) {
		// Shift-click or Cmd+Shift-click
		if (anchorIndex === null) {
			// No anchor exists, treat as plain click
			selectedEpisodes = new Set([index])
			anchorIndex = index
			lastShiftTarget = index
			selectionOverrides.clear()
		} else {
			const range = getRangeIndices(anchorIndex, index, displayedIndices)

			if (isCmd) {
				// Cmd+Shift: Add range
				range.forEach((idx) => selectedEpisodes.add(idx))
			} else {
				// Shift: Replace range portion
				selectedEpisodes = new Set(range)
			}

			// Reapply manual overrides T on top of the range
			selectionOverrides.forEach((state, idx) => {
				if (state === "selected") {
					selectedEpisodes.add(idx)
				} else {
					selectedEpisodes.delete(idx)
				}
			})

			lastShiftTarget = index
		}
	}

	renderEpisodes()
	updateUI()
}

// Select all episodes in current tab (respecting filters)
function selectAllInTab() {
	const currentList = getFilteredAndSortedEpisodes(
		episodes
			.map((ep, index) => ({ ...ep, index }))
			.filter((ep) => {
				const filename = getExpectedFilename(ep)
				const isExisting = existingTranscripts.has(filename)
				return (activeTab === "new" && !isExisting) || (activeTab === "existing" && isExisting)
			})
	)

	currentList.forEach((ep) => {
		selectedEpisodes.add(ep.index)
	})

	anchorIndex = null
	lastShiftTarget = null
	selectionOverrides.clear()

	renderEpisodes()
	updateUI()
}

// Deselect all episodes in current tab (respecting filters)
function deselectAllInTab() {
	const currentList = getFilteredAndSortedEpisodes(
		episodes
			.map((ep, index) => ({ ...ep, index }))
			.filter((ep) => {
				const filename = getExpectedFilename(ep)
				const isExisting = existingTranscripts.has(filename)
				return (activeTab === "new" && !isExisting) || (activeTab === "existing" && isExisting)
			})
	)

	currentList.forEach((ep) => {
		selectedEpisodes.delete(ep.index)
	})

	anchorIndex = null
	lastShiftTarget = null
	selectionOverrides.clear()

	renderEpisodes()
	updateUI()
}

function togglePodcastSelection(podcastTitle, select) {
	// Find all episodes in the current tab (respecting filters) that match this podcast
	const currentList = getFilteredAndSortedEpisodes(
		episodes
			.map((ep, index) => ({ ...ep, index }))
			.filter((ep) => {
				const filename = getExpectedFilename(ep)
				const isExisting = existingTranscripts.has(filename)
				return (activeTab === "new" && !isExisting) || (activeTab === "existing" && isExisting)
			})
	)

	currentList.forEach((ep) => {
		if (ep.podcast_title === podcastTitle) {
			if (select) {
				selectedEpisodes.add(ep.index)
			} else {
				selectedEpisodes.delete(ep.index)
			}
		}
	})

	anchorIndex = null
	lastShiftTarget = null
	selectionOverrides.clear()

	renderEpisodes()
	updateUI()
}

window.toggleEpisode = toggleEpisode
window.setActiveTab = setActiveTab
window.selectAllInTab = selectAllInTab
window.deselectAllInTab = deselectAllInTab
window.togglePodcastSelection = togglePodcastSelection

function handleEscape(e) {
	// 1. Close Context Menu
	if (!elements.contextMenu.classList.contains("hidden")) {
		elements.contextMenu.classList.add("hidden")
		if (e) {
			e.preventDefault()
			e.stopPropagation()
		}
		return
	}

	// 2. Leave text input
	const activeElement = document.activeElement
	const isInput = activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable
	if (isInput) {
		activeElement.blur()
		if (e) {
			e.preventDefault()
			e.stopPropagation()
		}
		return
	}

	// 3. Close Transcript View
	if (!elements.modal.classList.contains("hidden")) {
		closeTranscriptViewer()
		if (e) {
			e.preventDefault()
			e.stopPropagation()
		}
		return
	}

	// 4. Default: Deselect All
	deselectAll()
}

// Global select/deselect all (across all tabs)
function selectAll() {
	selectedEpisodes = new Set(episodes.map((_, index) => index))
	anchorIndex = null
	lastShiftTarget = null
	selectionOverrides.clear()
	renderEpisodes()
	updateUI()
}

function deselectAll() {
	selectedEpisodes.clear()
	anchorIndex = null
	lastShiftTarget = null
	selectionOverrides.clear()
	renderEpisodes()
	updateUI()
}

window.selectAll = selectAll
window.deselectAll = deselectAll

// Extract transcripts
async function extractTranscripts(includeTimestamps = true) {
	if (selectedEpisodes.size === 0) {
		setStatus("No episodes selected", "error")
		return
	}

	try {
		// Close dropdown if it's open
		if (elements.barExtractDropdownMenu) {
			elements.barExtractDropdownMenu.classList.add("hidden")
		}

		// Get selected episodes data
		const selectedEpisodesData = Array.from(selectedEpisodes).map((index) => episodes[index])

		// Show progress section
		elements.progressSection.classList.remove("hidden")
		elements.successSection.classList.add("hidden")
		elements.openFolderBtn.classList.add("hidden")
		elements.scanBtn.disabled = true

		const total = selectedEpisodesData.length
		let completed = 0

		// Extract each episode
		for (const episode of selectedEpisodesData) {
			if (episode.is_orphaned && !episode.local_ttml_path) {
				completed++ // Mark as "processed" but skip
				continue
			}
			try {
				elements.progressCurrent.textContent = `Extracting: ${episode.podcast_title} - ${episode.episode_title}`

				await invokeTauri("extract_transcript_command", {
					episode: episode,
					outputDir: elements.outputDir.value,
					includeTimestamps: includeTimestamps,
				})

				transcriptTimestampState.set(episode.transcript_identifier, includeTimestamps)
				completed++
				updateProgress(completed, total)
			} catch (error) {
				console.error(`Error extracting ${episode.episode_title}:`, error)
				// Continue with next episode
			}
		}

		// Success!
		setStatus(`Extracted ${completed} transcripts`, "success")
		elements.successMessageLarge.textContent = `Successfully Extracted ${completed} Transcript${completed === 1 ? "" : "s"}`
		elements.successSection.classList.remove("hidden")
		elements.progressSection.classList.add("hidden")

		// Refresh lists
		await checkExistingTranscripts()

		// Auto-switch to Extracted tab if Unextracted is now empty
		const hasUnextracted = episodes.some((ep) => !existingTranscripts.has(getExpectedFilename(ep)))
		if (activeTab === "new" && !hasUnextracted && existingTranscripts.size > 0) {
			setActiveTab("existing")
		} else {
			renderEpisodes()
		}

		// Re-enable buttons after a short delay for feedback
		setTimeout(() => {
			elements.scanBtn.disabled = false
		}, 1000)
	} catch (error) {
		console.error("Error extracting transcripts:", error)
		setStatus(`Error: ${error}`, "error")
		elements.progressSection.classList.add("hidden")
		elements.scanBtn.disabled = false
	}
}

function dismissSuccessSection() {
	elements.successSection.classList.add("hidden")
	elements.openFolderBtn.classList.remove("hidden")
	elements.statusBar.classList.remove("hidden")
}

// Update progress bar
function updateProgress(current, total) {
	const percentage = (current / total) * 100
	elements.progressBar.style.width = `${percentage}%`
	elements.progressCount.textContent = `${current} / ${total}`
}

// Update UI state
function updateUI() {
	// Selection Bar
	if (selectedEpisodes.size > 0) {
		elements.selectionBar.classList.remove("hidden")
		elements.barSelectedCount.textContent = selectedEpisodes.size

		// Check if any selected episodes have audio or transcripts
		const selectedIndices = Array.from(selectedEpisodes)
		const hasAudio = selectedIndices.some((idx) => episodes[idx].has_audio)
		const hasTranscripts = selectedIndices.some((idx) => existingTranscripts.has(getExpectedFilename(episodes[idx])))

		elements.barRevealAudioBtn.disabled = !hasAudio
		elements.barOpenAudioBtn.disabled = !hasAudio
		elements.barDeleteAudioBtn.disabled = !hasAudio
		elements.barRevealTranscriptsBtn.disabled = !hasTranscripts
		elements.barOpenTranscriptsBtn.disabled = !hasTranscripts

		// Hide Transcripts group in the Unextracted tab
		const showTranscriptsGroup = activeTab !== "new"
		if (elements.barTranscriptsGroup) elements.barTranscriptsGroup.style.display = showTranscriptsGroup ? "flex" : "none"
		if (elements.barTranscriptsDivider) elements.barTranscriptsDivider.style.display = showTranscriptsGroup ? "block" : "none"
	} else {
		elements.selectionBar.classList.add("hidden")
	}
}

// Set status message
function setStatus(message, type = "info") {
	if (!elements.statusMessage || !elements.statusBar) return
	elements.statusMessage.textContent = message

	// Add visual indicator based on type
	if (type === "error") {
		elements.statusMessage.style.color = "var(--error)"
		elements.statusBar.classList.remove("hidden")
	} else {
		if (type === "success") {
			elements.statusMessage.style.color = "var(--success)"
		} else {
			elements.statusMessage.style.color = "var(--text-2)"
		}

		// Hide the bar if it's not an error and the open folder button is hidden
		if (elements.openFolderBtn.classList.contains("hidden")) {
			elements.statusBar.classList.add("hidden")
		} else {
			elements.statusBar.classList.remove("hidden")
		}
	}
}

function showToast(message) {
	let container = document.querySelector(".toast-container")
	if (!container) {
		container = document.createElement("div")
		container.className = "toast-container"
		document.body.appendChild(container)
	}

	const toast = document.createElement("div")
	toast.className = "toast"
	toast.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${message}</span>
    `

	container.appendChild(toast)

	// Remove toast after animation
	setTimeout(() => {
		toast.remove()
		if (container.children.length === 0) {
			container.remove()
		}
	}, 2300)
}

// Utility: Escape HTML
function escapeHtml(text) {
	const div = document.createElement("div")
	div.textContent = text
	return div.innerHTML
}

// Helper to get Tauri APIs safely
function getTauri() {
	return window.__TAURI__
}

async function invokeTauri(cmd, args) {
	const tauri = getTauri()
	if (tauri && tauri.core) {
		return await tauri.core.invoke(cmd, args)
	}
	throw new Error("Tauri core not available")
}

// Initialize app when DOM is ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init)
} else {
	init()
}
