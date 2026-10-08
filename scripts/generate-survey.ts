import { readFileSync, writeFileSync } from "node:fs";
import { generateTasks, parseSurvey } from "../src/survey.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stderr.write("Usage: npm run generate-survey -- survey.json tasks.geojsonl\n");
  process.exitCode = 1;
} else {
  try {
    const generated = generateTasks(parseSurvey(JSON.parse(readFileSync(input, "utf8"))));
    if (!generated.count) throw new Error("No applicable tasks. Check the feature tags and survey guards.");
    writeFileSync(output, generated.text, { flag: "wx" });
    process.stderr.write(`Generated ${generated.count} tasks; omitted ${generated.skipped.length} features.\n`);
    for (const reason of generated.skipped) process.stderr.write(`${reason}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : "Generation failed"}\n`);
    process.exitCode = 1;
  }
}
