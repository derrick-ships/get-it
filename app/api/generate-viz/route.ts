/**
 * POST /api/generate-viz
 *
 *   {
 *     type: VizType,
 *     label: string,
 *     context: string,
 *     docTitle?: string,
 *     // Optional: present when this call is a retry triggered by the
 *     // visualizer crashing the previous spec. The model is asked to fix
 *     // the issue rather than start from scratch.
 *     previousAttempt?: {
 *       spec: VizSpec,
 *       runtimeError: string,
 *     },
 *   }
 *
 * Returns: VizSpec (object matching the type's schema).
 *
 * Reasoning is set to "low" to keep latency tight; bumped to "medium" when
 * we're handing back a broken spec to repair, since the diagnostic step
 * benefits from a bit more thought. Web search is enabled only for the
 * "2d-text" type, where citations need to be grounded.
 */

import { NextResponse } from "next/server";
import { runJson } from "@/lib/codex";
import { vizSchemaFor, type VizSpec, type VizType, VIZ_TYPES } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 180;

const LANGUAGE_RULE = `LANGUAGE
The "context" field comes verbatim from the source PDF and reveals its
language. EVERY user-visible string you emit (title, caption, body
markdown, formula explanations, citation labels, axis labels, and any
text drawn inside a canvas / 3D scene via fillText) MUST be in the same
language as the source. Match it exactly — Italian PDF → Italian outputs,
English PDF → English outputs, Spanish PDF → Spanish outputs. Code
identifiers and JS comments stay in English.`;

