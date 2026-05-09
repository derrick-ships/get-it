/**
 * JSON Schemas used as `outputSchema` for codex calls, plus matching TS types.
 * Schemas are kept in strict mode (additionalProperties:false, every property
 * required) because that's what codex enforces.
 */

export const VIZ_TYPES = ["3d", "2d-anim", "2d-text", "formula", "graph"] as const;
export type VizType = (typeof VIZ_TYPES)[number];

// ── Tag detection (per-page) ───────────────────────────────────────────

export type DetectedConcept = {
  /** Short human-readable name shown on the tag pill (≤ 40 chars). */
  label: string;
  /** Which renderer to use for this concept. */
  type: VizType;
  /** Exact substring (verbatim) from the page text where the tag should be
   *  anchored. Use the LAST 30–80 chars of the relevant sentence/term so we
   *  can locate the tail position unambiguously. */
  anchor: string;
  /** Self-contained context describing what to visualize. The viz generator
   *  receives only this, not the whole page. */
  context: string;
};

export type DetectionResult = {
  concepts: DetectedConcept[];
};

export const detectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["concepts"],
  properties: {
    concepts: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "type", "anchor", "context"],
        properties: {
          label: { type: "string", minLength: 2, maxLength: 50 },
          type: { type: "string", enum: VIZ_TYPES as unknown as string[] },
          anchor: { type: "string", minLength: 12, maxLength: 200 },
          context: { type: "string", minLength: 30, maxLength: 600 },
        },
      },
    },
  },
} as const;

// ── Visualization spec (per concept) ───────────────────────────────────

export type ThreeDSpec = {
  type: "3d";
  title: string;
  caption: string;
  /** Body of a function with signature
   *    function setup({ THREE, scene, camera, renderer, controls, group }) { ... return { update?(t) { } } }
   *  The function body must be valid JS that runs in a browser. The
   *  generator should add lights, set camera position, build meshes, and
   *  optionally return an `update(t)` callback for animation.
   */
  setup_code: string;
};

export type TwoDAnimSpec = {
  type: "2d-anim";
  title: string;
  caption: string;
  /** Body of a function with signature
   *    function setup({ ctx, width, height }) { ...; return { draw(ctx, width, height, time, dt) { ... } } }
   *  The draw callback is called every frame.
   */
  setup_code: string;
};

export type TwoDTextSpec = {
  type: "2d-text";
  title: string;
  caption: string;
  body_markdown: string;
  citations: Array<{ label: string; source: string; url: string }>;
};

export type FormulaSpec = {
  type: "formula";
  title: string;
  caption: string;
  /** Main LaTeX (no $ delimiters). */
  main_latex: string;
  /** Step-by-step derivation. */
  steps: Array<{ latex: string; explanation: string }>;
};

export type GraphSpec = {
  type: "graph";
  title: string;
  caption: string;
  /** function: plot y=f(x); points: scatter; bars: bar chart. */
  chart_type: "function" | "points" | "bars" | "lines";
  x_label: string;
  y_label: string;
  /** JSON-serialized payload — see vizSchemaFor("graph") for the allowed
   *  shapes per chart_type. Free-form data is hard to express in the strict
   *  JSON Schema codex requires, so the model emits it as a string and we
   *  JSON.parse on the client. */
  data_json: string;
};

export type VizSpec = ThreeDSpec | TwoDAnimSpec | TwoDTextSpec | FormulaSpec | GraphSpec;

// We use a *separate* per-type schema, because codex only invokes one schema
// per call and a discriminated union with conditional `required` properties is
// brittle in JSON Schema strict mode.
export function vizSchemaFor(type: VizType): object {
  switch (type) {
    case "3d":
      return {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "caption", "setup_code"],
        properties: {
          type: { type: "string", const: "3d" },
          title: { type: "string", minLength: 2, maxLength: 80 },
          caption: { type: "string", minLength: 5, maxLength: 280 },
          // Generous cap: complex anatomy / molecule scenes can run long.
          // Keeping room here means the model never gets cut off
          // mid-expression (which used to manifest as "Unexpected end of
          // input" / "missing ) after argument list" SyntaxErrors).
          setup_code: { type: "string", minLength: 30, maxLength: 16000 },
        },
      };
    case "2d-anim":
      return {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "caption", "setup_code"],
        properties: {
          type: { type: "string", const: "2d-anim" },
          title: { type: "string", minLength: 2, maxLength: 80 },
          caption: { type: "string", minLength: 5, maxLength: 280 },
          setup_code: { type: "string", minLength: 30, maxLength: 16000 },
        },
      };
    case "2d-text":
      return {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "caption", "body_markdown", "citations"],
        properties: {
          type: { type: "string", const: "2d-text" },
          title: { type: "string", minLength: 2, maxLength: 100 },
          caption: { type: "string", minLength: 5, maxLength: 280 },
          body_markdown: { type: "string", minLength: 30, maxLength: 4000 },
          citations: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "source", "url"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 120 },
                source: { type: "string", minLength: 1, maxLength: 200 },
                url: { type: "string", maxLength: 500 },
              },
            },
          },
        },
      };
    case "formula":
      return {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "caption", "main_latex", "steps"],
        properties: {
          type: { type: "string", const: "formula" },
          title: { type: "string", minLength: 2, maxLength: 80 },
          caption: { type: "string", minLength: 5, maxLength: 280 },
          main_latex: { type: "string", minLength: 1, maxLength: 600 },
          steps: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["latex", "explanation"],
              properties: {
                latex: { type: "string", minLength: 1, maxLength: 400 },
                explanation: { type: "string", minLength: 1, maxLength: 400 },
              },
            },
          },
        },
      };
    case "graph":
      return {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "caption", "chart_type", "x_label", "y_label", "data_json"],
        properties: {
          type: { type: "string", const: "graph" },
          title: { type: "string", minLength: 2, maxLength: 80 },
          caption: { type: "string", minLength: 5, maxLength: 280 },
          chart_type: { type: "string", enum: ["function", "points", "bars", "lines"] },
          x_label: { type: "string", maxLength: 60 },
          y_label: { type: "string", maxLength: 60 },
          data_json: { type: "string", minLength: 2, maxLength: 6000 },
        },
      };
  }
}
