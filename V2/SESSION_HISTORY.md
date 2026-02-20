# Auto-Doc-Bot – Session History

## Session 1 — 19.02.2026

### Ziel
Auto-Doc-Bot mit Microsoft 365 Copilot Agent + MCP-Atlassian Server aufsetzen.

### Was wurde gebaut

1. **Docker Stack** — MCP-Atlassian Server im Streamable HTTP Modus
   - `docker-compose.yml` mit einem Service (mcp)
   - `mcp-server/Dockerfile` — Python 3.12 + uv + mcp-atlassian
   - Transport: `streamable-http` (Port 8000)
   - TCP-basierter Healthcheck (kein HTTP GET, da Streamable HTTP nur POST akzeptiert)

2. **System Prompt** (`system_prompt.md`) — Instruktionen für den Copilot Agent
   - 6-Schritte-Workflow: Extrahieren → Mermaid → Wiki Markup → Publizieren → Labels → Antwort
   - Striktes Confluence Wiki Markup Template
   - Bekannte Fehlerquellen aus V1 dokumentiert

3. **Layout Template** (`layout_template.md`) — Wiki Markup Vorlage mit Platzhaltern

4. **Render-Service** (nicht aktiv, aber vorhanden)
   - `render-service/app.py` — FastAPI Proxy für mermaid.ink Base64-Kodierung
   - `nginx/nginx.conf` — Reverse Proxy für beide Services
   - Wurde gebaut, aber NICHT verwendet (Copilot Agent kann keine beliebigen HTTP-Calls machen)

### Aktueller Stand (funktionsfähig)

```
User (Teams / M365 Copilot)
    → Copilot Agent (Copilot Studio, System Prompt aus system_prompt.md)
    → ngrok Tunnel (https://....ngrok-free.dev)
    → MCP-Atlassian Server (Docker, Port 8000, Streamable HTTP)
    → Confluence REST API
        Space: ~63d79cdadb4f715c971eece3
        Parent "N8N": page_id 1703477254
```

**Was funktioniert:**
- Copilot Agent erkennt MCP-Tools (nach Wechsel auf Streamable HTTP + /mcp Pfad)
- Confluence-Seiten werden erstellt mit korrektem Wiki Markup
- Info-Panel, nummerierte Schritte, Aufzählungen werden korrekt formatiert
- Mermaid-Diagramm wird als mermaid.ink Bild eingebettet
- Labels werden hinzugefügt

**Was noch Probleme macht:**
- Mermaid Base64-Kodierung durch LLM fehlerhaft (Knotennamen verstümmelt: "Empafjg" statt "Empfang")
- LLMs können Base64 nicht zuverlässig berechnen — bekannte Limitation

### Gelöste Probleme (chronologisch)

| # | Problem | Ursache | Lösung |
|---|---------|---------|--------|
| 1 | Wiki Markup Formatierung falsch | System Prompt zu ungenau | Striktes Template mit exakten Regeln (`#`, `*`, `h2.`) |
| 2 | Prozessschritte ohne `#` | Bot nutzte Fließtext | "MUSS mit `# ` beginnen" im Prompt |
| 3 | Voraussetzungen ohne `*` | Bot nutzte Spiegelstriche | "MUSS mit `* ` beginnen" im Prompt |
| 4 | MCP "Connector request failed" | URL ohne `/sse` Pfad | URL mit `/sse` eingetragen (später auf `/mcp` gewechselt) |
| 5 | 405 Method Not Allowed | SSE Transport akzeptiert kein POST von Copilot Studio | Wechsel auf `--transport streamable-http` |
| 6 | MCP Container unhealthy | Healthcheck versuchte GET auf `/mcp` | TCP Socket-Check statt HTTP GET |
| 7 | Prompt Injection Detection | Bot generierte Content, dann Tool Call | Nicht vollständig gelöst, tritt sporadisch auf |
| 8 | Fake Confluence URL | Bot gab Platzhalter-Links aus | "Gib NIEMALS Platzhalter-Link aus" im Prompt |
| 9 | Bot fragte nach Bestätigung | Kein explizites "handle direkt" | "Erstelle SOFORT, frage NICHT" im Prompt |
| 10 | Base64 Endlosschleife | Render-Proxy nicht als Action registriert, Bot versuchte selbst Base64 | Zurück auf Self-Encoding (akzeptiert fehlerhafte Diagramme) |

### Nicht umgesetzte Ansätze (für Referenz)

