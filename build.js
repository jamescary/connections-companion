#!/usr/bin/env node
/**
 * Builds per-browser packages into dist/:
 *   dist/firefox/   + dist/connections-companion-firefox.zip
 *   dist/chromium/  + dist/connections-companion-chromium.zip
 *
 * The only difference is the manifest: Chrome doesn't accept
 * browser_specific_settings, and Firefox requires it for MV3.
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
