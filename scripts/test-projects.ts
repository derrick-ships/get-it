/**
 * Verifies the Projects data layer against a temp DATA_DIR: project CRUD,
 * doc membership, project-KG storage round-trip, build guard on an empty
 * project, and delete-clears-membership. No LLM is needed — buildProjectKG's
 * "no documents" guard fires before any model call.
 *
 *   npx tsx scripts/test-projects.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

async function main() {
  // Point the whole storage layer at a throwaway dir BEFORE importing it.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "getit-data-"));
  process.env.GETIT_DATA_DIR = dataDir;

  const projects = await import("../lib/projects");
  const store = await import("../lib/store");
  const projectsKg = await import("../lib/projects-kg");
  const kg = await import("../lib/kg");

  // Seed two docs.
  function makeDoc(id: string, filename: string) {
    store.saveDoc({
      id,
      filename,
      uploadedAt: Date.now(),
      numPages: 1,
      pdfUrl: `/api/pdf/${id}`,
      extracted: {
        numPages: 1,
        pages: [
          {
            pageIndex: 0,
            width: 600,
            height: 800,
            text: `text of ${filename}`,
            items: [],
          },
        ],
      },
    });
  }
  makeDoc("doc-a", "alpha.pdf");
  makeDoc("doc-b", "beta.pdf");

  // ── CRUD ──────────────────────────────────────────────────────────────
  const p = projects.createProject({ name: "  Organic Chem  ", emoji: "🧪 extra" });
  check("createProject trims name", p.name === "Organic Chem");
  check("createProject keeps a single emoji", p.emoji === "🧪");
  check("listProjects includes it", projects.listProjects().some((x) => x.id === p.id));

  const renamed = projects.updateProject(p.id, { name: "Chemistry", emoji: "⚗️" });
  check("updateProject renames", renamed?.name === "Chemistry" && renamed?.emoji === "⚗️");

  const empty = projects.createProject({});
  check("createProject defaults name", empty.name === "Untitled project");
  check("createProject defaults emoji", empty.emoji === "📚");

  // ── Membership ──────────────────────────────────────────────────────────
  store.setDocProject("doc-a", p.id);
  store.setDocProject("doc-b", p.id);
  check("getDoc reflects projectId", store.getDoc("doc-a")?.projectId === p.id);
  check("projectDocs lists members", projectsKg.projectDocs(p.id).map((d) => d.id).sort().join(",") === "doc-a,doc-b");

  store.setDocProject("doc-b", null);
  check("unfiling a doc removes it from the project", projectsKg.projectDocs(p.id).map((d) => d.id).join(",") === "doc-a");

  // Membership survives a fresh read from disk (no in-memory cache help):
  const reloaded = JSON.parse(
    fs.readFileSync(path.join(dataDir, "docs", "doc-a", "meta.json"), "utf-8"),
  ) as { projectId?: string };
  check("projectId persisted to meta.json", reloaded.projectId === p.id);

  // ── Project KG storage round-trip ────────────────────────────────────────
  const sample = { ...kg.emptyKG(p.id), status: "ready" as const, nodes: [], edges: [], globalNote: "hi" };
  projectsKg.saveProjectKG(sample);
  check("project KG saved under projects/<id>/kg.json", fs.existsSync(path.join(dataDir, "projects", p.id, "kg.json")));
  check("loadProjectKG round-trips", projectsKg.loadProjectKG(p.id)?.globalNote === "hi");

  // ── Build guard on an empty project (no LLM call) ────────────────────────
  let threw = "";
  try {
    await projectsKg.buildProjectKG(empty.id);
  } catch (e) {
    threw = (e as Error).message;
  }
  check("buildProjectKG refuses an empty project", /no documents/i.test(threw));

  // ── Delete clears membership + removes the folder ────────────────────────
  const ok = projects.deleteProject(p.id);
  check("deleteProject returns true", ok === true);
  check("deleted project is gone", projects.getProject(p.id) === null);
  check("member doc is unfiled after delete", store.getDoc("doc-a")?.projectId === null);
  check("project KG folder removed", !fs.existsSync(path.join(dataDir, "projects", p.id)));

  fs.rmSync(dataDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll projects data-layer checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
