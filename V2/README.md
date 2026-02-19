# Confluence Bot V2

Automatische Erstellung von Confluence-Dokumentationsseiten über einen Microsoft 365 Copilot Agent mit MCP-Atlassian Integration.

## Architektur

```
User (Teams / M365 Copilot)
    → Copilot Agent (Microsoft Copilot Studio)
    → ngrok Tunnel
    → MCP-Atlassian Server (Docker, Streamable HTTP)
    → Confluence Cloud REST API
```

## Funktionsweise

1. Der Benutzer beschreibt einen Prozess oder Workflow im Copilot Chat
2. Der Copilot Agent extrahiert Titel, Zusammenfassung, Schritte und Links
3. Ein Mermaid-Flowchart wird generiert und als Bild-URL eingebettet
4. Die Seite wird im Confluence Wiki Markup formatiert (Info-Panel, nummerierte Listen, etc.)
5. Über MCP-Tools wird die Seite in Confluence erstellt und mit Labels versehen
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

Prüfen ob der MCP-Server läuft:

```bash
docker compose ps
# mcp-atlassian-v2 sollte "healthy" sein
```

### 3. ngrok Tunnel starten

```bash
ngrok http 8000
```

Die angezeigte HTTPS-URL notieren (z.B. `https://abc123.ngrok-free.app`).

### 4. Copilot Studio konfigurieren

1. Neuen Agent in Microsoft Copilot Studio erstellen
2. MCP-Server als Tool-Provider hinzufügen:
   - URL: `https://<ngrok-url>/mcp`
   - Transport: Streamable HTTP
3. Inhalt von `system_prompt.md` als Agent Instructions einfügen
4. Agent veröffentlichen und testen

## Projektstruktur

```
V2/
├── docker-compose.yml         ← Docker Stack (1 Service: MCP-Server)
├── .env                       ← Confluence Credentials
├── mcp-server/
│   └── Dockerfile             ← Python 3.12 + mcp-atlassian (streamable-http)
├── system_prompt.md           ← Copilot Agent Instructions
├── layout_template.md         ← Confluence Wiki Markup Template (Referenz)
├── render-service/            ← Mermaid Render Proxy (inaktiv)
│   ├── app.py
│   ├── Dockerfile
│   └── requirements.txt
├── nginx/                     ← Reverse Proxy (inaktiv)
│   └── nginx.conf
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

## Bekannte Einschränkungen

- **Mermaid-Diagramme:** LLMs können Base64 nicht zuverlässig berechnen. Knotennamen im Diagramm können verstümmelt sein. Fix: Mermaid Confluence App installieren und Code-Blöcke statt Bild-URLs verwenden.
- **ngrok Free Tier:** URL ändert sich bei jedem Neustart. Muss in Copilot Studio aktualisiert werden.
- **Copilot Safety Filter:** Kann gelegentlich MCP Tool Calls als Prompt Injection blockieren.

## Technische Details

### MCP Transport
Der MCP-Server nutzt `streamable-http` statt `sse`. Copilot Studio sendet POST-Requests an `/mcp`, was mit dem SSE-Transport (GET-only) nicht kompatibel war.

### Wiki Markup
Confluence Wiki Markup Syntax (nicht Markdown):
- Überschriften: `h1.` `h2.`
- Nummerierte Liste: `# Schritt`
- Aufzählung: `* Punkt`
- Info-Panel: `{info:title=Titel}Text{info}`
- Bilder: `!URL!`