1. **Render-Proxy via nginx** — Gebaut aber verworfen. Copilot Agent kann keine beliebigen HTTP-Calls machen, nur registrierte MCP-Tools/Actions. Dateien existieren noch in `render-service/` und `nginx/`.

2. **Mermaid als Confluence Code-Block** — `{code:language=none}...{code}` funktioniert, aber ohne Rendering. Benötigt Mermaid Confluence App für automatisches Rendering.

3. **Power Automate als Brücke** — Nicht getestet. Könnte Render-Proxy als Action registrieren.

### Offene Punkte (Session 1)

- [x] **Mermaid-Diagramm Fix:** → Gelöst in Session 2 (mmdc + MCP-Server)
- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein (ursprünglich 17.02.2026)
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart (Free Tier). Muss in Copilot Studio aktualisiert werden
- [ ] **Prompt Injection Detection:** Sporadisches Blockieren von Tool Calls durch Copilot Studio Safety Filter
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen (Azure Container Instance oder ähnlich)

---

## Session 2 — 19.02.2026

### Ziel
Mermaid-Diagramme serverseitig via `mmdc` rendern statt fehlerhafte LLM-Base64-Kodierung.

### Architektur-Evolution

Die Architektur hat sich im Laufe der Session mehrfach verändert:

**Phase 1: Zwei MCP-Server (Multi-Tool)**
```
Agent → nginx → mcp-atlassian (confluence_create_page, confluence_update_page, confluence_add_labels)
             → mcp-mermaid   (render_and_upload_mermaid)
```
→ Scheiterte an Copilot Studio Content Filter (`openAIIndirectAttack`)

**Phase 2: Ein MCP-Server, ein All-in-One Tool (Final)**
```
Agent → nginx → mcp-mermaid (create_confluence_doc) — 1 Tool macht alles
```
→ Agent sendet nur strukturierte Plaintext-Daten, Server baut Wiki Markup

### Was wurde gebaut

1. **MCP-Mermaid Server** (`mcp-mermaid/`) — All-in-One MCP-Server
   - `server.js` — Node.js MCP-Server mit `@modelcontextprotocol/sdk` (Streamable HTTP, Port 3000)
   - `Dockerfile` — Node 20 + Chromium + `@mermaid-js/mermaid-cli`
   - Factory-Pattern: Neue McpServer-Instanz pro Session (verhindert "Already connected" Fehler)
   - **Tool: `create_confluence_doc`** — Alle Parameter als einfache Strings (Semikolon-getrennt)
     - Baut Wiki Markup serverseitig (`buildWikiMarkup()`)
     - Erstellt Confluence-Seite via REST API
     - Rendert Mermaid-Diagramm via mmdc → PNG
     - Lädt PNG als Attachment hoch
     - Fügt Labels hinzu
     - Gibt Page-URL zurück

2. **nginx Reverse Proxy** (`nginx/`) — Pfad-basiertes Routing für einen ngrok-Tunnel
   - `/atlassian/mcp` → mcp-atlassian:8000 (noch vorhanden, aber nicht mehr in Copilot Studio registriert)
   - `/mermaid/mcp` → mcp-mermaid:3000 (einziger aktiver MCP-Endpoint)

3. **Docker Stack** — 3 Services (nginx, mcp-atlassian, mcp-mermaid)
   - nginx exponiert Port 8080 (→ ngrok)
   - mcp-atlassian und mcp-mermaid nur intern erreichbar

4. **System Prompt** — Minimal, strukturiert, ohne Wiki Markup
   - Agent ruft nur `create_confluence_doc` auf
   - Alle Parameter als einfache Texte mit Semikolon-Trennung
   - Beispiel-Aufruf im Prompt für bessere Tool-Nutzung
   - Anti-Halluzinations-Anweisungen (keine erfundenen Links)

### Architektur (final)

```
User (Teams / M365 Copilot)
    → Copilot Agent (Copilot Studio)
    → ngrok Tunnel (https://....ngrok-free.dev)
    → nginx (Port 8080)
        /mermaid/mcp → mcp-mermaid:3000 (create_confluence_doc)
    → Confluence REST API
        Space: ~63d79cdadb4f715c971eece3
        Parent "N8N": page_id 1703477254
```

**Nur ein MCP-Server in Copilot Studio registriert:** `https://<ngrok-url>/mermaid/mcp`

### Gelöste Probleme

