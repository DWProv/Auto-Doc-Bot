import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// ── Confluence config from env ──────────────────────────────────────────────
const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const CONFLUENCE_USERNAME = process.env.CONFLUENCE_USERNAME;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;
const SPACE_KEY = process.env.CONFLUENCE_SPACE_KEY || "~63d79cdadb4f715c971eece3";
const PARENT_ID = process.env.CONFLUENCE_PARENT_ID || "1703477254";

function confluenceAuth() {
  return "Basic " + Buffer.from(`${CONFLUENCE_USERNAME}:${CONFLUENCE_API_TOKEN}`).toString("base64");
}

// ── Helper: Render mermaid code to SVG or PNG buffer ───────────────────────
// For SVG: prepend %%{init}%% directive so Mermaid itself controls the background.
// This is more reliable than post-processing or the -b/-t CLI flags,
// because the directive is evaluated by the Mermaid renderer directly.
async function renderMermaid(code, format = "svg") {
  const workDir = await mkdtemp(join(tmpdir(), "mermaid-"));
  const inputPath = join(workDir, "diagram.mmd");
  const outputPath = join(workDir, `diagram.${format}`);

  // Prepend init directive for SVG: fully dark theme.
  // Note: transparent backgrounds don't work in Confluence <img> tags (renders as white).
  // An explicit dark background (#1e1e2e) gives a consistent look in both light and dark mode.
  const BG = "#1e1e2e";
  const initDirective = format === "svg"
    ? `%%{init: {'theme': 'dark', 'themeVariables': {'background': '${BG}', 'mainBkg': '#313244', 'nodeBorder': '#89b4fa', 'clusterBkg': '#45475a', 'titleColor': '#cdd6f4', 'edgeLabelBackground': '${BG}', 'lineColor': '#89b4fa', 'textColor': '#cdd6f4', 'sectionBkgColor': '#313244', 'altSectionBkgColor': '#45475a', 'gridColor': '#585b70', 'taskBkgColor': '#89b4fa', 'taskBorderColor': '#b4befe', 'taskTextColor': '#1e1e2e', 'activeTaskBkgColor': '#b4befe', 'doneTaskBkgColor': '#585b70'}}}%%\n`
    : "";

  await writeFile(inputPath, initDirective + code, "utf-8");

  await execFileAsync("mmdc", [
    "-i", inputPath,
    "-o", outputPath,
    "-b", BG,
    "--width", "1200",
    "--puppeteerConfigFile", "/app/puppeteer-config.json",
  ], { timeout: 30_000 });

  const buffer = await readFile(outputPath);
  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});
  return buffer;
}

// ── Helper: MIME type from filename ────────────────────────────────────────
function mimeForFilename(filename) {
  return filename.endsWith(".svg") ? "image/svg+xml" : "image/png";
}

// ── Helper: Upload attachment to Confluence ─────────────────────────────────
async function uploadAttachment(pageId, pngBuffer, filename) {
  const boundary = `----boundary-${randomUUID()}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeForFilename(filename)}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, "utf-8"),
    pngBuffer,
    Buffer.from(footer, "utf-8"),
  ]);

  const res = await fetch(
    `${CONFLUENCE_URL}/rest/api/content/${pageId}/child/attachment`,
    {
      method: "PUT",
      headers: {
        Authorization: confluenceAuth(),
        "X-Atlassian-Token": "nocheck",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Attachment upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data?.results?.[0]?.title || data?.title || filename;
}

// ── Helper: Parse semicolon-separated string into array ─────────────────────
function parseList(str) {
  if (!str || str.trim() === "") return [];
  return str.split(";").map((s) => s.trim()).filter(Boolean);
}

// ── Helper: Parse steps — supports optional [Phase] grouping ────────────────
// Input:  "[Vorbereitung] Schritt A; Schritt B; [Durchfuehrung] Schritt C"
// Output: [{ label: "Vorbereitung", steps: ["Schritt A", "Schritt B"] },
//          { label: "Durchfuehrung", steps: ["Schritt C"] }]
// Without markers: [{ label: null, steps: ["Schritt A", "Schritt B", ...] }]
function parseGroupedSteps(str) {
  if (!str || str.trim() === "") return [];
  const groups = [];
  let current = { label: null, steps: [] };

  for (const item of str.split(";").map((s) => s.trim()).filter(Boolean)) {
    const phaseMatch = item.match(/^\[(.+?)\]\s*(.*)/);
    if (phaseMatch) {
      if (current.steps.length > 0 || current.label !== null) groups.push(current);
      const firstStep = phaseMatch[2].trim();
      current = { label: phaseMatch[1].trim(), steps: firstStep ? [firstStep] : [] };
    } else {
      current.steps.push(item);
    }
  }

  if (current.steps.length > 0 || current.label !== null) groups.push(current);
  return groups;
}

// ── Helper: Build wiki markup from structured data ──────────────────────────
function buildWikiMarkup({ title, summary, prerequisites, stepGroups, diagramFilename }) {
  const lines = [];

  lines.push(`h1. ${title}`);
  lines.push("");
  lines.push(`{info:title=Zusammenfassung}${summary}{info}`);
  lines.push("");

  if (prerequisites.length > 0) {
    lines.push("h2. Voraussetzungen");
    lines.push("");
    for (const p of prerequisites) {
      lines.push(`* ${p}`);
    }
    lines.push("");
  }

  const allSteps = stepGroups.flatMap((g) => g.steps);
  const hasPhases = stepGroups.some((g) => g.label !== null);

  if (allSteps.length > 0) {
    lines.push("h2. Prozessschritte");
    lines.push("");

    if (hasPhases) {
      for (const group of stepGroups) {
        if (group.label) {
          lines.push(`{panel:title=${group.label}|borderStyle=solid|borderColor=#0052CC|titleBGColor=#0052CC}`);
        }
        for (const s of group.steps) {
          lines.push(`# ${s}`);
        }
        if (group.label) {
          lines.push("{panel}");
        }
        lines.push("");
      }
    } else {
      for (const s of allSteps) {
        lines.push(`# ${s}`);
      }
      lines.push("");
    }
  }

  if (diagramFilename) {
    lines.push("{expand:title=Ablaufdiagramm}");
    lines.push(`!${diagramFilename}|width=800!`);
    lines.push("{expand}");
    lines.push("");
  }

  lines.push("----");
  lines.push("_Erstellt mit dem Auto-Doc-Bot_");

  return lines.join("\n");
}

