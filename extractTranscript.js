const fs = require("fs")
const xml2js = require("xml2js")
const path = require("path")
const os = require("os")
const sqlite3 = require("sqlite3").verbose()

// Seconds between the Unix epoch (1970) and Apple's reference date (2001-01-01).
const MAC_EPOCH_OFFSET = 978307200

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
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.substring(0, 200) // Limit length to avoid filesystem issues
}

// Local calendar date (YYYY-MM-DD) for an Apple "Mac absolute time" value, or null.
function formatEpisodeDate(macTimestamp) {
	if (macTimestamp == null || !Number.isFinite(Number(macTimestamp))) return null

	const date = new Date((Number(macTimestamp) + MAC_EPOCH_OFFSET) * 1000)
	if (!Number.isFinite(date.getTime())) return null

	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

function dbAll(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
	})
}

async function tableColumns(db, table) {
	// PRAGMA arguments can't be bound; `table` is always one of our own constants.
	const rows = await dbAll(db, `PRAGMA table_info(${table})`)
	return new Set(rows.map((row) => row.name))
}

// Builds the metadata query for whichever Podcasts database layout is present.
// Newer Podcasts versions keep the transcript identifier in ZMTMEDIAENCLOSURE
// (linked to the episode through ZEPISODE); older ones have it on ZMTEPISODE.
async function buildMetadataQuery(db) {
	const episodeCols = await tableColumns(db, "ZMTEPISODE")
	const enclosureCols = await tableColumns(db, "ZMTMEDIAENCLOSURE")

	const description = episodeCols.has("ZITEMDESCRIPTIONWITHOUTHTML")
		? "e.ZITEMDESCRIPTIONWITHOUTHTML"
		: "NULL"
	const columns = `
			SELECT
				e.ZTITLE as episode_title,
				e.ZPUBDATE as pub_date,
				${description} as description,
				p.ZTITLE as podcast_title,
				p.ZAUTHOR,
				p.ZCATEGORY`

	if (enclosureCols.has("ZTRANSCRIPTIDENTIFIER") && enclosureCols.has("ZEPISODE")) {
		return `${columns}
			FROM ZMTMEDIAENCLOSURE m
			JOIN ZMTEPISODE e ON e.Z_PK = m.ZEPISODE
			JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
			WHERE m.ZTRANSCRIPTIDENTIFIER = ?`
	}
	if (episodeCols.has("ZTRANSCRIPTIDENTIFIER")) {
		return `${columns}
			FROM ZMTEPISODE e
			JOIN ZMTPODCAST p ON e.ZPODCASTUUID = p.ZUUID
			WHERE e.ZTRANSCRIPTIDENTIFIER = ?`
	}
	throw new Error(
		"Unsupported Apple Podcasts database: could not find where transcripts are linked to episodes. " +
			"Apple probably changed the schema; please open an issue."
	)
}

function queryEpisodeMetadata(db, query, transcriptIdentifier) {
	return new Promise((resolve) => {
		db.get(query, [transcriptIdentifier], (err, row) => {
			if (err) {
				console.error(`Database query error for ${transcriptIdentifier}:`, err.message)
				resolve(null)
			} else {
				resolve(row || null)
			}
		})
	})
}

// The header written above the transcript when the episode is known.
function metadataHeader(metadata) {
	if (!metadata) return ""
	const lines = [
		`Podcast: ${metadata.podcast_title || "Unknown Podcast"}`,
		`Date: ${formatEpisodeDate(metadata.pub_date) || "Unknown Date"}`,
		`Episode: ${metadata.episode_title || "Unknown Episode"}`,
	]
	const description = (metadata.description || "").trim()
	if (description) lines.push("", "Description:", description)
	return lines.join("\n") + "\n\n"
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
				if (typeof span === "string") {
					text += span + " "
				} else if (span.span) {
					text += extractTextFromSpans(span.span)
				} else if (span._) {
					text += span._ + " "
				}
			})
			return text
		}

		const divs = result?.tt?.body?.[0]?.div || []
		const paragraphs = divs.flatMap((div) => div.p || [])

		paragraphs.forEach((paragraph) => {
			if (paragraph.span) {
				const paragraphText = extractTextFromSpans(paragraph.span).replace(/\s+/g, " ").trim()
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

		fs.writeFileSync(outputPath, metadataHeader(metadata) + transcript.join("\n\n"))
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
			const transcriptIdentifier = relativePath.replace(/(.+\.ttml)-\d+\.ttml$/, "$1")

			if (transcriptIdentifier.startsWith("PodcastContent")) {
				ttmlFiles.push({
					path: fullPath,
					transcriptIdentifier: transcriptIdentifier,
					// Keep the old id for fallback compatibility
					id: transcriptIdentifier.match(/PodcastContent([^\/]+)/)?.[1] || "unknown",
				})
			}
		}
	})

	return ttmlFiles
}

