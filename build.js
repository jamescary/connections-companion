#!/usr/bin/env node
/**
 * Builds per-browser packages into dist/:
 *   dist/firefox/   + dist/connections-companion-firefox.zip
 *   dist/chromium/  + dist/connections-companion-chromium.zip
 *
 * The only difference is the manifest: Chrome doesn't accept
 * browser_specific_settings, and Firefox requires it for MV3.
 *
 * Flags:
 *   --sign     also sign the Firefox build via AMO (web-ext sign).
 *              Credentials come from WEB_EXT_API_KEY/WEB_EXT_API_SECRET in the
 *              environment or from a .amo-keys file (KEY=value lines).
 *   --release  --sign, then publish a GitHub release v<version> with the
 *              signed xpi and the chromium zip. Requires a version bump in
 *              manifest.json first (AMO refuses to re-sign a used version).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = __dirname;
const dist = path.join(root, "dist");
const files = ["content.js", "content.css"];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const targets = {
  firefox: manifest,
  chromium: (() => {
    const m = structuredClone(manifest);
    delete m.browser_specific_settings;
    m.minimum_chrome_version = "88";
    return m;
  })(),
};

for (const [name, m] of Object.entries(targets)) {
  const dir = path.join(dist, name);
  // Only rebuild our own targets; dist/safari (the generated Xcode project)
  // must survive rebuilds.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(dist, `connections-companion-${name}.zip`), { force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.cpSync(path.join(root, "images"), path.join(dir, "images"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  execSync(`cd "${dir}" && zip -q -r "../connections-companion-${name}.zip" .`);
  console.log(`built dist/${name} and dist/connections-companion-${name}.zip`);
}

const doRelease = process.argv.includes("--release");
const doSign = doRelease || process.argv.includes("--sign");
if (doSign) {
  const env = { ...process.env };
  const keyFile = path.join(root, ".amo-keys");
  if (!env.WEB_EXT_API_KEY && fs.existsSync(keyFile)) {
    for (const line of fs.readFileSync(keyFile, "utf8").split("\n")) {
      const m = line.match(/^(WEB_EXT_API_(?:KEY|SECRET))=(.+)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  if (!env.WEB_EXT_API_KEY || !env.WEB_EXT_API_SECRET) {
    console.error("Missing AMO credentials: set WEB_EXT_API_KEY/WEB_EXT_API_SECRET or create .amo-keys");
    process.exit(1);
  }
  console.log(`signing v${manifest.version} via AMO (unlisted channel)…`);
  execSync(
    "npx --yes web-ext sign --source-dir dist/firefox --artifacts-dir web-ext-artifacts --channel=unlisted",
    { stdio: "inherit", env, cwd: root }
  );
}

if (doRelease) {
  const v = manifest.version;
  const artifacts = path.join(root, "web-ext-artifacts");
  const xpi = fs.readdirSync(artifacts).find(f => f.endsWith(`-${v}.xpi`)) ||
    (() => { throw new Error(`no signed xpi for v${v} in web-ext-artifacts/`); })();
  const relXpi = path.join(dist, `connections-companion-${v}-firefox.xpi`);
  const relZip = path.join(dist, `connections-companion-${v}-chromium.zip`);
  fs.copyFileSync(path.join(artifacts, xpi), relXpi);
  fs.copyFileSync(path.join(dist, "connections-companion-chromium.zip"), relZip);
  const notes = [
    "## Install",
    "",
    `**Firefox** — download \`connections-companion-${v}-firefox.xpi\`, then open it with Firefox (drag it into a window, or about:addons → gear icon → *Install Add-on From File*). Signed by Mozilla; installs permanently in regular Firefox.`,
    "",
    `**Chrome / Edge / Brave** — download and unzip \`connections-companion-${v}-chromium.zip\`, then chrome://extensions → enable **Developer mode** → **Load unpacked** → pick the unzipped folder.`,
    "",
    "**Safari** — build from source with Xcode; see the README.",
  ].join("\n");
  const notesFile = path.join(dist, "release-notes.md");
  fs.writeFileSync(notesFile, notes + "\n");
  execSync(
    `gh release create v${v} "${relXpi}" "${relZip}" --title "Connections Companion ${v}" --notes-file "${notesFile}"`,
    { stdio: "inherit", cwd: root }
  );
  console.log(`released v${v}`);
}
