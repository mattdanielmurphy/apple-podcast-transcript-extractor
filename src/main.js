// Tauri API will be available at window.__TAURI__
const { invoke } = window.__TAURI__.core
const { open } = window.__TAURI__.dialog

// State
let episodes = []
let existingTranscripts = new Set()
let selectedEpisodes = new Set()
let activeTab = "new" // "new" or "existing"
let searchQuery = ""
let contentSearchQuery = ""
let sortOption = "date-desc"
let contentSearchResults = new Set() // Set of indices that match content search

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
	timestampsCheckbox: document.getElementById("timestamps-checkbox"),
	scanBtn: document.getElementById("scan-btn"),
	extractBtn: document.getElementById("extract-btn"),
	selectAllBtn: document.getElementById("select-all-btn"),
	deselectAllBtn: document.getElementById("deselect-all-btn"),
	emptyState: document.getElementById("empty-state"),
	episodesList: document.getElementById("episodes-list"),
	progressSection: document.getElementById("progress-section"),
	progressBar: document.getElementById("progress-bar"),
	progressCount: document.getElementById("progress-count"),
	progressCurrent: document.getElementById("progress-current"),
	statusMessage: document.getElementById("status-message"),
	openFolderBtn: document.getElementById("open-folder-btn"),
	countNew: document.getElementById("count-new"),
	countExisting: document.getElementById("count-existing"),
	tabTitle: document.getElementById("current-tab-title"),
	searchInput: document.getElementById("search-input"),
	contentSearchInput: document.getElementById("content-search-input"),
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
	modalSearchInput: document.getElementById("modal-search-input"),
	modalSearchCount: document.getElementById("modal-search-count"),
	modalSearchPrev: document.getElementById("modal-search-prev"),
	modalSearchNext: document.getElementById("modal-search-next"),
}

// Initialize
function init() {
	setupEventListeners()
	updateUI()
	// Automatically scan on startup
	scanForEpisodes()
}

// Event Listeners
function setupEventListeners() {
	elements.chooseDirBtn.addEventListener("click", chooseDirectory)
	elements.scanBtn.addEventListener("click", scanForEpisodes)
	elements.extractBtn.addEventListener("click", extractTranscripts)
	elements.selectAllBtn.addEventListener("click", selectAllInTab)
	elements.deselectAllBtn.addEventListener("click", deselectAllInTab)
	elements.openFolderBtn.addEventListener("click", () => openPath(elements.outputDir.value))
	elements.searchInput.addEventListener("input", (e) => {
		searchQuery = e.target.value.toLowerCase()
		renderEpisodes()
	})
	elements.contentSearchInput.addEventListener("input", (e) => {
		debounceSearch(e.target.value)
	})
	elements.sortSelect.addEventListener("change", (e) => {
		sortOption = e.target.value
		renderEpisodes()
	})

	// Modal listeners
	elements.modalCloseBtn.addEventListener("click", closeTranscriptViewer)
	elements.modalOverlay.addEventListener("click", closeTranscriptViewer)
	
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

	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !elements.modal.classList.contains("hidden")) {
			closeTranscriptViewer()
		}
	})
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
		const results = await invoke("search_episodes_content", {
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
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: elements.outputDir.value,
		})

		if (selected) {
			elements.outputDir.value = selected
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
		setStatus("Scanning...")
		elements.scanBtn.disabled = true

		// Check output directory for existing files
		await checkExistingTranscripts()

		// Call Tauri backend to scan for episodes
		const foundEpisodes = await invoke("scan_episodes")

		episodes = foundEpisodes

		// Select all by default
		selectedEpisodes = new Set(episodes.map((_, index) => index))

		renderEpisodes()
		updateUI()

		setStatus(`Found ${episodes.length} episodes`)
	} catch (error) {
		console.error("Error scanning episodes:", error)
		setStatus(`Error: ${error}`, "error")
	} finally {
		elements.scanBtn.disabled = false
	}
}

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
		await invoke("open_path", { path })
	} catch (error) {
		console.error("Error opening path:", error)
		setStatus("Error opening path", "error")
	}
}