| # | Problem | Ursache | Lösung |
|---|---------|---------|--------|
| 11 | Mermaid Base64 verstümmelt | LLMs können Base64 nicht berechnen | Serverseitiges Rendering via mmdc + Upload als Confluence Attachment |
| 12 | MCP "Already connected" Fehler | Einzelne McpServer-Instanz für alle Sessions | Factory-Pattern: `createServer()` pro Session |
| 13 | MCP "Parse error: Invalid JSON" | `express.json()` konsumierte Body vor Transport | `express.json()` Middleware entfernt |
| 14 | Zwei MCP-Server, ein ngrok-Tunnel | ngrok Free Tier = 1 URL | nginx Reverse Proxy mit Pfad-basiertem Routing |
| 15 | `openAIIndirectAttack` Content Filter | Wiki Markup (`h2.`, `#`, `{info:}`) in Tool-Call-Parametern wurde als Prompt Injection erkannt | Formatierung komplett serverseitig — Agent sendet nur strukturierte Plaintext-Daten |
| 16 | Tool sichtbar aber nicht aufgerufen | Komplexe Tool-Schemas (Arrays, verschachtelte Objekte) werden von Copilot Studio nicht ausgeführt | Alle Parameter als einfache Strings mit Semikolon-Trennung |
| 17 | Halluzinierte Links (SharePoint, HR) | Agent erfand URLs die nicht vom Benutzer stammen | `links`-Parameter entfernt, explizite Anti-Halluzinations-Anweisung im Prompt |
| 18 | mcp-atlassian + mcp-mermaid Konfusion | Zu viele Tools (4+), Agent nutzte keines korrekt | mcp-atlassian aus Copilot Studio entfernt, 1 All-in-One Tool |

### Verworfene Ansätze (Session 2)

1. **Multi-Tool Workflow (4 Tool Calls)** — Agent sollte: `confluence_create_page` → `render_and_upload_mermaid` → `confluence_update_page` → `confluence_add_labels`. Scheiterte am Content Filter: Wiki Markup in Tool-Parametern wurde als `openAIIndirectAttack` blockiert.

2. **Vereinfachter System Prompt (softer Ton)** — Aggressive Sprache ("MUSS", "NIEMALS") entfernt, ASCII-Umlaute statt Unicode. Content Filter blockierte trotzdem — Problem war der Wiki Markup im Tool Call, nicht der Prompt-Ton.

3. **Zwei MCP-Server in Copilot Studio** — Beide registriert, aber Agent war mit 4+ Tools überfordert und rief keines auf.

### Aktive Dateien

| Datei | Status | Beschreibung |
|-------|--------|--------------|
| `docker-compose.yml` | AKTIV | 3 Services: nginx, mcp-atlassian, mcp-mermaid |
| `mcp-server/Dockerfile` | AKTIV | mcp-atlassian (läuft noch, aber nicht in Copilot Studio registriert) |
| `mcp-mermaid/Dockerfile` | AKTIV | Node 20 + Chromium + mmdc |
| `mcp-mermaid/server.js` | AKTIV | All-in-One MCP-Server mit `create_confluence_doc` Tool |
| `mcp-mermaid/package.json` | AKTIV | Dependencies (@modelcontextprotocol/sdk, express, zod) |
| `mcp-mermaid/puppeteer-config.json` | AKTIV | Chromium --no-sandbox Config |
| `nginx/nginx.conf` | AKTIV | Pfad-Routing für beide MCP-Server |
| `.env` | AKTIV | Confluence Credentials |
| `system_prompt.md` | AKTIV | Minimaler Prompt — strukturierte Daten, Semikolon-Trennung |
| `layout_template.md` | REFERENZ | Wiki Markup Template (wird jetzt serverseitig in server.js generiert) |
| `render-service/*` | VERALTET | Alter Render-Proxy aus Session 1 |

### Startup-Anleitung

```bash
# 1. Docker Stack starten
cd "C:\Users\p152\Desktop\Atlassian MCP\V2"
docker compose up -d

# 2. ngrok Tunnel starten (Port 8080)
ngrok http 8080

# 3. In Copilot Studio EINEN MCP-Server registrieren:
#    - Mermaid: https://<ngrok-url>/mermaid/mcp
#    - System Prompt: Inhalt von system_prompt.md in Instructions einfügen
#    - KEIN Atlassian-MCP registrieren (create_confluence_doc macht alles)

# 4. Testen mit Prompt:
#    "Dokumentiere den Onboarding-Prozess für neue Mitarbeiter..."
```

### Key Learnings (Session 2)

