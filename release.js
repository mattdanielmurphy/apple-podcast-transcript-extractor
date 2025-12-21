const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Get version from package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tagName = `v${version}`;

console.log(`Preparing release ${tagName}...`);

// 2. Sync version to tauri.conf.json
const tauriConfPath = 'src-tauri/tauri.conf.json';
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2));
console.log('Updated tauri.conf.json');

// 3. Sync version to Cargo.toml
const cargoPath = 'src-tauri/Cargo.toml';
let cargoToml = fs.readFileSync(cargoPath, 'utf8');
cargoToml = cargoToml.replace(/^version = ".*"/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargoToml);
console.log('Updated Cargo.toml');

try {
    // 4. Commit changes
    console.log('Committing version bump...');
    execSync('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
    execSync(`git commit -m "chore: release ${tagName}"`);

    // 5. Create tag
    console.log(`Creating tag ${tagName}...`);
    execSync(`git tag -a ${tagName} -m "Release ${tagName}"`);

    console.log('\nSuccess! Now run the following to push:');
    console.log(`git push origin main && git push origin ${tagName}`);
} catch (error) {
    console.error('\nError during release process:', error.message);
    process.exit(1);
}

