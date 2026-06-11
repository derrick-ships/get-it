/**
 * App version + about-page constants.
 *
 * The version is baked at build time from `package.json#version` into
 * the public env var NEXT_PUBLIC_APP_VERSION (see next.config.ts).
 * In dev / local installs the package.json version stays "0.0.0", so
 * the chip and welcome popup both render "v0.0.0" — only a CI build
 * triggered by a pushed git tag rewrites package.json to the real
 * release number ahead of `next build`.
 */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export const GITHUB_OWNER = "derrick-ships";
export const GITHUB_REPO = "get-it";
export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;

export const FEEDBACK_EMAIL = "derrick@theagencylatam.com";

export const DISCORD_URL = "https://discord.gg/DpQPswRhsK";

export const TEAM = [
  {
    name: "Mattia Beltrami",
    affiliation: "Politecnico di Milano",
    linkedin: "https://www.linkedin.com/in/mattia-beltrami/",
  },
  {
    name: "Matteo Impieri",
    affiliation: "Politecnico di Milano",
    linkedin: "https://www.linkedin.com/in/matteo-impieri-5b5874331/",
  },
  {
    name: "Filippo Difronzo",
    affiliation: "Politecnico di Milano",
    linkedin: "https://www.linkedin.com/in/filippo-difronzo-3a56701b1/",
  },
  {
    name: "Luca Feggi",
    affiliation: "Università di Padova",
    linkedin: "https://www.linkedin.com/in/luca-feggi-a643133b5/",
  },
] as const;