- **Copilot Studio Content Filter (`openAIIndirectAttack`)** blockiert Tool Calls die Markup oder Instruktions-ähnlichen Text enthalten (`h2.`, `{info:}`, `# Schritt`). Lösung: Formatierung IMMER serverseitig.
- **Copilot Studio und komplexe Tool-Schemas:** Arrays und verschachtelte Objekte führen dazu, dass der Tool Call nicht ausgeführt wird. Lösung: NUR einfache Strings als Parameter, Semikolon als Trennzeichen.
- **Weniger Tools = bessere Ergebnisse:** 1 All-in-One Tool funktioniert besser als 4 spezialisierte Tools.
- **Factory-Pattern für MCP-Server:** Jede Session braucht eine eigene McpServer-Instanz (SDK-Limitation).
- **express.json() NICHT verwenden:** StreamableHTTPServerTransport liest den Body selbst.

### Offene Punkte

- [x] **End-to-End Test in Copilot Studio:** → Funktioniert (Session 3)
- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart
- [x] **README.md aktualisieren:** → Aktualisiert in Session 3
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen
- [ ] **mcp-atlassian aufräumen:** Service aus docker-compose entfernen falls dauerhaft nicht gebraucht

---

## Session 3 — 19.02.2026

### Ziel
Feinschliff, Härtung und Produktionsreife: Rückfragen bei fehlenden Infos, Dark Theme, Mermaid-Sonderzeichen-Handling, Tagging-Strategie, Rebranding zu "Auto-Doc-Bot", umfassende Dokumentation.

### Was wurde gemacht

1. **System Prompt — Rückfragen bei fehlenden Infos**
   - Agent prüft jetzt ob Titel/Thema und mindestens 3 Schritte vorhanden sind
   - Bei fehlenden Informationen fragt der Agent gezielt nach
   - Erst wenn genug Infos da sind, wird das Tool aufgerufen

2. **Mermaid Dark Theme**
   - mmdc rendert jetzt mit `-t dark -b transparent` (statt `-b white`)
   - Diagramme haben dunklen Hintergrund mit transparentem Rand

3. **Literale `\n` Fix**
   - Copilot Agent sendet Mermaid-Code mit literalen `\n` (zwei Zeichen) statt echten Newlines
   - `mermaid_code.replace(/\\n/g, "\n")` vor dem Rendern eingefügt

4. **Mermaid Sonderzeichen-Handling (Dual-Layer)**
   - **Prompt-Ebene:** Regeln im System Prompt — Agent soll `@`, `&`, `<`, `>`, `"`, `'` vermeiden, statt E-Mail-Adressen beschreibende Kurztexte verwenden (z.B. "E-Mail Buchhaltung")
   - **Server-Ebene:** Fallback-Sanitizer in `server.js` — `@` → `(at)`, `&` → `und`
   - **`-->` Arrow Fix:** Initiale `<>`-Ersetzung entfernt, da sie Mermaid-Pfeile (`-->`) zu `--` verstümmelte

5. **Tagging-Strategie**
   - Feste Taxonomie: genau 2 Labels pro Seite
   - Label 1 — Kategorie: `process` | `guideline` | `checklist` | `troubleshooting` | `reference`
   - Label 2 — Thema: frei wählbar, Kleinbuchstaben, kein Leerzeichen (z.B. `onboarding`, `deployment`)
   - Im System Prompt und in der README dokumentiert

6. **Standard-Eingabeaufforderung**
   - Beispiel-Prompt für den Bot erstellt, den Benutzer als Vorlage verwenden können
   - Verallgemeinerte Prozessbeschreibung als Testfall erstellt

7. **Rebranding: "Confluence Bot V2" → "Auto-Doc-Bot"**
   - Umbenannt in: `server.js` (MCP-Name, Console-Log, Footer), `README.md`, `SESSION_HISTORY.md`, `layout_template.md`
   - GitHub-Repo umbenannt: https://github.com/DWProv/Auto-Doc-Bot

8. **README.md — Komplett-Überarbeitung**
   - Detailliertes Mermaid-Flowchart mit allen Prozessschritten
   - 13-Schritte-Tabelle (Komponente, Aktion, API/Tool)
   - Fehlerbehandlungs-Tabelle
   - Label-Taxonomie-Dokumentation
   - Verallgemeinerte Setup-Anleitung (keine hardcoded Credentials)

9. **GitHub Repository**
   - Repo erstellt: https://github.com/DWProv/confluence-bot-v2 (später umbenannt zu Auto-Doc-Bot)
   - Alle Änderungen committed und gepusht
   - Repo-Rename auf GitHub durchgeführt, lokales Remote aktualisiert

