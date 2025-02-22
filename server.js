const fs = require("fs");
const path = require("path");
const express = require("express");

//Our configuration file.
const configPath = path.join(__dirname, "config.json");

const config = loadConfig();
const HOSTNAME = config.server.ip;
const PORT = config.server.port;

const BASE_DIR = path.join(__dirname, "data");
const JSON_DIR = path.join(__dirname, "json");
const IMAGE_DIR = path.join(BASE_DIR, "covers");

const GAMES_DIR = path.join(BASE_DIR, "games");
const APPS_DIR = path.join(BASE_DIR, "apps");
const UPDATES_DIR = path.join(BASE_DIR, "updates");
const DLC_DIR = path.join(BASE_DIR, "DLC");
const DEMOS_DIR = path.join(BASE_DIR, "demos");
const HOMEBREW_DIR = path.join(BASE_DIR, "homebrew");

// Create our Directory Structure
if (!fs.existsSync(JSON_DIR)) fs.mkdirSync(JSON_DIR, { recursive: true });
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });
if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });
if (!fs.existsSync(DEMOS_DIR)) fs.mkdirSync(DEMOS_DIR, { recursive: true });
if (!fs.existsSync(DLC_DIR)) fs.mkdirSync(DLC_DIR, { recursive: true });
if (!fs.existsSync(HOMEBREW_DIR)) fs.mkdirSync(HOMEBREW_DIR, { recursive: true });

// Ignore 
const IGNORED_DIRS = ["covers"];

function loadConfig() {
    try {
        const rawData = fs.readFileSync(configPath, "utf8");
        return JSON.parse(rawData);
    } catch (error) {
        console.error("❌ Error loading config.json:", error.message);
        process.exit(1); // Exit if config cannot be loaded
    }
}

// Read bytes at a given offset
function readBytes(fd, offset, length) {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer;
}

// Extract data from the Package SFO 
function parseSFO(buffer) {
    const keyTableOffset = buffer.readUInt32LE(8);
    const dataOffset = buffer.readUInt32LE(12);
    const numEntries = buffer.readUInt32LE(16);

    let keyTable = buffer.slice(keyTableOffset);
    let gameInfo = {};

    for (let i = 0; i < numEntries; i++) {
        let entryOffset = 20 + i * 16;
        if (entryOffset + 16 > buffer.length) continue;

        let keyOffset = buffer.readUInt16LE(entryOffset);
        let valueType = buffer.readUInt16LE(entryOffset + 2);
        let valueSize = buffer.readUInt32LE(entryOffset + 4);
        let relativeDataOffset = buffer.readUInt32LE(entryOffset + 12);
        let absoluteDataOffset = dataOffset + relativeDataOffset;

        if (keyOffset >= keyTable.length) continue;

        let keyEnd = keyTable.indexOf(0, keyOffset);
        if (keyEnd === -1) keyEnd = keyTable.length;
        let key = keyTable.slice(keyOffset, keyEnd).toString("utf8");

        if (absoluteDataOffset + valueSize > buffer.length) continue;

        let value;
        if (valueType === 0x0204) {
            let rawValue = buffer.slice(absoluteDataOffset, absoluteDataOffset + valueSize);
            value = rawValue.toString("utf8").replace(/\0/g, '');
        } else if (valueType === 0x0404) {
            value = buffer.readUInt32LE(absoluteDataOffset);
        } else {
            continue;
        }

        gameInfo[key] = value;
    }

    return gameInfo;
}

// Extract a game image from a package.
function extractGameImage(pkgPath, titleID) {
    try {
        const fd = fs.openSync(pkgPath, "r");
        const fileSize = fs.statSync(pkgPath).size;

        let offset = 0;
        const blockSize = 1048576;
        let foundOffset = null;

        while (offset < fileSize) {
            const buffer = readBytes(fd, offset, blockSize);
            const match = buffer.indexOf(Buffer.from("PNG", "binary"));

            if (match !== -1) {
                foundOffset = offset + match - 1;
                break;
            }
            offset += blockSize;
        }

        if (foundOffset === null) {
            fs.closeSync(fd);
            return false;
        }

        const imageBuffer = readBytes(fd, foundOffset, 512 * 1024);
        const imagePath = path.join(IMAGE_DIR, `${titleID}.png`);

        fs.writeFileSync(imagePath, imageBuffer);
        fs.closeSync(fd);

        return true;
    } catch (error) {
        console.error(`❌ Image extraction failed for: ${pkgPath} - ${error.message}`);
        return false;
    }
}

// Detect region based on the content ID.
function detectRegion(contentID) {
    if (!contentID) return null;
    if (contentID.startsWith("UP")) return "USA";
    if (contentID.startsWith("EP")) return "EUR";
    if (contentID.startsWith("JP")) return "JAP";
    return "UNK";
}

