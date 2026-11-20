const fs = require("fs")
const xml2js = require("xml2js")
const path = require("path")
const os = require("os")
const sqlite3 = require("sqlite3").verbose()

function formatTimestamp(seconds) {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)

	return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function parseTtmlTime(value) {
	const time = value.trim()
	if (!time) throw new Error(`Invalid TTML timestamp: ${value}`)

	const seconds = Number(time)
	if (Number.isFinite(seconds)) return seconds

	if (time.includes(":")) {
		const parts = time.split(":").map((part) => part.trim())
		if (parts.some((part) => !part || !Number.isFinite(Number(part)))) {
			throw new Error(`Invalid TTML timestamp: ${value}`)
		}
		const values = parts.map(Number)
		if (values.length === 3) return values[0] * 3600 + values[1] * 60 + values[2]
		if (values.length === 2) return values[0] * 60 + values[1]
		throw new Error(`Invalid TTML timestamp: ${value}`)
	}

	const offset = time.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
	if (offset) {
		const amount = Number(offset[1])
		switch (offset[2]) {
			case "ms": return amount / 1000
			case "s": return amount
			case "m": return amount * 60
			case "h": return amount * 3600
		}
	}

	throw new Error(`Invalid TTML timestamp: ${value}`)
}

function sanitizeFilename(filename) {
	// Replace invalid filesystem characters and limit length
	return filename
		.replace(/[<>:"/\\|?*]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.substring(0, 200) // Limit length to avoid filesystem issues
}

function queryEpisodeMetadata(db, transcriptIdentifier) {
	return new Promise((resolve, reject) => {
		const query = `
			SELECT
				e.ZTITLE as episode_title,
				e.ZPUBDATE as pub_date,
				e.ZITEMDESCRIPTIONWITHOUTHTML as description,
				p.ZTITLE as podcast_title,
				p.ZAUTHOR,
				p.ZCATEGORY
			FROM ZMTEPISODE e
			JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
			WHERE e.ZTRANSCRIPTIDENTIFIER = ?
		`

		db.get(query, [transcriptIdentifier], (err, row) => {
			if (err) {
				console.error(`Database query error for ${transcriptIdentifier}:`, err.message)
				resolve(null)
			} else {
				resolve(row)
			}
		})
	})
}

function formatEpisodeDate(macTimestamp) {
	if (macTimestamp == null || !Number.isFinite(Number(macTimestamp))) return "Unknown Date"

	const date = new Date((Number(macTimestamp) + 978307200) * 1000)
	if (!Number.isFinite(date.getTime())) return "Unknown Date"

	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

function extractTranscript(ttmlContent, outputPath, includeTimestamps = false, metadata = null) {
	const parser = new xml2js.Parser()

	parser.parseString(ttmlContent, (err, result) => {
		if (err) {
			throw err
		}

		let transcript = []

		function extractTextFromSpans(spans) {
			let text = ""
			spans.forEach((span) => {
				if (span.span) {
					text += extractTextFromSpans(span.span)
				} else if (span._) {
					text += span._ + " "
				}
			})
			return text
		}

		const paragraphs = result.tt.body[0].div[0].p

		paragraphs.forEach((paragraph) => {
			if (paragraph.span) {
				const paragraphText = extractTextFromSpans(paragraph.span).trim()
				if (paragraphText) {
					if (includeTimestamps && paragraph.$ && paragraph.$.begin) {
						const timestamp = formatTimestamp(parseTtmlTime(paragraph.$.begin))
						transcript.push(`[${timestamp}] ${paragraphText}`)
					} else {
						transcript.push(paragraphText)
					}
				}
			}
		})

		const outputText = [
			`Podcast: ${metadata?.podcast_title || "Unknown Podcast"}`,
			`Date: ${formatEpisodeDate(metadata?.pub_date)}`,
			`Episode: ${metadata?.episode_title || "Unknown Episode"}`,
			"",
			"Description:",
			metadata?.description || "",
			"",
			transcript.join("\n\n"),
		].join("\n")
		fs.writeFileSync(outputPath, outputText)
		console.log(`Transcript saved to ${outputPath}`)
	})
}

function findTTMLFiles(dir, baseDir = dir) {
	const files = fs.readdirSync(dir)
	let ttmlFiles = []

	files.forEach((file) => {
		const fullPath = path.join(dir, file)
		const stat = fs.statSync(fullPath)

		if (stat.isDirectory()) {
			ttmlFiles = ttmlFiles.concat(findTTMLFiles(fullPath, baseDir))
		} else if (path.extname(fullPath) === ".ttml") {
			// Extract the transcript identifier (relative path from TTML base directory)
			const relativePath = path.relative(baseDir, fullPath)

			// Handle duplicate filename pattern (e.g., transcript_123.ttml-123.ttml -> transcript_123.ttml)
			const transcriptIdentifier = relativePath.replace(/(.+\.ttml)-\d+\.ttml$/, '$1')

			if (transcriptIdentifier.startsWith('PodcastContent')) {
				ttmlFiles.push({
					path: fullPath,
					transcriptIdentifier: transcriptIdentifier,
					// Keep the old id for fallback compatibility
					id: transcriptIdentifier.match(/PodcastContent([^\/]+)/)?.[1] || 'unknown',
				})
			}
		}
	})

	return ttmlFiles
}

// Create output directory if it doesn't exist
if (!fs.existsSync("./transcripts")) {
	fs.mkdirSync("./transcripts")
}

const includeTimestamps = process.argv.includes("--timestamps")

if (process.argv.length >= 4 && !includeTimestamps) {
	// Individual file mode
	const inputPath = process.argv[2]
	const outputPath = process.argv[3]
	fs.readFile(inputPath, "utf8", (err, data) => {
		if (err) {
			console.error(err)
			return
		}
		extractTranscript(data, outputPath, includeTimestamps)
	})
} else if (process.argv.length === 2 || (process.argv.length === 3 && includeTimestamps)) {
	// Batch mode - process all TTML files
	const ttmlBaseDir = path.join(os.homedir(), "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML")
	const dbPath = path.join(os.homedir(), "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite")

	console.log("Searching for TTML files...")
	const ttmlFiles = findTTMLFiles(ttmlBaseDir)

	console.log(`Found ${ttmlFiles.length} TTML files`)

	if (!fs.existsSync(dbPath)) {
		console.error(`Database not found at: ${dbPath}`)
		console.error("Please ensure Apple Podcasts app has been used and the database exists.")
		process.exit(1)
	}

	console.log("Connecting to Apple Podcasts database...")
	const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY)

	// Track filename occurrences to handle duplicates
	const filenameCounts = new Map()

	// Process files sequentially to avoid overwhelming the database
	async function processFiles() {
		for (const file of ttmlFiles) {
			let metadata = null
			try {
				console.log(`Processing: ${file.transcriptIdentifier}`)

				// Query database for metadata
				metadata = await queryEpisodeMetadata(db, file.transcriptIdentifier)

				let filename
				if (metadata && metadata.podcast_title && metadata.episode_title) {
					// Use podcast + episode title for filename
					const baseFilename = sanitizeFilename(`${metadata.podcast_title} - ${metadata.episode_title}`)

					// Handle duplicate filenames
					const count = filenameCounts.get(baseFilename) || 0
					const suffix = count === 0 ? "" : ` (${count})`
					filename = `${baseFilename}${suffix}.txt`
					filenameCounts.set(baseFilename, count + 1)

					console.log(`  Found metadata: "${metadata.podcast_title}" - "${metadata.episode_title}"`)
				} else {
					// Fallback to original ID-based naming
					const baseFilename = file.id
					const count = filenameCounts.get(baseFilename) || 0
					const suffix = count === 0 ? "" : `-${count}`
					filename = `${baseFilename}${suffix}.txt`
					filenameCounts.set(baseFilename, count + 1)

					console.log(`  No metadata found, using ID: ${file.id}`)
				}

				const outputPath = path.join("./transcripts", filename)
				const data = fs.readFileSync(file.path, "utf8")
				extractTranscript(data, outputPath, includeTimestamps, metadata)

			} catch (error) {
				console.error(`Error processing ${file.transcriptIdentifier}:`, error.message)

				// Fallback to ID-based naming on error
				const baseFilename = file.id
				const count = filenameCounts.get(baseFilename) || 0
				const suffix = count === 0 ? "" : `-${count}`
				const outputPath = path.join("./transcripts", `${baseFilename}${suffix}.txt`)
				filenameCounts.set(baseFilename, count + 1)

				try {
					const data = fs.readFileSync(file.path, "utf8")
					extractTranscript(data, outputPath, includeTimestamps, metadata)
				} catch (fallbackError) {
					console.error(`Failed to process ${file.path}:`, fallbackError.message)
				}
			}
		}

		db.close()
		console.log("Processing completed!")
	}

	processFiles().catch((error) => {
		console.error("Error during processing:", error)
		db.close()
		process.exit(1)
	})
} else {
	console.error("Invalid arguments.")
	console.error("Usage:")
	console.error("  For single file: node extractTranscript.js <input.ttml> <output.txt> [--timestamps]")
	console.error("  For all files: node extractTranscript.js [--timestamps]")
	process.exit(1)
}
