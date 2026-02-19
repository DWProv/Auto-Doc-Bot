# Confluence Bot V2

Automatische Erstellung von Confluence-Dokumentationsseiten über einen Microsoft 365 Copilot Agent mit MCP-Atlassian Integration. Mermaid-Diagramme werden serverseitig via `mmdc` gerendert und als Confluence-Attachments hochgeladen.

## Architektur

```
User (Teams / M365 Copilot)
    → Copilot Agent (Microsoft Copilot Studio)
    → ngrok Tunnel (Port 8080)
    → nginx Reverse Proxy
        /atlassian/mcp → mcp-atlassian:8000 (Confluence CRUD)
        /mermaid/mcp   → mcp-mermaid:3000   (Diagram Rendering + Upload)
    → Confluence Cloud REST API
```

## Funktionsweise

1. Der Benutzer beschreibt einen Prozess oder Workflow im Copilot Chat
2. Der Copilot Agent extrahiert Titel, Zusammenfassung, Schritte und Links
3. Die Seite wird im Confluence Wiki Markup erstellt (`confluence_create_page`)
4. Ein Mermaid-Flowchart wird serverseitig via `mmdc` gerendert und als Attachment hochgeladen (`render_and_upload_mermaid`)
5. Die Seite wird mit Labels versehen (`confluence_add_labels`)
6. Der Agent gibt den direkten Link zur neuen Seite zurück

## Voraussetzungen

- Docker Desktop
- ngrok (Free Tier reicht)
- Microsoft 365 Copilot Studio Zugang
- Atlassian API Token (https://id.atlassian.com/manage-profile/security/api-tokens)

## Setup

### 1. Environment konfigurieren

`.env` Datei mit Confluence-Zugangsdaten:

```env
CONFLUENCE_URL=https://your-domain.atlassian.net/wiki
CONFLUENCE_USERNAME=your-email@example.com
CONFLUENCE_API_TOKEN=your-api-token
```

### 2. Docker Stack starten

```bash
cd "C:\Users\p152\Desktop\Atlassian MCP\V2"
docker compose up -d
```

Prüfen ob alle Services laufen:

```bash
docker compose ps
# nginx-proxy-v2, mcp-atlassian-v2 (healthy), mcp-mermaid-v2
```

### 3. ngrok Tunnel starten

```bash
ngrok http 8080
```

Die angezeigte HTTPS-URL notieren (z.B. `https://abc123.ngrok-free.app`).

### 4. Copilot Studio konfigurieren

1. Neuen Agent in Microsoft Copilot Studio erstellen
2. Zwei MCP-Server als Tool-Provider hinzufügen:
   - Atlassian: `https://<ngrok-url>/atlassian/mcp`
   - Mermaid: `https://<ngrok-url>/mermaid/mcp`
3. Inhalt von `system_prompt.md` als Agent Instructions einfügen
4. Agent veröffentlichen und testen

## Projektstruktur

```
V2/
├── docker-compose.yml         ← Docker Stack (3 Services)
├── .env                       ← Confluence Credentials
├── mcp-server/
│   └── Dockerfile             ← Python 3.12 + mcp-atlassian (streamable-http)
├── mcp-mermaid/
│   ├── Dockerfile             ← Node 20 + Chromium + mmdc
│   ├── server.js              ← MCP-Server mit render_and_upload_mermaid Tool
│   ├── package.json           ← Dependencies
│   └── puppeteer-config.json  ← Chromium --no-sandbox Config
├── nginx/
│   └── nginx.conf             ← Reverse Proxy (Pfad-Routing)
├── system_prompt.md           ← Copilot Agent Instructions
├── layout_template.md         ← Confluence Wiki Markup Template (Referenz)
├── Confluence Bot Plan.pdf    ← Ursprüngliches Konzeptdokument
├── SESSION_HISTORY.md         ← Entwicklungsprotokoll
└── README.md                  ← Diese Datei
```

## Confluence-Konfiguration

| Parameter | Wert |
|-----------|------|
| Space Key | `~63d79cdadb4f715c971eece3` (Personal Space) |
| Parent Page ID | `1703477254` (Ordner "N8N") |
| Representation | `wiki` (nicht `storage`) |

## MCP-Tools

### mcp-atlassian (Port 8000)
Stellt alle Confluence-Tools bereit: `confluence_create_page`, `confluence_update_page`, `confluence_add_labels`, `confluence_upload_attachment`, etc.

### mcp-mermaid (Port 3000)
Ein Tool: `render_and_upload_mermaid`
- **Input:** `code` (Mermaid-Syntax), `page_id` (Confluence Page ID)
- **Ablauf:** Rendert via mmdc → Lädt PNG als Confluence Attachment hoch
- **Output:** Dateiname zum Einbetten mit `!dateiname.png!`

## Bekannte Einschränkungen

- **ngrok Free Tier:** URL ändert sich bei jedem Neustart. Muss in Copilot Studio aktualisiert werden.
- **Copilot Safety Filter:** Kann gelegentlich MCP Tool Calls als Prompt Injection blockieren.

## Technische Details

### MCP Transport
Beide MCP-Server nutzen `streamable-http`. nginx routet nach Pfad (`/atlassian/mcp`, `/mermaid/mcp`) zu den internen Services.

### Wiki Markup
Confluence Wiki Markup Syntax (nicht Markdown):
- Überschriften: `h1.` `h2.`
- Nummerierte Liste: `# Schritt`
- Aufzählung: `* Punkt`
- Info-Panel: `{info:title=Titel}Text{info}`
- Attachment-Bild: `!dateiname.png!`