// Get a date to fill in for the JSON. We'll default to the file creation date.
function getFormattedDate(filePath) {
    const creationDate = new Date( fs.statSync(filePath).birthtime);
    return `${("0" + (creationDate.getMonth() + 1)).slice(-2)}-${("0" + creationDate.getDate()).slice(-2)}-${creationDate.getFullYear()}`;
}

// Extract game details directly from the package metadata. 
function extractGameDetails(pkgPath) {
    try {
        const fd = fs.openSync(pkgPath, "r");
        const fileSize = fs.statSync(pkgPath).size;

        let offset = 0;
        const blockSize = 1048576;
        let foundOffset = null;

        while (offset < fileSize) {
            const buffer = readBytes(fd, offset, blockSize);
            const match = buffer.indexOf(Buffer.from("\x00PSF\x01\x01\x00\x00", "binary"));

            if (match !== -1) {
                foundOffset = offset + match;
                break;
            }
            offset += blockSize;
        }

        if (foundOffset === null) {
            console.error(`❌ PARAM.SFO not found in ${pkgPath}`);
            return null;
        }

        const sfoBuffer = readBytes(fd, foundOffset, 2048);
        fs.closeSync(fd);

        return parseSFO(sfoBuffer);
    } catch (error) {
        console.error(`❌ Failed to process PKG: ${pkgPath} - ${error.message}`);
        return null;
    }
}

// Generate JSON data specifically for the FPKGi client.
function generateJSON(folder, details) {
    const jsonFilePath = path.join(JSON_DIR, `${folder}.json`);

    let jsonData = { DATA: {} };
    if (fs.existsSync(jsonFilePath)) {
        jsonData = JSON.parse(fs.readFileSync(jsonFilePath, "utf8"));
    }
   // console.log(details);
    jsonData.DATA[encodeURI(details.pkgPath)] = {
        region: details.region,
        title_id: details.title_id,
        name: details.title,
        version: details.version,
        release: details.release,
        size: details.size,
        min_fw: null,
        cover_url: details.cover_url
    };

    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 4));
    console.log(`✅ Updated JSON: ${jsonFilePath}`);
}

// Start our local webserver implementation.
const app = express();
app.use("/pkg", express.static(BASE_DIR));
app.use("/images", express.static(IMAGE_DIR));
app.get("/:category.json", (req, res) => {
    const jsonPath = path.join(JSON_DIR, `${req.params.category}.json`);
    if (fs.existsSync(jsonPath)) {
        res.sendFile(jsonPath);
    } else {
        res.status(404).json({ error: "File Not found" });
    }
});

app.get("/background", (req, res) => {
    if (fs.existsSync("background.png")) {
        res.sendFile(path.join(__dirname, "background.png"));
    } else {
        res.status(404).json({ error: "Background not found. Create background.png in the root folder." });
    }
});

app.get("/background.png", (req, res) => {
    if (fs.existsSync("background.png")) {
        res.sendFile(path.join(__dirname, "background.png"));
    } else {
        res.status(404).json({ error: "Background not found. Create background.png in the root folder." });
    }
});

app.get("/refresh", (req, res) => {
    scanPackages();
    res.send("Library refresh started. Check the JSON files once the files have finished processing...");
});