// Render episodes list
function renderEpisodes() {
	if (episodes.length === 0) {
		elements.emptyState.style.display = "flex"
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

	let html = ""
	if (currentList.length === 0) {
		html = `<div class="empty-state">No episodes found${searchQuery ? ' matching "' + searchQuery + '"' : ""}</div>`
	} else {
		html = currentList.map((ep) => renderEpisodeItem(ep, ep.index, activeTab === "existing")).join("")
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

	// Content Search Filter
	if (contentSearchQuery) {
		filtered = filtered.filter((ep) => contentSearchResults.has(ep.index))
	}

	// Sort
	filtered.sort((a, b) => {
		switch (sortOption) {
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

	if (elements.tabTitle) {
		elements.tabTitle.textContent = tab === "new" ? "Ready to Extract" : "Extracted Episodes"
	}

	renderEpisodes()
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

function renderEpisodeItem(episode, index, isExisting = false) {
	const isSelected = selectedEpisodes.has(index)
	const filename = isExisting ? episode.filename : getExpectedFilename(episode)
	const filePath = `${elements.outputDir.value}/${filename}`

	const pubDate = episode.pub_date ? formatDate(episode.pub_date) : "Unknown Date"
	const importDate = episode.import_date ? formatDate(episode.import_date) : null

	return `
        <div class="episode-item ${isSelected ? "selected" : ""} ${isExisting ? "existing" : ""}" data-index="${index}">
            <input 
                type="checkbox" 
                class="checkbox-input episode-checkbox" 
                ${isSelected ? "checked" : ""}
                onchange="toggleEpisode(${index})"
            >
            <div class="episode-info" onclick="toggleEpisode(${index})">
                <div class="episode-title" title="${escapeHtml(episode.episode_title || "")}">${escapeHtml(episode.episode_title || "Unknown Episode")}</div>
                <div class="episode-metadata">
                    <div class="episode-podcast" title="${escapeHtml(episode.podcast_title || "")}">${escapeHtml(episode.podcast_title || "Unknown Podcast")}</div>
                    <div class="episode-date" title="Published Date">
                        <span class="date-label">Published:</span>${pubDate}
                    </div>
                    ${
											importDate
												? `
                        <div class="episode-date" title="Downloaded Date">
                            <span class="date-label">Downloaded:</span>${importDate}
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
                    <button class="btn-text btn-small" onclick="event.stopPropagation(); openExisting('${filePath}')">
                        Open File
                    </button>
                `
										: ""
								}
            </div>
        </div>
    `
}

async function viewTranscript(index) {
	const episode = episodes[index]
	if (!episode) return

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

		const paragraphs = await invoke("get_transcript", { episode })
		renderTranscriptContent(paragraphs)
		
		if (modalSearchQuery) {
			updateModalSearch()
		}

		elements.modalExtractBtn.onclick = () => {
			closeTranscriptViewer()
			selectedEpisodes.clear()
			selectedEpisodes.add(index)
			renderEpisodes()
			updateUI()
			extractTranscripts()
		}

		setStatus("Transcript loaded")
	} catch (error) {
		console.error("Error loading transcript:", error)
		setStatus("Error loading transcript", "error")
		elements.modalContent.innerHTML = `<div class="empty-state">Error: ${error}</div>`
	}
}

function renderTranscriptContent(paragraphs) {
	const html = paragraphs.map(p => {
		const text = escapeHtml(p.text)
		const time = p.begin !== null ? formatTime(p.begin) : ""
		return `
			<div class="transcript-para">
				<div class="transcript-time">${time}</div>
				<div class="transcript-text">${text}</div>
			</div>
		`
	}).join("")
	elements.modalContent.innerHTML = html
}

function updateModalSearch() {
	// Re-render content to clear old highlights
	// Note: In a real app we'd just replace the text nodes, but for a prototype this is fine
	const paras = Array.from(elements.modalContent.querySelectorAll('.transcript-text'))
	let matchCount = 0
	modalSearchResults = []
	
	if (!modalSearchQuery) {
		paras.forEach(p => {
			p.innerHTML = escapeHtml(p.textContent)
		})
		elements.modalSearchCount.textContent = "0/0"
		return
	}

	const escapedQueryForRegex = modalSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const regex = new RegExp(`(${escapedQueryForRegex})`, 'gi')

	paras.forEach((p, paraIndex) => {
		const textContent = p.textContent
		if (textContent.toLowerCase().includes(modalSearchQuery)) {
			const parts = textContent.split(regex)
			p.innerHTML = parts.map(part => {
				if (part.toLowerCase() === modalSearchQuery) {
					const id = `match-${matchCount}`
					modalSearchResults.push(id)
					matchCount++
					return `<span id="${id}" class="highlight">${escapeHtml(part)}</span>`
				}
				return escapeHtml(part)
			}).join("")
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
	elements.modalContent.querySelectorAll('.highlight.active').forEach(el => el.classList.remove('active'))
	if (currentMatchIndex !== -1) {
		const activeEl = document.getElementById(modalSearchResults[currentMatchIndex])
		if (activeEl) activeEl.classList.add('active')
	}
}

function scrollToMatch(index) {
	const matchId = modalSearchResults[index]
	const element = document.getElementById(matchId)
	if (element) {
		element.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
	if (h > 0) parts.push(h.toString().padStart(2, '0'))
	parts.push(m.toString().padStart(2, '0'))
	parts.push(s.toString().padStart(2, '0'))
	
	return parts.join(':')
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

// Toggle episode selection
function toggleEpisode(index) {
	if (selectedEpisodes.has(index)) {
		selectedEpisodes.delete(index)
	} else {
		selectedEpisodes.add(index)
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
	renderEpisodes()
	updateUI()
}

window.toggleEpisode = toggleEpisode
window.setActiveTab = setActiveTab
window.selectAllInTab = selectAllInTab
window.deselectAllInTab = deselectAllInTab

// Global select/deselect all (across all tabs)
function selectAll() {
	selectedEpisodes = new Set(episodes.map((_, index) => index))
	renderEpisodes()
	updateUI()
}

function deselectAll() {
	selectedEpisodes.clear()
	renderEpisodes()
	updateUI()
}

window.selectAll = selectAll
window.deselectAll = deselectAll

// Extract transcripts
async function extractTranscripts() {
	if (selectedEpisodes.size === 0) {
		setStatus("No episodes selected", "error")
		return
	}

	try {
		// Get selected episodes data
		const selectedEpisodesData = Array.from(selectedEpisodes).map((index) => episodes[index])

		// Show progress section
		elements.progressSection.classList.remove("hidden")
		elements.extractBtn.disabled = true
		elements.scanBtn.disabled = true

		const total = selectedEpisodesData.length
		let completed = 0

		// Extract each episode
		for (const episode of selectedEpisodesData) {
			try {
				elements.progressCurrent.textContent = `Extracting: ${episode.podcast_title} - ${episode.episode_title}`

				await invoke("extract_transcript_command", {
					episode: episode,
					outputDir: elements.outputDir.value,
					includeTimestamps: elements.timestampsCheckbox.checked,
				})

				completed++
				updateProgress(completed, total)
			} catch (error) {
				console.error(`Error extracting ${episode.episode_title}:`, error)
				// Continue with next episode
			}
		}

		// Success!
		setStatus(`Extracted ${completed} transcripts`, "success")
		elements.openFolderBtn.classList.remove("hidden")

		// Refresh lists
		await checkExistingTranscripts()
		renderEpisodes()

		// Hide progress after a delay
		setTimeout(() => {
			elements.progressSection.classList.add("hidden")
			elements.extractBtn.disabled = false
			elements.scanBtn.disabled = false
		}, 3000)
	} catch (error) {
		console.error("Error extracting transcripts:", error)
		setStatus(`Error: ${error}`, "error")
		elements.progressSection.classList.add("hidden")
		elements.extractBtn.disabled = false
		elements.scanBtn.disabled = false
	}
}

// Update progress bar
function updateProgress(current, total) {
	const percentage = (current / total) * 100
	elements.progressBar.style.width = `${percentage}%`
	elements.progressCount.textContent = `${current} / ${total}`
}

// Update UI state
function updateUI() {
	elements.totalCount.textContent = episodes.length
	elements.selectedCount.textContent = selectedEpisodes.size
	elements.extractBtn.disabled = selectedEpisodes.size === 0
}

// Set status message
function setStatus(message, type = "info") {
	elements.statusMessage.textContent = message

	// Add visual indicator based on type
	if (type === "error") {
		elements.statusMessage.style.color = "var(--color-error)"
	} else if (type === "success") {
		elements.statusMessage.style.color = "var(--color-success)"
	} else {
		elements.statusMessage.style.color = "var(--color-text-secondary)"
	}
}

// Utility: Escape HTML
function escapeHtml(text) {
	const div = document.createElement("div")
	div.textContent = text
	return div.innerHTML
}

// Initialize app when DOM is ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init)
} else {
	init()
}
