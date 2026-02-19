FROM python:3.12-slim

# uv installieren
RUN pip install --no-cache-dir uv

# mcp-atlassian als uv-tool installieren (wird im Docker-Layer gecacht)
RUN uv tool install mcp-atlassian

# uv tool bin-Pfad zum PATH hinzufügen
ENV PATH="/root/.local/bin:$PATH"

EXPOSE 8000

# MCP-Server im Streamable HTTP-Modus starten (kompatibel mit Copilot Studio)
CMD ["mcp-atlassian", "--transport", "streamable-http", "--port", "8000", "--host", "0.0.0.0"]
