# Confluence Bot V2 – Session History

## Session 1 — 19.02.2026

### Ziel
Confluence Bot V2 mit Microsoft 365 Copilot Agent + MCP-Atlassian Server aufsetzen.

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

### Offene Punkte für nächste Session

- [ ] **Mermaid-Diagramm Fix:** Entweder Mermaid Confluence App installieren (rendert Code-Blöcke) oder Render-Proxy als Copilot Studio Action registrieren
- [ ] **API Token prüfen:** Token in `.env` könnte abgelaufen sein (ursprünglich 17.02.2026)
- [ ] **ngrok URL:** Ändert sich bei jedem Neustart (Free Tier). Muss in Copilot Studio aktualisiert werden
- [ ] **Prompt Injection Detection:** Sporadisches Blockieren von Tool Calls durch Copilot Studio Safety Filter
- [ ] **Produktions-Setup:** ngrok durch feste URL ersetzen (Azure Container Instance oder ähnlich)

### Aktive Dateien (funktionsfähiger Stand)

| Datei | Status | Beschreibung |
|-------|--------|--------------|
| `docker-compose.yml` | AKTIV | Nur MCP-Server, Port 8000 |
| `mcp-server/Dockerfile` | AKTIV | streamable-http Transport |
| `.env` | AKTIV | Confluence Credentials |
| `system_prompt.md` | AKTIV | Copilot Agent Instructions |
| `layout_template.md` | REFERENZ | Wiki Markup Template |
| `render-service/*` | INAKTIV | Render-Proxy (nicht in docker-compose) |
| `nginx/*` | INAKTIV | Reverse Proxy (nicht in docker-compose) |

### Startup-Anleitung

```bash
# 1. Docker Stack starten
cd "C:\Users\p152\Desktop\Atlassian MCP\V2"
docker compose up -d

# 2. ngrok Tunnel starten
ngrok http 8000

# 3. In Copilot Studio:
#    - MCP-Server URL: https://<ngrok-url>/mcp
#    - System Prompt: Inhalt von system_prompt.md in Instructions einfügen

# 4. Testen mit Prompt:
#    "Dokumentiere den Onboarding-Prozess für neue Mitarbeiter..."
```