### Gelöste Probleme

| # | Problem | Ursache | Lösung |
|---|---------|---------|--------|
| 19 | Mermaid Parse Error (`\n` literal) | Copilot Agent sendet `\n` als zwei Zeichen statt echten Newline | `replace(/\\n/g, "\n")` vor mmdc-Aufruf |
| 20 | ngrok auf falschem Port | `ngrok http 8000` statt 8080 | Korrektur auf `ngrok http 8080` (nginx Port) |
| 21 | Mermaid `@`-Zeichen in E-Mail | `buchhaltung@firma.de` bricht Mermaid-Parser | Dual-Layer: Prompt-Regeln (keine Sonderzeichen in Knoten) + Server-Sanitizer (`@` → `(at)`) |
| 22 | Mermaid `-->` Pfeile gebrochen | `<>`-Regex entfernte `>` aus `-->` → wurde zu `--` | `<>`-Replacement aus Sanitizer entfernt |
| 23 | README Mermaid `\n` Formatierung | GitHub rendert literale `\n` nicht als Zeilenumbruch | `\n` durch `<br>` ersetzt, Knoten in `["..."]` gewrappt |

### Verworfene Ansätze (Session 3)

1. **Agent-Icon via Puppeteer** — Versuch ein PNG-Icon im Docker-Container zu generieren. Scheiterte an Pfad-Problemen (Git Bash mangling `/app/` Pfade). Verworfen, manuell erstellen.

### Key Learnings (Session 3)

- **Mermaid Sonderzeichen:** Dual-Layer-Ansatz (Prompt + Server-Fallback) ist robuster als nur eine Ebene
- **Mermaid Pfeile:** `-->` enthält `>` — globale Zeichenersetzung kann Syntax brechen, nur spezifische Zeichen sanitieren
- **Copilot Studio Tool-Schemas:** Weiterhin nur einfache Strings, Semikolon als Trennzeichen
- **GitHub Mermaid:** `\n` in Knotentexten wird nicht gerendert, `<br>` + Quotes nötig
- **Tagging:** Feste Taxonomie (Kategorie + Thema) hält Tags konsistent und durchsuchbar

### Offene Punkte

- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen (Azure Container Instance oder ähnlich)
- [ ] **mcp-atlassian aufräumen:** Service aus docker-compose entfernen falls dauerhaft nicht gebraucht
- [ ] **Agent-Icon:** PNG-Icon für Copilot Studio Agent erstellen (max 72 KB)

---

## Session 4 — 19.02.2026

### Ziel
SVG-Diagramme, Phasen-Layout, Diagramm-Typ-Auswahl, Dark Theme.

### Was wurde gemacht

1. **SVG als primäres Diagrammformat**
   - `renderMermaid(code, format = "svg")` — SVG bevorzugt, PNG als Fallback
   - `mimeForFilename()` — dynamischer MIME-Typ (`image/svg+xml` vs `image/png`)
   - `--width 1200` — größere intrinsische SVG-Dimensionen für bessere Darstellung

2. **Dark Theme via `%%{init}%%` Direktive**
   - Confluence rendert Attachments als `<img>` → transparenter Hintergrund wird zu Weiß
   - Lösung: expliziter dunkler Hintergrund `#1e1e2e` (Catppuccin Mocha) direkt im Mermaid-Code
   - Vollständige Palette: Nodes, Linien, Text, Gantt-Sections, Grid alle dunkel
   - `%%{init}%%` wird serverseitig prepended — Agent sendet nur normalen Mermaid-Code

3. **Phasen-Layout für Prozessschritte**
   - Agent markiert Phasen mit `[Phasenname]` Prefix in `steps` Parameter
   - `parseGroupedSteps()` parst Marker und gruppiert Steps
   - `buildWikiMarkup()` rendert `{panel:title=...|borderColor=#0052CC|titleBGColor=#0052CC}` pro Phase
   - Ohne Phasenmarker: bisherige flache nummerierte Liste

4. **Diagramm-Typ Auswahl im System Prompt**
   - `flowchart TD/LR`, `sequenceDiagram`, `stateDiagram-v2`, `gantt`
   - Auswahl-Guide mit Kriterien und Mini-Beispielen
   - Gantt nur wenn User Zeitangaben nennt

5. **System Prompt — zwei Beispiel-Aufrufe**
   - Beispiel 1: kurze Prozesse ohne Phasen (flache Liste)
   - Beispiel 2: lange Prozesse mit `[Vorbereitung]`, `[Erster Tag]`, `[Abschluss]`

