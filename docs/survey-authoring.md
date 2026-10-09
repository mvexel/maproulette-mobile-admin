# Authoring Android survey challenges

The Survey builder creates native multiple-choice campaigns using the existing choice-task contract. It adds no backend endpoint or SDK schema. Admins author once; generated tasks contain a snapshot of that definition.

## Create a campaign

1. Open **Survey builder** and choose **Restaurant example**, **Bus stop example**, or **Open survey file**.
2. Set a unique challenge title, description, instructions, and OSM changeset comment/source. Instructions and help are plain text.
3. Edit questions and answers. Keep question/answer IDs stable and give every answer an explicit OSM tag effect. The preview shows both volunteer text and tag effects.
4. Open a feature file or edit the FeatureCollection. Supply representative Point locations, typed OSM IDs, and the features' current OSM tags. Replace the fictional example feature IDs before creating a challenge.
5. Review generated and omitted features, then **Export survey file**. Keep this portable file as the authoring source. **Save browser draft** is a convenience copy scoped to the connected backend; it is not a server backup.
6. Enter the **Project ID on this backend**, choosing an existing enabled project you can manage. **Create new challenge** creates a disabled challenge there. The editor freezes its definition for this import. Duplicate challenge names are rejected by the backend. Project IDs are deliberately excluded from portable survey files because they differ between environments. The builder cannot inspect the project's enabled state through the current admin read allowlist; verify that state in your project administration.
7. **Import reviewed tasks** sends the generated GeoJSON lines to the existing import endpoint. Review the created/updated/rejected counts. Accepted lines remain even if other lines were rejected.
8. **Publish for Android** is available only when every expected task was created, with zero updates or rejections. It enables the challenge and adds `mobile-survey-v1`. Refresh challenge selection in the Android app connected to the same backend.

Challenge publication does not change the backend's OSM Write Policy. Stage and Production are independent MapRoulette databases but can both target live OSM. Publish/enable writes only under the operator's release process.

## Authoring file

`survey.json` contains version 1, challenge metadata, identity tags (`match`), shared questions/options, and feature input. It carries no credentials or backend challenge IDs and can be reopened on another machine. Importing it creates a new challenge rather than editing an existing one.

See [restaurant survey](../examples/restaurant-survey.json), [bus stop survey](../examples/bus-stop-survey.json), and their [generated restaurant tasks](../examples/restaurant-tasks.geojsonl) / [bus stop tasks](../examples/bus-stop-tasks.geojsonl). All example features are fictional; generated examples are for local contract testing.

Question guards use `expect`: `{"takeaway": null}` means offer the question only while `takeaway` is absent. Exact string values are also supported. A question may guard 1–4 tags, and all must match. Different questions cannot guard the same tag; identity tags cannot overlap guarded tags.

Each option sets/removes only its question's guarded tags. A no-op answer is invalid. Use **I can't tell** in the volunteer interface instead of inventing an answer with no tag change; it omits that question from submission.

An identity match such as `{"amenity":"restaurant"}` checks all specified tags. Features with different identity tags are omitted. Questions whose expected tags do not match the source feature are omitted; features with no remaining questions are omitted. For absent-tag-only tasks, the generator uses existing `liveMissingQuestions` behavior so the backend can filter questions again against live OSM when a volunteer opens the task.

Validation limits match the existing choice contract: 1–8 questions, 2–12 options each, stable lowercase IDs of up to 32 characters, question text up to 200 characters, question help up to 500, answer labels up to 60, answer help up to 300, and a 16 KiB UTF-8 choice payload. Feature input is limited to 10,000 features and file uploads to 10 MiB.

## Feature input

Use a GeoJSON FeatureCollection containing one feature per OSM element:

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": {"type": "Point", "coordinates": [-111.891, 40.7608]},
    "properties": {"@id": "way/123", "amenity": "restaurant", "name": "Example restaurant"}
  }]
}
```

`@id` must be `node/ID`, `way/ID`, or `relation/ID`. Other properties are OSM tag strings. For an area/way/relation, supply a representative Point where the volunteer can find it. Raw polygons/lines are not accepted by this initial builder. Coordinates are longitude then latitude, in geographic bounds. Duplicate element IDs are rejected.

The generator places `cooperativeWork` at each collection's top level and keeps `@id` as the task name/identity. The backend remains authoritative for live feature eligibility and tag edits.

## Restaurant example

| Question | OSM key | Options |
| --- | --- | --- |
| Outdoor seating | `outdoor_seating` | `yes`, `no` |
| Food to take away | `takeaway` | `yes`, `no` |
| Delivery | `delivery` | `yes`, `no` |
| Customer toilets | `toilets` | `yes`, `no` |

Check signs/menus or ask staff for service questions. Absence of a sign is not evidence for No. The volunteer can always choose **I can't tell**. Partial submissions close the complete task; the confirmation explains this.

## Revisions and interrupted setup

Editing an authoring file changes future generated tasks. The builder never selects an existing challenge as its import target. Publish a new uniquely named challenge for a changed survey. Keep the definition file, generated task file, backend origin, and created challenge ID together for recovery.

Create/import/publish are not retried automatically after uncertain responses. A failed request can hide an accepted operation. Check the challenge, its tasks, and admin audit before using the existing Challenges screen for any reviewed manual recovery. Browser navigation/reload discards the active setup session, so keep the challenge ID and exported files.

## Command-line generation

Node 24 is sufficient; the command uses the same generator as the editor:

```sh
npm run generate-survey -- examples/restaurant-survey.json /tmp/restaurant-tasks.geojsonl
```

The output path must not exist. Validation failures leave it unwritten. Omitted feature reasons are printed to stderr. This command generates files only; it does not import tasks or contact OSM.

## Validation coverage

Vitest covers portable round trips, deterministic golden output, guard filtering, duplicate IDs, guarded edits, no-ops, malformed input, geographic bounds, and UTF-8 size limits. Playwright uses mock OAuth and intercepted stock API requests for disabled creation → import → publication, draft/export, uncertain-import handling, and a mobile layout check. These tests do not demonstrate a deployed server import or live OSM edit.
