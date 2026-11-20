// Builds a signed, notarized Transcript Extractor and attaches it to a DRAFT
// GitHub release. Nothing becomes public until you press "Publish" on GitHub.
//
//   bun run release            build, sign, notarize, zip, draft release
//   bun run release --no-draft build, sign, notarize and zip only
//
// Needs (in .env or the environment) ONE way to log in to Apple's notary service:
//   App Store Connect API key (preferred, no password):
//     APPLE_API_ISSUER    issuer ID (App Store Connect → Users and Access → Integrations)
//     APPLE_API_KEY       key ID
//     APPLE_API_KEY_PATH  path to the downloaded AuthKey_<id>.p8 file
//   or Apple ID:
//     APPLE_ID        Apple ID email of the developer account
//     APPLE_PASSWORD  app-specific password for that Apple ID (account.apple.com)
//     APPLE_TEAM_ID   10-character team ID
//   APPLE_SIGNING_IDENTITY (optional) defaults to the first "Developer ID Application" identity in the keychain
const { execSync, spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const root = __dirname
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "inherit", ...opts })
const read = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim()
const fail = (msg) => {
	console.error(`\n✗ ${msg}`)
	process.exit(1)
}

// Load .env without printing anything from it.
const envPath = path.join(root, ".env")
if (fs.existsSync(envPath)) {
	for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
	}
}

const has = (keys) => keys.every((k) => process.env[k])
const apiKeyVars = ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"]
const appleIdVars = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]
if (has(apiKeyVars)) {
	if (!fs.existsSync(process.env.APPLE_API_KEY_PATH)) fail("APPLE_API_KEY_PATH points to a file that does not exist.")
	// Use only one login so Tauri doesn't mix them up.
	for (const k of appleIdVars) delete process.env[k]
	console.log("Notarizing with the App Store Connect API key.")
} else if (has(appleIdVars)) {
	console.log("Notarizing with the Apple ID and app-specific password.")
} else {
	fail(`No notary login. Add either ${apiKeyVars.join(", ")} or ${appleIdVars.join(", ")} to .env. See the comment at the top of release.js.`)
}

if (!process.env.APPLE_SIGNING_IDENTITY) {
	const ids = read("security find-identity -v -p codesigning")
	const match = ids.match(/"(Developer ID Application: [^"]+)"/)
	if (!match) fail('No "Developer ID Application" certificate in the keychain. Create one in Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application.')
	process.env.APPLE_SIGNING_IDENTITY = match[1]
}
console.log(`Signing as: ${process.env.APPLE_SIGNING_IDENTITY}`)

// Keep every version number in step with package.json.
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
const tag = `v${version}`
const confPath = path.join(root, "src-tauri/tauri.conf.json")
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"))
conf.version = version
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n")
const cargoPath = path.join(root, "src-tauri/Cargo.toml")
fs.writeFileSync(cargoPath, fs.readFileSync(cargoPath, "utf8").replace(/^version = ".*"/m, `version = "${version}"`))

// Tauri signs with the hardened runtime, notarizes and staples when the
// APPLE_* variables above are set.
console.log(`\nBuilding ${tag} (universal: Apple silicon + Intel)…`)
run("rustup target add aarch64-apple-darwin x86_64-apple-darwin", { stdio: "ignore" })
run("bun run tauri build --target universal-apple-darwin")

const bundleDir = path.join(root, "src-tauri/target/universal-apple-darwin/release/bundle/macos")
const app = path.join(bundleDir, "Transcript Extractor.app")
if (!fs.existsSync(app)) fail(`Build finished but ${app} is missing`)

console.log("\nChecking signature, notarization ticket and Gatekeeper…")
run(`codesign --verify --deep --strict --verbose=2 "${app}"`)
run(`xcrun stapler validate "${app}"`)
const gk = spawnSync("spctl", ["--assess", "--type", "execute", "-vv", app], { encoding: "utf8" })
const gkOut = (gk.stdout + gk.stderr).trim()
console.log(gkOut)
if (gk.status !== 0 || !/Notarized Developer ID/.test(gkOut)) fail("Gatekeeper does not accept the app as notarized.")

const zip = path.join(bundleDir, "Transcript-Extractor.zip")
if (fs.existsSync(zip)) fs.renameSync(zip, `${zip}.old-${Date.now()}`)
run(`ditto -c -k --sequesterRsrc --keepParent "${app}" "${zip}"`)
console.log(`\n✓ Signed and notarized: ${zip}`)

if (process.argv.includes("--no-draft")) process.exit(0)

const notes = path.join(root, "RELEASE_NOTES.md")
if (!fs.existsSync(notes)) fail("Write RELEASE_NOTES.md first (it becomes the release description).")
const existing = spawnSync("gh", ["release", "view", tag], { cwd: root, encoding: "utf8" })
if (existing.status === 0) {
	run(`gh release upload ${tag} "${zip}" --clobber`)
	console.log(`\n✓ Updated the zip on existing release ${tag} (still check it is a draft).`)
} else {
	run(`gh release create ${tag} "${zip}" --draft --title "Transcript Extractor ${version}" --notes-file "${notes}" --target main`)
	console.log(`\n✓ Draft release ${tag} created. It is NOT public until you press Publish on GitHub.`)
}