### Gelöste Probleme

| # | Problem | Ursache | Lösung |
|---|---------|---------|--------|
| 24 | Diagramm pixeliert beim Zoomen | PNG-Rasterformat | Wechsel auf SVG als primäres Format |
| 25 | Weißer Hintergrund trotz `-b transparent` | Confluence `<img>` compositet Transparent auf Weiß (Browser-Spezifikation) | Explizite Hintergrundfarbe `#1e1e2e` via `%%{init}%%` |
| 26 | Gantt-Chart heller Hintergrund | Mermaid Gantt-Theme: `sectionBkgColor` und `altSectionBkgColor` hell | Gantt-spezifische Theme-Variablen im `%%{init}%%` Direktive gesetzt |
| 27 | ENOENT: no such file or directory | `unlink(outputPath)` vor `readFile(outputPath)` — async Reihenfolge falsch | `const buffer = await readFile(...)` vor den `unlink`-Calls |
| 28 | Panel-Text im Dark Mode nicht lesbar | `bgColor=#DEEBFF` erzwang hellen Hintergrund, Confluence Dark Mode rendert weißen Text | `bgColor` aus Panel Macro entfernt — Confluence nutzt theme-adaptiven Default |
| 29 | Diagramm zu klein in Confluence | `width=800` in Wiki Markup ignoriert für SVG `<img>` | `--width 1200` für größere intrinsische SVG-Größe |

### Offene Punkte

- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen
- [ ] **mcp-atlassian aufräumen:** Service aus docker-compose entfernen falls dauerhaft nicht gebraucht
- [ ] **Agent-Icon:** PNG-Icon für Copilot Studio Agent erstellen (max 72 KB)

---

## Session 5 — 20.02.2026

### Ziel
Stabilitätsfixes, ausklappbares Ablaufdiagramm, Demo-Vorbereitung.

### Was wurde gemacht

1. **ngrok IPv4-Fix**
   - ngrok versuchte Verbindung über IPv6 (`[::1]:8080`) — Docker lauscht nur auf IPv4
   - Lösung: `ngrok http 127.0.0.1:8080` (explizite IPv4-Adresse statt `localhost`)

2. **Ablaufdiagramm ausklappbar**
   - `h2. Ablaufdiagramm` + Bild ersetzt durch Confluence `{expand}` Macro
   - Diagramm ist standardmäßig eingeklappt, per Klick aufklappbar
   - `server.js` `buildWikiMarkup()`: `{expand:title=Ablaufdiagramm}` + `!filename!` + `{expand}`

3. **System Prompt — CQL-Suche verworfen**
   - CQL-Suchstrategie hinzugefügt → Bot hängte (Copilot Studio Timeout bei mehreren sequentiellen Tool Calls)
   - Suchsektion komplett entfernt — Fokus bleibt auf `create_confluence_doc`

4. **Demo-Prompts erstellt**
   - Akt 1: mcp-atlassian Suche (Confluence nach Onboarding-Seiten durchsuchen)
   - Akt 2: mcp-mermaid Dokumentation (vollständiger Onboarding-Prozess mit Phasen)

### Gelöste Probleme

| # | Problem | Ursache | Lösung |
|---|---------|---------|--------|
| 30 | ngrok ERR_NGROK_8012 / Bad Gateway | ngrok löst `localhost` zu `::1` (IPv6) auf, Docker bindet nur IPv4 | `ngrok http 127.0.0.1:8080` (explizite IPv4) |
| 31 | Bot hängt nach System Prompt Erweiterung | Sequentielle Tool Calls → Copilot Studio Timeout | Suchlogik aus System Prompt entfernt |

### Key Learnings (Session 5)

- **ngrok auf Windows:** `ngrok http localhost:8080` schlägt fehl wenn Docker nur IPv4 bindet. Immer `127.0.0.1` verwenden.
- **Copilot Studio Timeouts:** Mehrere sequentielle Tool Calls können zum Hängen führen. System Prompt schlank halten.
- **Confluence `{expand}` Macro:** Funktioniert in Wiki Markup — `{expand:title=Text}Inhalt{expand}`

### Offene Punkte

- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen
- [ ] **mcp-atlassian aufräumen:** Service aus docker-compose entfernen falls dauerhaft nicht gebraucht
- [ ] **Agent-Icon:** PNG-Icon für Copilot Studio Agent erstellen (max 72 KB)
