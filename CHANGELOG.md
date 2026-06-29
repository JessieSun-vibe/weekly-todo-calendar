# Changelog

## 1.2.0

- Add an editable weekly focus plan below the weekly calendar.
- Support weekly focus add, edit, check off, delete, right-click delete, collapse/expand, horizontal/vertical layout, and drag-and-drop sorting.
- Persist weekly focus changes back to the `## 本周重点` Markdown section.
- Automatically route past weekly files to `001-Past`, future weekly files to `002-Future`, and keep the current week at the calendar folder root.
- Update weekly focus styling to follow Obsidian light and dark themes.

## 1.1.1

- Publish the full source tree so Obsidian Community automated review can inspect the plugin source.
- Keep the 1.1.0 weekly Todo calendar and Apple Calendar sync behavior.

## 1.1.0

- Add stable hidden calendar IDs to weekly Todo events.
- Perform true incremental Apple Calendar synchronization.
- Create, update, delete, or skip events based on their stable ID and content.
- Delete only events owned by Weekly Todo Calendar.
- Limit deletion to plugin-owned events inside the selected week.
- Prevent overlapping sync runs when the sync command is clicked repeatedly.
- Show detailed synchronization counts.

## 1.0.7

- Keep the weekly Todo file as the only source of truth.
- Write events created in the weekly calendar directly to the weekly file with a scheduled date.
- Stop reading or creating seven separate daily notes for weekly calendar events.

## 1.0.6

- Sync timed tasks from all seven daily notes in the selected week, in addition to the weekly Todo file.
- Assign each daily-note task to the date represented by its daily note.

## 1.0.5

- Use the existing Apple Calendar named `个人` by default.
- Remove legacy Apple Calendar events written by the earlier synchronization plugin when syncing a week.
- Prevent the legacy and integrated synchronization commands from running at the same time.

## 1.0.4

- Do not append a completion date when checking off a calendar event.
- Remove completion dates that the Tasks API would otherwise add.

## 1.0.3

- Refresh the local task index immediately after deletion so the event disappears from the calendar without reopening the view.

## 1.0.2

- Fix the right-click **Delete** action so it directly removes the source Markdown task.
- Delete the selected local event with `X`, `Delete`, or `Backspace`.
- Show a success or error notice after deletion.

## 1.0.1

- Remove stale and duplicate Apple Calendar events before syncing the latest weekly schedule.
- Add a **Delete** action to the right-click menu for local calendar events.

## 1.0.0

- Added automatic weekly-note routing using `type: weekly-todo`.
- Added Monday–Sunday calendar initialization from the note's `week-start`.
- Added compact calendar titles such as `0622-0628`.
- Added one-way Apple Calendar synchronization on macOS.
- Added settings for the destination Apple Calendar and automatic weekly-note opening.
- Retained the editable timeline, task indexing, time tracking, and ICS features from Day Planner.