// --- Arguments ---------------------------------------------------------------
// Flags may appear anywhere: --timestamps, --podcasts-dir <path>
const args = process.argv.slice(2)
const includeTimestamps = args.includes("--timestamps")
let podcastsDir = path.join(os.homedir(), "Library/Group Containers/243LU875E5.groups.com.apple.podcasts")
const positional = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--timestamps") continue
	if (args[i] === "--podcasts-dir") {
		podcastsDir = args[++i]
		continue
	}
	positional.push(args[i])
}

function usage() {
	console.error("Usage:")
	console.error("  All transcripts:  node extractTranscript.js [--timestamps]")
	console.error("  One file:         node extractTranscript.js <input.ttml> <output.txt> [--timestamps]")
	console.error("  Other library:    add --podcasts-dir <path to 243LU875E5.groups.com.apple.podcasts>")
	process.exit(1)
}

if (positional.length === 2) {
	// Individual file mode
	const [inputPath, outputPath] = positional
	fs.readFile(inputPath, "utf8", (err, data) => {
		if (err) {
			console.error(err)
			return
		}
		extractTranscript(data, outputPath, includeTimestamps)
	})
} else if (positional.length === 0) {
	// Batch mode - process all TTML files
	const ttmlBaseDir = path.join(podcastsDir, "Library/Cache/Assets/TTML")
	const dbPath = path.join(podcastsDir, "Documents/MTLibrary.sqlite")

	if (!fs.existsSync(dbPath)) {
		console.error(`Apple Podcasts database not found at: ${dbPath}`)
		console.error("Open the Podcasts app at least once, then try again.")
		process.exit(1)
	}

	if (!fs.existsSync(ttmlBaseDir)) {
		console.error("No transcripts found yet.")
		console.error("Apple Podcasts only saves a transcript after you open it: in Podcasts, play the episode")
		console.error("or open its transcript, then run this again. Private or paid feeds have no transcripts.")
		process.exit(1)
	}

	console.log("Searching for TTML files...")
	const ttmlFiles = findTTMLFiles(ttmlBaseDir)
	console.log(`Found ${ttmlFiles.length} TTML files`)

	if (!fs.existsSync("./transcripts")) {
		fs.mkdirSync("./transcripts")
	}

	console.log("Connecting to Apple Podcasts database...")
	const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY)

	// Track filename occurrences to handle duplicates
	const filenameCounts = new Map()

	function uniqueName(baseFilename, separator) {
		const count = filenameCounts.get(baseFilename) || 0
		filenameCounts.set(baseFilename, count + 1)
		const suffix = count === 0 ? "" : separator === "paren" ? ` (${count})` : `-${count}`
		return `${baseFilename}${suffix}.txt`
	}

	// Process files sequentially to avoid overwhelming the database
	async function processFiles() {
		const metadataQuery = await buildMetadataQuery(db)

		for (const file of ttmlFiles) {
			let metadata = null
			try {
				console.log(`Processing: ${file.transcriptIdentifier}`)

				metadata = await queryEpisodeMetadata(db, metadataQuery, file.transcriptIdentifier)

				let filename
				if (metadata && metadata.podcast_title && metadata.episode_title) {
					// "<podcast> - <YYYY-MM-DD> - <episode>" so files sort by date within a show
					const date = formatEpisodeDate(metadata.pub_date)
					const parts = [metadata.podcast_title, date, metadata.episode_title].filter(Boolean)
					filename = uniqueName(sanitizeFilename(parts.join(" - ")), "paren")

					console.log(`  Found metadata: "${metadata.podcast_title}" - "${metadata.episode_title}"`)
				} else {
					// Fallback to original ID-based naming
					filename = uniqueName(file.id, "dash")
					console.log(`  No metadata found, using ID: ${file.id}`)
				}

				const outputPath = path.join("./transcripts", filename)
				const data = fs.readFileSync(file.path, "utf8")
				extractTranscript(data, outputPath, includeTimestamps, metadata)
			} catch (error) {
				console.error(`Error processing ${file.transcriptIdentifier}:`, error.message)

				// Fallback to ID-based naming on error
				const outputPath = path.join("./transcripts", uniqueName(file.id, "dash"))
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
		console.error("Error during processing:", error.message || error)
		db.close()
		process.exit(1)
	})
} else {
	console.error("Invalid arguments.")
	usage()
}