app.get("/", (req, res) => {
    const jsonFiles = fs.readdirSync(JSON_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => {
            const category = path.basename(file, '.json');
            return {
                name: category,
                url: `/${category}.json`
            };
        });

    const html = `
        <!DOCTYPE html>
<html>
    <head>
        <title>Available Categories</title>
        <style>
            body { 
                background-color: #121212;
                color: #e0e0e0;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                line-height: 1.6;
            }
            h1, h2 {
                color: #ffffff;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            li { 
                margin: 10px 0;
                padding: 10px;
                background: #1e1e1e;
                border-radius: 4px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
            }
            a {
                color: #BB86FC;
                text-decoration: none;
            }
            a:hover { 
                text-decoration: underline;
            }
            textarea {
                width: 100%;
                height: 150px;
                background-color: #1e1e1e;
                color: #e0e0e0;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 10px;
                font-family: monospace;
                resize: vertical;
            }
            hr {
                height: 2px;
                color:rgb(128, 128, 128);
                background: #rgb(128, 128, 128);
                font-size: 0;
                border: 0;
            }
            .dark-textarea {
                background-color: #1e1e1e;
                color: #cfcfcf;
                border: 1px solid #333;
                padding: 10px;
                width: 100%;
                min-height: 190px;
                border-radius: 4px;
                font-size: 14px;
                resize: vertical;
                box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            }
            .copy-btn {
                margin-top: 0px;
                padding: 8px 16px;
                background-color: #333;
                color: #fff;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.3s ease;
                float:right;
            }
            .copy-btn:hover {
                background-color: #555;
            }
        </style>
    </head>
    <body>
        <h1>Package Categories</h1>
        <hr />
        <p>Click on the links below to view the JSON data and URL for your discovered packages. Either manually copy these URLs into your config, or use the generated config below. Click the Eye icon to see a parsed library view.</p>
        <ul>
            ${jsonFiles.map(file => `
                <li>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="JSON File">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <text x="12" y="17" text-anchor="middle" font-size="4" fill="currentColor">{ }</text>
                    </svg>&nbsp;
                <a href="${file.name}">/${file.name}</a> 
                <a style="float:right;" href="/library/?cat=${file.name}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#e0e0e0" viewBox="0 0 24 24">
                        <path d="M12 4.5C7.305 4.5 3.032 7.28 1 12c2.032 4.72 6.305 7.5 11 7.5s8.968-2.78 11-7.5c-2.032-4.72-6.305-7.5-11-7.5zm0 13.5c-3.03 0-5.5-2.47-5.5-5.5S8.97 7 12 7s5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zm0-9a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
                    </svg>
                </a></li>
            `).join('')}
        </ul>

        <h2>Generated Config</h2>
        <p>Use the following configuration to setup your FPKGi config</p>
        <textarea id="json" readonly class="dark-textarea">
"CONTENT_URLS": {
    "games": http://${HOSTNAME}:${PORT}/games,
    "apps": http://${HOSTNAME}:${PORT}/apps,
    "updates": http://${HOSTNAME}:${PORT}/updates,
    "DLC": http://${HOSTNAME}:${PORT}/DLC,
    "demos": http://${HOSTNAME}:${PORT}/demos,
    "homebrew": http://${HOSTNAME}:${PORT}/homebrew
}</textarea>
<button class="copy-btn" id="copyBtn">Copy</button>
        
        <h2>Notes:</h2>
        <p>Create background.png in the root folder and use the URL <a href="/background">/background</a> inside of the config file to specify a custom background.</p>
        <script>
            document.getElementById('copyBtn').addEventListener('click', function() {
            const textarea = document.getElementById('json');
            textarea.select();
            textarea.setSelectionRange(0, 99999); // For mobile devices
            
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(textarea.value).then(() => {
                alert('Config copied to clipboard.');
                }).catch(err => {
                alert('Failed to copy config: ' + err);
                });
            } else {
                document.execCommand('copy');
                alert('Config copied to clipboard.');
            }
            });
        </script>
    </body>
</html>`;

    res.send(html);
});

app.get("/library", (req, res) => {
    const cat = req.query.cat;
    const allowedCategories = ["apps", "demos", "DLC", "games", "homebrew", "updates"];
    if (!allowedCategories.includes(cat)) {
        res.status(404).send("Not Found");
        return;
    }
    const capitalize = s => s ? s.replace(/^./, c => c.toUpperCase()) : s;
    const title = capitalize(cat);
    const html = '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '  <meta charset="UTF-8">' +
    '  <title>' + title + ' Library</title>' +
    '  <style>' +
    '    body { background-color: #121212; color: #e0e0e0; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; }' +
    '    h1 { text-align: center; color: #ffffff; margin-bottom: 30px; }' +
    '    #library { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px; }' +
    '    .card { background-color: #1e1e1e; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); transition: transform 0.2s ease; text-align: center; }' +
    '    .card:hover { transform: scale(1.05); }' +
    '    .card img { width: 100%; height: auto; display: block; }' +
    '    .info { padding: 10px; }' +
    '    .info h3 { margin: 0; font-size: 1em; color: #BB86FC; }' +
    '    .info p { margin: 5px 0; font-size: 0.85em; color: #aaa; }' +
    '    .info a { color: #BB86FC; text-decoration: none; font-size: 0.8em; }' +
    '    .info a:hover { text-decoration: underline; }' +
    '  </style>' +
    '</head>' +
    '<body>' +
    '  <h1>' + title + ' Library</h1>' +
    '  <div id="library"></div>' +
    '   <a href="/" style="display:inline-block; padding:10px 20px; text-align:center; margin-top:20px; background-color:#1e1e1e; color:#e0e0e0; border:1px solid #333; border-radius:4px; text-decoration:none; font-family:"Segoe UI", Tahoma, Geneva, Verdana, sans-serif; transition: background-color 0.2s ease;">Back</a>' + 
    '  <script>' +
    '    function createGameCard(pkgUrl, game) {' +
    '      var card = document.createElement("div");' +
    '      card.className = "card";' +
    '      var img = document.createElement("img");' +
    '      img.src = game.cover_url;' +
    '      img.alt = game.name + " cover";' +
    '      card.appendChild(img);' +
    '      var info = document.createElement("div");' +
    '      info.className = "info";' +
    '      var title = document.createElement("h3");' +
    '      title.textContent = game.name;' +
    '      info.appendChild(title);' +
    '      var details = document.createElement("p");' +
    '      details.innerHTML = "<strong>" + game.region + "</strong> | v" + game.version + " | " + game.release;' +
    '      info.appendChild(details);' +
    '      var link = document.createElement("a");' +
    '      link.href = pkgUrl;' +
    '      link.textContent = "Download";' +
    '      link.target = "_blank";' +
    '      info.appendChild(link);' +
    '      card.appendChild(info);' +
    '      return card;' +
    '    }' +
    '    function loadGameLibrary() {' +
    '      fetch("/' + cat + '")' +
    '        .then(function(response) {' +
    '          if (!response.ok) {' +
    '            throw new Error("Network response was not ok");' +
    '          }' +
    '          return response.json();' +
    '        })' +
    '        .then(function(data) {' +
    '          var library = document.getElementById("library");' +
    '          var games = data.DATA;' +
    '          for (var pkgUrl in games) {' +
    '            if (games.hasOwnProperty(pkgUrl)) {' +
    '              var card = createGameCard(pkgUrl, games[pkgUrl]);' +
    '              library.appendChild(card);' +
    '            }' +
    '          }' +
    '        })' +
    '        .catch(function(error) {' +
    '          console.error("Error fetching game library:", error);' +
    '          document.getElementById("library").innerHTML = "<p>Error loading game library.</p>";' +
    '        });' +
    '    }' +
    '    document.addEventListener("DOMContentLoaded", loadGameLibrary);' +
    '  </script>' +
    '</body>' +
    '</html>';
    res.send(html);
});