const PROMPTS: Record<VizType, (ctx: { label: string; context: string; docTitle?: string }) => string> = {
  "3d": ({ label, context, docTitle }) => `You are Braynr Visualizer's 3D scene generator.

CONCEPT: ${label}
FIELD: ${docTitle ?? "general"}
CONTEXT: ${context}

${LANGUAGE_RULE}

Produce a JSON object matching the schema. The "setup_code" field MUST be
a JavaScript function BODY (do NOT wrap it in 'function setup() { ... }')
that the framework invokes as
   new Function("api", body)({ THREE, scene, camera, renderer, controls, group });

The body MUST do all of the following:
  - position the camera somewhere sensible (e.g. camera.position.set(0, 1.6, 4))
  - set scene.background = new THREE.Color('#fafafa')  (the app uses a
    light theme; the renderer canvas sits on a white card)
  - add an ambient light + a directional light suitable for the light theme
  - build meshes that ACCURATELY represent the concept and add them to
    'group' (the framework auto-rotates the group). Be creative and
    domain-aware: a heart needs distinct atria + ventricles + great
    vessels; methane needs the central carbon + 4 hydrogens at
    tetrahedral angles (109.5°); benzene needs a planar hexagonal carbon
    ring with hydrogens; a cell needs nucleus + visible organelles.
  - return an object with an optional update(t) callback for animation.

CONSTRAINTS:
  - Use ONLY 'THREE' (already imported) and standard math globals (Math, etc).
  - DO NOT use external loaders, textures, image URLs, or asset files.
  - DO NOT touch 'document', 'window', 'fetch', 'import', 'require', 'eval'.
  - DO NOT use OrbitControls — the framework already auto-rotates the
    group and reacts to pointer drag/scroll. Ignore the 'controls' arg.
  - Keep the total scene under ~80 primitives. AIM FOR setup_code UNDER
    4000 CHARACTERS — running long risks truncation mid-expression.
  - All meshes MUST be added to 'group' (not 'scene') so the framework can
    orbit them.
  - Use plain string concatenation ('foo ' + x) NOT template literals
    (\`foo \${x}\`) — backticks tend to get mangled in JSON encoding.
  - Material colors should read clearly against #fafafa (avoid pure white
    surfaces; prefer mid-tone fills with subtle MeshStandardMaterial).
  - Every '(' must close with ')', every '{' with '}', every '[' with ']'.
    The body must end with the closing brace of its outermost function.

Reply with the JSON object only.`,

  "2d-anim": ({ label, context, docTitle }) => `You are Braynr Visualizer's 2D Canvas animation generator.

CONCEPT: ${label}
FIELD: ${docTitle ?? "general"}
CONTEXT: ${context}

${LANGUAGE_RULE}

Produce a JSON object matching the schema. The "setup_code" field MUST be
a JavaScript function BODY invoked as
   new Function("api", body)({ ctx, width, height });
The body MUST return an object { draw(ctx, width, height, time, dt) }.

The draw callback runs every frame. Build an INFORMATIVE animation:
  - inclined plane: slope, block sliding with correct g·sin(θ) acceleration
  - pendulum: bob swinging with correct period 2π√(L/g)
  - projectile: parabolic trajectory traced over time
  - spring oscillation: mass on spring with amplitude decay
  - blood flow: vessel cross-section with cells flowing
  - chemical reaction: reactant molecules colliding and forming products
  - water cycle, etc.

Always paint a clean light background ('#fafafa') as the FIRST step of draw
so previous frames are erased. Use legible ink colors against that
background — pick from this palette:
  ink     #1a1a1d   (text, primary outlines)
  rose    #e11d48   (warning / accent A)
  amber   #d97706   (warning / accent B)
  emerald #059669   (positive / motion)
  violet  #7c3aed   (highlight)
  sky     #0284c7   (cool secondary)
Add labelled axes / annotations with ctx.fillText so the meaning is
self-evident.

CONSTRAINTS:
  - DO NOT touch document, window, fetch, import, require, eval.
  - DO NOT load images.
  - Use only 'ctx' (CanvasRenderingContext2D) plus Math globals.
  - Restart the animation cleanly when 'time' resets to 0.
  - Use plain string concatenation ('foo ' + x) NOT template literals
    (\`foo \${x}\`) — backticks tend to get mangled in JSON encoding.
  - AIM FOR setup_code UNDER 4000 CHARACTERS — running long risks
    truncation mid-expression. Prefer a tight, focused animation over
    one with many details.
  - Every '(' must close with ')', every '{' with '}', every '[' with ']'.
    The body must end with the closing brace of its outermost function.

Reply with the JSON object only.`,

  formula: ({ label, context, docTitle }) => `You are Braynr Visualizer's formula generator.

CONCEPT: ${label}
FIELD: ${docTitle ?? "general"}
CONTEXT: ${context}

${LANGUAGE_RULE}

Produce a JSON object matching the schema:
  - main_latex: the headline equation (no $ delimiters; KaTeX-compatible).
  - steps: 2 to 6 derivation/explanation steps, each with one LaTeX line
    plus a one-sentence explanation. Walk the reader from definition to
    result.
Avoid \\begin{align} environments unless necessary; prefer simple lines.

Reply with the JSON object only.`,

  graph: ({ label, context, docTitle }) => `You are Braynr Visualizer's graph generator.

CONCEPT: ${label}
FIELD: ${docTitle ?? "general"}
CONTEXT: ${context}

${LANGUAGE_RULE}

Produce a JSON object matching the schema. The "data_json" field MUST be a
STRING containing JSON (it will be JSON.parse'd on the client). Pick a
chart_type and fill data_json accordingly:

  chart_type="function": data_json = '{"fn":"<expr in x>","x_min":-5,"x_max":5,"samples":200}'
       The expression must be valid JS using x and Math.* (e.g. "Math.sin(x)*x").
  chart_type="points":   data_json = '{"points":[[x,y], ...]}'
  chart_type="bars":     data_json = '{"bars":[{"label":"A","value":1.0}, ...]}'
  chart_type="lines":    data_json = '{"series":[{"name":"foo","color":"#5b66f1","points":[[x,y],...]}]}'

Pick sensible domain & sampling. Make the chart visually communicate the
concept (e.g. range R = v0² sin(2α)/g plotted as α sweeps 0 to 90; or the
bell curve; or a parabola). Use color hex strings; the chart engine
renders on a white background.

Reply with the JSON object only.`,

  "2d-text": ({ label, context, docTitle }) => `You are Braynr Visualizer's text-source generator.

CONCEPT: ${label}
FIELD: ${docTitle ?? "general"}
CONTEXT: ${context}

${LANGUAGE_RULE}

Produce a JSON object matching the schema. The viewer expects an
authoritative card: a title, a short caption, a body in markdown that
quotes or summarises the cited source, and a list of 1–4 citations with
stable URLs (Wikipedia, official government sites, arxiv, etc).

If you have web search available, use it to confirm the citation text and
URL; otherwise produce the best high-confidence quote you know. Prefer
direct quotation in italics for legal articles. Add bracketed source
labels in the text like [1], [2] linking to the citations array order.

Reply with the JSON object only.`,
};

