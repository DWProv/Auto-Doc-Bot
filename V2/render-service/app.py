"""Mermaid Render Proxy – nimmt Mermaid-Code entgegen, liefert PNG von mermaid.ink zurück."""

import base64
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Mermaid Render Proxy")


class MermaidRequest(BaseModel):
    code: str


@app.post("/render", response_class=Response)
async def render_mermaid(req: MermaidRequest):
    """Akzeptiert Mermaid-Code, kodiert ihn korrekt als Base64url und holt das PNG von mermaid.ink."""
    code = req.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Mermaid code darf nicht leer sein")

    # Base64url-Kodierung (URL-safe, kein Padding)
    b64 = base64.urlsafe_b64encode(code.encode("utf-8")).decode("ascii").rstrip("=")
    url = f"https://mermaid.ink/img/{b64}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"mermaid.ink returned {resp.status_code}: {resp.text[:200]}",
        )

    return Response(content=resp.content, media_type="image/png")


@app.post("/render-url")
async def render_mermaid_url(req: MermaidRequest):
    """Gibt nur die korrekte mermaid.ink URL zurück (ohne PNG-Download)."""
    code = req.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Mermaid code darf nicht leer sein")

    b64 = base64.urlsafe_b64encode(code.encode("utf-8")).decode("ascii").rstrip("=")
    return {"url": f"https://mermaid.ink/img/{b64}"}


@app.get("/health")
async def health():
    return {"status": "ok"}