app.get("/:category", (req, res) => {
    const jsonPath = path.join(JSON_DIR, `${req.params.category}.json`);
   // console.log(req);
    if (fs.existsSync(jsonPath)) {
        res.sendFile(jsonPath);
    } else {
        res.status(404).json({ error: "File Not found" });
    }
});

// Look for package files in the correct folders
function scanPackages() {
    console.log("🔄 Scanning for PKG files...");
    let processedCount = 0;

    const folders = fs.readdirSync(BASE_DIR).filter(folder =>
        fs.statSync(path.join(BASE_DIR, folder)).isDirectory() && !IGNORED_DIRS.includes(folder)
    );

    folders.forEach(folder => {
        const folderPath = path.join(BASE_DIR, folder);
        const jsonPath = path.join(JSON_DIR, `${folder}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify({ DATA: {} }, null, 4));

        fs.readdirSync(folderPath, { withFileTypes: true }).forEach(entry => {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                fs.readdirSync(fullPath).forEach(subFile => {
                    processPKG(folder, path.join(fullPath, subFile));
                });
            } else if (entry.name.endsWith(".pkg")) {
                processPKG(folder, fullPath);
                processedCount++;
            }
        });
    });

    console.log(`✅ Processed ${processedCount} PKG files.`);
}

// Get metadata from the package so we can grab the CUSA ID
function readPkgMetadata(pkgPath) {
    const fd = fs.openSync(pkgPath, "r");
    const buffer = Buffer.alloc(0x800); // Read the first 2KB
    fs.readSync(fd, buffer, 0, 0x800, 0);
    fs.closeSync(fd);

    // Extracting content ID (offset 0x30 to 0x50)
    const contentId = buffer.slice(0x30, 0x50).toString("utf-8").replace(/\0/g, "");

    // Extract only the Title ID (the part after the '-')
    const titleIdMatch = contentId.match(/-(CUSA\d+)/);
    return titleIdMatch ? titleIdMatch[1] : null; // Returns only 'CUSA01126'
}

// Process an individual package
function processPKG(folder, pkgPath) {
    console.log(`🔄 Processing: ${pkgPath}`);
    const details = extractGameDetails(pkgPath);
    //If the PKG doesn't have a TITLE_ID extracted, use the content ID?
    if (!details.TITLE_ID) {
        if (details.CONTENT_ID) {
            details.TITLE_ID = readPkgMetadata(pkgPath);
        }
    }

    if (details && details.TITLE_ID) {
        const url = `http://${HOSTNAME}:${PORT}/pkg${pkgPath.replace(BASE_DIR, "").replace(/\\/g, "/")}`;
        const coverUrl = `http://${HOSTNAME}:${PORT}/images/${details.TITLE_ID}.png`;

        extractGameImage(pkgPath, details.TITLE_ID);
        generateJSON(folder, { pkgPath: url, region: detectRegion(details.CONTENT_ID), title_id: details.TITLE_ID, title: details.TITLE || "Unknown", version: details.VERSION || "0.00", release: getFormattedDate(pkgPath), size: fs.statSync(pkgPath).size.toString(), cover_url: coverUrl });
    }
}

// Start the webserver.
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Package Server running at: http://${HOSTNAME}:${PORT}/`);
    scanPackages();
});