function repairPreamble(prevSpec: VizSpec, runtimeError: string): string {
  // Only types whose spec carries executable code benefit from sending the
  // previous body back; for other types the model can just regenerate.
  const codeField =
    prevSpec.type === "3d" || prevSpec.type === "2d-anim"
      ? prevSpec.setup_code
      : null;
  const looksTruncated =
    !!codeField &&
    (codeField.length > 7500 ||
      /Unexpected end of input|missing \) after|Unexpected token/i.test(runtimeError));
  return `THIS IS A REPAIR ATTEMPT.

The previous response you produced was rendered by the client and CRASHED
with this runtime error:

  ${runtimeError}

${codeField ? `The previous setup_code body was (${codeField.length} chars):\n\n--- BEGIN PREV CODE ---\n${codeField}\n--- END PREV CODE ---\n\n` : ""}${looksTruncated ? `THIS LOOKS LIKE A TRUNCATION. The previous code likely ran out of
output budget mid-expression. Trade richness for completeness:

  - aim for under 4000 characters of setup_code
  - cut the number of meshes / draw calls (10–30 primitives is plenty)
  - avoid long inline arrays of numbers
  - every '(' must be matched with ')', every '{' with '}', every '['
    with ']'; the BODY must end cleanly with the closing brace of the
    function expression

` : ""}Diagnose the cause (most common: truncation, mismatched parens, invalid
JS token from template-literal mishaps, undefined identifiers, missing
return, calling browser APIs that were forbidden, accessing
controls.target when controls is a stub) and produce a corrected JSON
object that compiles and runs end-to-end. Keep the same intent and style
as before; do not rewrite from scratch unless the original direction is
fundamentally broken.

`;
}

/** Fast syntax check via the Function constructor — same parser the
 *  client will use, so an OK here means the client will accept it.
 *  Returns the SyntaxError message if the code is broken, else null. */
function syntaxCheck(code: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function("api", code);
    return null;
  } catch (e) {
    return (e as Error).message || "syntax error";
  }
}

function specCodeOrNull(spec: VizSpec): string | null {
  if (spec.type === "3d" || spec.type === "2d-anim") return spec.setup_code;
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    type?: VizType;
    label?: string;
    context?: string;
    docTitle?: string;
    previousAttempt?: { spec: VizSpec; runtimeError: string };
  };
  if (!body.type || !VIZ_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  if (!body.label || !body.context) {
    return NextResponse.json({ error: "label and context required" }, { status: 400 });
  }

  const schema = vizSchemaFor(body.type);
  const basePrompt = PROMPTS[body.type]({
    label: body.label,
    context: body.context,
    docTitle: body.docTitle,
  });
  const initialPrompt = body.previousAttempt
    ? repairPreamble(body.previousAttempt.spec, body.previousAttempt.runtimeError) + basePrompt
    : basePrompt;

  // Repairs benefit from a bit more thought. Web search is reserved for
  // text/source mode where citations need grounding.
  const reasoning = body.previousAttempt ? "medium" : "low";
  const webSearch = body.type === "2d-text";

  let { data } = await runJson<VizSpec>(initialPrompt, schema, { reasoning, webSearch });

  // Server-side syntax pre-flight for code-emitting types. If the model
  // returned syntactically broken JS (typically truncated mid-expression),
  // do ONE silent repair here so the user never sees that round-trip.
  const code = specCodeOrNull(data);
  if (code) {
    const err = syntaxCheck(code);
    if (err) {
      console.warn(
        `[generate-viz] ${body.type} "${body.label}" — server-side syntax check failed (${err}); auto-repairing once`,
      );
      const repairPrompt = repairPreamble(data, err) + basePrompt;
      try {
        const { data: fixed } = await runJson<VizSpec>(repairPrompt, schema, {
          reasoning: "medium",
          webSearch: false,
        });
        const fixedCode = specCodeOrNull(fixed);
        // Only swap if the repair actually compiles; otherwise let the
        // client see the original — its own retry budget will kick in.
        if (fixedCode && !syntaxCheck(fixedCode)) {
          data = fixed;
        } else {
          console.warn(
            `[generate-viz] ${body.type} "${body.label}" — server-side repair did not compile either; deferring to client retry`,
          );
        }
      } catch (e) {
        console.warn(
          `[generate-viz] ${body.type} "${body.label}" — server-side repair threw: ${(e as Error).message}`,
        );
      }
    }
  }

  return NextResponse.json(data);
}
