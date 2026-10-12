import type { Environment } from "./config";

export type CheckKind = "pass" | "block" | "warning" | "info";

export interface Check {
  id: string;
  kind: CheckKind;
  text: string;
  /** Shown bold: the PRODUCTION notice. */
  strong?: boolean;
  /** The check offers a button that fixes it. */
  fix?: "turn-on-project";
}

export interface PublishInput {
  /** The import report, when publishing straight after an import in the survey builder. */
  report?: { created: number; updated: number; rejected: number; expected: number };
  project?: { name: string; enabled: boolean };
  checkinComment: string;
  checkinSource: string;
  description: string;
  writesEnabled?: boolean;
  environment?: Environment;
  /** Whether guests can answer the tasks; left out when unknown. */
  guests?: GuestReadiness;
}

/**
 * `flagged`: every task carries liveMissingQuestions, which guest answers need. `fillMissing`: every
 * question only fills absent tags, so the flag is possible.
 */
export interface GuestReadiness {
  flagged: boolean;
  fillMissing: boolean;
}

const ENV_NAME: Record<Environment, string> = { dev: "DEV", stage: "STAGE", prod: "PROD" };

/** A URL, a www. host or a markdown link. */
const LINK = /https?:\/\/|\bwww\.|\]\(/i;
/** "2 minutes per stop", "30 sec", "5 min each". */
const TIME = /\b\d+\s*(?:-\s*\d+\s*)?(?:min(?:ute)?s?|sec(?:ond)?s?|hours?|hrs?)\b/i;

/** The checks of design pass §4, in the order shown on the sheet. */
export function publishChecks(input: PublishInput): Check[] {
  const checks: Check[] = [];
  const { report } = input;
  if (report) {
    const bad = report.rejected + report.updated + Math.max(0, report.expected - report.created - report.updated - report.rejected);
    checks.push(
      bad === 0
        ? {
            id: "import",
            kind: "pass",
            text: report.created === 1 ? "The reviewed task was created." : `All ${report.created} reviewed tasks were created.`,
          }
        : {
            id: "import",
            kind: "block",
            text:
              report.rejected > 0
                ? `${report.rejected} ${report.rejected === 1 ? "line was" : "lines were"} rejected. Fix them before publishing.`
                : `${bad} ${bad === 1 ? "line was" : "lines were"} not created as new tasks. Fix them before publishing.`,
          },
    );
  }
  if (!input.project) checks.push({ id: "project", kind: "block", text: "The campaign's project is unknown on this backend." });
  else if (input.project.enabled)
    checks.push({ id: "project", kind: "pass", text: `Project “${input.project.name}” is on.` });
  else
    checks.push({
      id: "project",
      kind: "block",
      text: `Project “${input.project.name}” is off. Turn it on, or the campaign stays hidden.`,
      fix: "turn-on-project",
    });
  checks.push(
    /#\w/.test(input.checkinComment)
      ? { id: "hashtag", kind: "pass", text: "The changeset comment has a hashtag." }
      : { id: "hashtag", kind: "warning", text: "The changeset comment has no #hashtag, so edits are hard to find later." },
  );
  const source = input.checkinSource.trim();
  checks.push(
    source.toLowerCase() === "survey"
      ? { id: "source", kind: "pass", text: "Changeset source is “survey”." }
      : {
          id: "source",
          kind: "warning",
          text: `Source is “${source}”. Street Tally answers come from looking in person, so “survey” is usual.`,
        },
  );
  checks.push(
    LINK.test(input.description) || TIME.test(input.description)
      ? {
          id: "description",
          kind: "warning",
          text: "The description has a link or a time per stop. Participants see it first; keep links in the instructions, and leave timing to the app.",
        }
      : { id: "description", kind: "pass", text: "The description has no link and no time per stop." },
  );
  const guests = guestCheck(input.guests);
  if (guests) checks.push(guests);
  const env = input.environment ? ENV_NAME[input.environment] : "this backend";
  if (input.writesEnabled === false)
    checks.push({
      id: "writes",
      kind: "info",
      text: `Task writes are off on ${env}: people can open the campaign but can't save until writes are on.`,
    });
  else if (input.writesEnabled === true)
    checks.push({
      id: "writes",
      kind: "info",
      text: "Task writes are on: answers will edit OpenStreetMap as soon as people start.",
    });
  if (input.environment === "prod")
    checks.push({
      id: "prod",
      kind: "info",
      strong: true,
      text: "This is PRODUCTION. Edits go to openstreetmap.org under each person's account.",
    });
  return checks;
}

/** Reads readiness from the tasks' choice payloads; undefined when there are none to read. */
export function guestReadiness(works: unknown[]): GuestReadiness | undefined {
  const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const choice = works.filter(obj);
  if (!choice.length) return undefined;
  const fills = (q: unknown) => obj(q) && obj(q.expect) && Object.values(q.expect).every((v) => v === null);
  return {
    flagged: choice.every((w) => w.liveMissingQuestions === true),
    fillMissing: choice.every((w) => Array.isArray(w.questions) && w.questions.every(fills)),
  };
}

/**
 * Temporary until G1 (guests everywhere, design/guests-everywhere-backend.md): then guests can answer
 * any campaign and this check goes. It refuses a campaign that could take guests but was made without
 * the flag, and only notes a signed-in-only campaign, never blocking it.
 */
function guestCheck(g: GuestReadiness | undefined): Check | undefined {
  if (!g) return undefined;
  if (g.flagged) return { id: "guests", kind: "pass", text: "Guests can answer: each task asks only for tags that are missing." };
  if (g.fillMissing)
    return {
      id: "guests",
      kind: "block",
      text: "Guests can't answer these tasks: they were made without the guest setting. Import them again from the survey builder, which turns it on.",
    };
  return {
    id: "guests",
    kind: "warning",
    text: "Signed-in only for now: these questions check values already on the map, so guests can't answer them yet. Participants need an OpenStreetMap account.",
  };
}

/** Publish is allowed when nothing blocks and every warning is ticked. */
export function canPublish(checks: Check[], ticked: ReadonlySet<string>): boolean {
  return checks.every((c) => c.kind !== "block" && (c.kind !== "warning" || ticked.has(c.id)));
}