// ── MCP Server Factory ──────────────────────────────────────────────────────
function createServer() {
  const server = new McpServer({
    name: "auto-doc-bot",
    version: "2.0.0",
  });

  server.tool(
    "create_confluence_doc",
    "Creates a Confluence documentation page. Takes a title, summary, steps, and optional diagram code. Returns the page URL.",
    {
      title: z.string().describe("Page title"),
      summary: z.string().describe("Short summary of the process"),
      prerequisites: z.string().describe("Prerequisites separated by semicolons, or empty string if none"),
      steps: z.string().describe("Process steps separated by semicolons. Optionally prefix a phase with [Phase Name] e.g. '[Preparation] Step A; Step B; [Execution] Step C'"),
      mermaid_code: z.string().describe("Mermaid flowchart TD code for the diagram, or empty string if none"),
      labels: z.string().describe("Labels separated by semicolons"),
    },
    async ({ title, summary, prerequisites, steps, mermaid_code, labels }) => {
      const errors = [];
      const stepGroups = parseGroupedSteps(steps);
      const prereqList = parseList(prerequisites);
      const labelList = parseList(labels);

      // 1. Render mermaid diagram — SVG preferred (vector, no pixelation), PNG as fallback
      let diagramFilename = null;
      let fileBuffer = null;

      if (mermaid_code && mermaid_code.trim() !== "") {
        // LLM sends literal "\n" (two chars) instead of real newlines — fix before rendering
        // Also sanitize chars that break mermaid syntax as fallback
        const cleanedCode = mermaid_code
          .replace(/\\n/g, "\n")
          .replace(/@/g, "(at)")
          .replace(/&/g, " und ");

        for (const fmt of ["svg", "png"]) {
          try {
            fileBuffer = await renderMermaid(cleanedCode, fmt);
            diagramFilename = `diagram-${randomUUID().slice(0, 8)}.${fmt}`;
            break;
          } catch (err) {
            errors.push(`Diagram ${fmt.toUpperCase()}: ${err.message}`);
          }
        }
      }

      // 2. Build wiki markup
      const body = buildWikiMarkup({
        title,
        summary,
        prerequisites: prereqList,
        stepGroups,
        diagramFilename,
      });

      // 3. Create Confluence page
      let pageId;
      let pageUrl;

      try {
        const createPage = async (pageTitle, pageBody) => {
          return fetch(`${CONFLUENCE_URL}/rest/api/content`, {
            method: "POST",
            headers: {
              Authorization: confluenceAuth(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "page",
              title: pageTitle,
              space: { key: SPACE_KEY },
              ancestors: [{ id: PARENT_ID }],
              body: { wiki: { value: pageBody, representation: "wiki" } },
            }),
          });
        };

        let res = await createPage(title, body);

        if (!res.ok && res.status === 400) {
          const dateTitle = `${title} - ${new Date().toISOString().slice(0, 10)}`;
          res = await createPage(dateTitle, body.replace(`h1. ${title}`, `h1. ${dateTitle}`));
        }

        if (!res.ok) {
          const text = await res.text();
          return {
            content: [{ type: "text", text: `Page creation failed (${res.status}): ${text}` }],
            isError: true,
          };
        }

        const data = await res.json();
        pageId = data.id;
        pageUrl = `${CONFLUENCE_URL}${data._links?.webui || `/spaces/${SPACE_KEY}/pages/${pageId}`}`;
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }

      // 4. Upload diagram
      if (fileBuffer && pageId) {
        try {
          await uploadAttachment(pageId, fileBuffer, diagramFilename);
        } catch (err) {
          errors.push(`Upload: ${err.message}`);
        }
      }

      // 5. Add labels
      if (labelList.length > 0 && pageId) {
        try {
          await fetch(`${CONFLUENCE_URL}/rest/api/content/${pageId}/label`, {
            method: "POST",
            headers: {
              Authorization: confluenceAuth(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(labelList.map((l) => ({ prefix: "global", name: l }))),
          });
        } catch (err) {
          errors.push(`Labels: ${err.message}`);
        }
      }

      // 6. Return result
      const parts = [`Page created: ${pageUrl}`];
      if (errors.length > 0) {
        parts.push(`Warnings: ${errors.join("; ")}`);
      }

      return {
        content: [{ type: "text", text: parts.join("\n") }],
      };
    }
  );

  return server;
}

// ── Express + Streamable HTTP Transport ─────────────────────────────────────
const app = express();

const sessions = {};

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && sessions[sessionId]) {
    await sessions[sessionId].transport.handleRequest(req, res);
  } else {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions[id] = { transport, server };
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) delete sessions[id];
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && sessions[sessionId]) {
    await sessions[sessionId].transport.handleRequest(req, res);
  } else {
    res.status(400).json({ error: "No session." });
  }
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && sessions[sessionId]) {
    await sessions[sessionId].transport.handleRequest(req, res);
  } else {
    res.status(400).json({ error: "No session." });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`auto-doc-bot listening on port ${PORT}`);
});
