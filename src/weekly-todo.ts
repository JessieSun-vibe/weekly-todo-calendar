import {
  type App,
  MarkdownView,
  Notice,
  Platform,
  type Plugin,
  type TFile,
  TFolder,
} from "obsidian";

import type { DayPlannerSettings } from "./settings";

declare const require: (id: string) => {
  execFile: (
    file: string,
    args: string[],
    options: { timeout: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => void;
};

type ParsedEvent = {
  date: string | undefined;
  endText: string;
  id: string;
  notes: string;
  startText: string;
  title: string;
};

type SyncResult = {
  created: number;
  deleted: number;
  skipped: number;
  updated: number;
};

const calendarIdRegExp = /\[calendar-id::\s*([A-Za-z0-9_-]+)\]/;
const currentWeekPrefix = "📍 ";
const pastFolderName = "001-Past";
const futureFolderName = "002-Future";

function createCalendarId() {
  return `wtc_${crypto.randomUUID().replaceAll("-", "")}`;
}

function ensureCalendarIds(content: string) {
  let changed = false;
  const next = content
    .split(/\r?\n/)
    .map((line) => {
      if (
        !/^\s*-\s*\[[ xX]\]\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s+/.test(
          line,
        ) ||
        calendarIdRegExp.test(line)
      ) {
        return line;
      }

      changed = true;
      return `${line} [calendar-id:: ${createCalendarId()}]`;
    })
    .join("\n");

  return { changed, content: next };
}

function parseTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    return null;
  }

  return hour * 60 + minute;
}

function parseEvents(content: string): ParsedEvent[] {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const match = line
        .trim()
        .match(
          /^-\s*\[([ xX])\]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.+)$/,
        );
      if (!match) return null;

      const start = parseTime(match[2]);
      const end = parseTime(match[3]);
      if (start === null || end === null || end <= start) return null;

      const scheduledDate =
        match[4].match(/\[scheduled::\s*(\d{4}-\d{2}-\d{2})\]/)?.[1] ||
        match[4].match(/⏳\s*(\d{4}-\d{2}-\d{2})/)?.[1];
      const id = match[4].match(calendarIdRegExp)?.[1];
      if (!id) return null;
      const textWithoutDate = match[4]
        .replace(/\s*\[scheduled::\s*\d{4}-\d{2}-\d{2}\]/g, "")
        .replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/g, "")
        .replace(/\s*\[calendar-id::\s*[A-Za-z0-9_-]+\]/g, "")
        .trim();
      const categories = [
        ...textWithoutDate.matchAll(/#([^\s#]+)/g),
      ].map((item) => item[1]);

      return {
        startText: match[2].padStart(5, "0"),
        endText: match[3].padStart(5, "0"),
        id,
        title: textWithoutDate.replace(/\s+#[^\s#]+/g, "").trim(),
        notes: categories.length ? `Categories: ${categories.join(", ")}` : "",
        date: scheduledDate,
      };
    })
    .filter((event): event is ParsedEvent => event !== null);
}

function stripCurrentWeekPrefix(value: string) {
  return value.startsWith(currentWeekPrefix)
    ? value.slice(currentWeekPrefix.length)
    : value;
}

function getWeeklyCalendarWindowState() {
  return window as typeof window & {
    __obsidianWeeklyCalendarFilePath?: string;
  };
}

function setCurrentWeekMarkers(content: string, isCurrentWeek: boolean) {
  let lines = content
    .split("\n")
    .filter((line) => !/^current-week:\s*/.test(line));
  const frontmatterEnd = lines.findIndex((line, index) => {
    return index > 0 && line.trim() === "---";
  });

  if (isCurrentWeek && frontmatterEnd > 0) {
    lines.splice(frontmatterEnd, 0, "current-week: true");
  }

  lines = lines.map((line) => {
    if (!/^#\s+/.test(line)) {
      return line;
    }

    const title = line.replace(/^#\s+/, "");
    const normalizedTitle = stripCurrentWeekPrefix(title);

    return `# ${isCurrentWeek ? currentWeekPrefix : ""}${normalizedTitle}`;
  });

  return lines.join("\n");
}

export class WeeklyTodoFeature {
  private allowSourceOnce = false;
  private isSyncing = false;
  private lastWeeklyFilePath?: string;

  constructor(
    private readonly plugin: Plugin,
    private readonly app: App,
    private readonly getSettings: () => DayPlannerSettings,
  ) {}

  load() {
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => void this.archiveWeeklyTodoFiles(), 300);
    });

    this.plugin.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || file.extension !== "md") return;
        window.setTimeout(() => void this.archiveWeeklyTodoFiles(), 20);
        window.setTimeout(() => this.routeWeeklyTodo(file), 80);
      }),
    );

    this.plugin.addCommand({
      id: "sync-current-week-to-apple-calendar",
      name: "Sync current week to Apple Calendar",
      checkCallback: (checking) => {
        const file = this.getCurrentFile();
        if (!file) return false;
        if (!checking) void this.syncFile(file);
        return true;
      },
    });

    this.plugin.addCommand({
      id: "edit-current-weekly-todo-source",
      name: "Edit current weekly Todo source",
      checkCallback: (checking) => {
        if (!this.lastWeeklyFilePath) return false;
        if (!checking) void this.openWeeklySource();
        return true;
      },
    });

    if (Platform.isDesktopApp) {
      this.plugin.addRibbonIcon(
        "calendar-sync",
        "Sync current week to Apple Calendar",
        () => {
          const file = this.getCurrentFile();
          if (!file) {
            new Notice("Open a weekly Todo calendar first.");
            return;
          }
          void this.syncFile(file);
        },
      );
    }
  }

  private getCurrentFile() {
    const markdownView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    return (
      markdownView?.file ||
      (this.lastWeeklyFilePath
        ? (this.app.vault.getAbstractFileByPath(
            this.lastWeeklyFilePath,
          ) as TFile | null)
        : null)
    );
  }

  private async routeWeeklyTodo(file: TFile) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (
      cache?.frontmatter?.type !== "weekly-todo" ||
      !this.getSettings().autoOpenWeeklyTodo
    ) {
      return;
    }

    this.lastWeeklyFilePath = file.path;
    if (this.allowSourceOnce) {
      this.allowSourceOnce = false;
      return;
    }

    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) return;

    (
      window as typeof window & {
        __obsidianWeeklyCalendarFilePath?: string;
        __obsidianWeeklyCalendarWeekStart?: string;
      }
    ).__obsidianWeeklyCalendarFilePath = file.path;

    (
      window as typeof window & {
        __obsidianWeeklyCalendarWeekStart?: string;
      }
    ).__obsidianWeeklyCalendarWeekStart = String(
      cache.frontmatter["week-start"] || "",
    );

    await leaf.setViewState({
      type: "planner-weekly",
      active: true,
    });
  }

  private async ensureFolder(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      return;
    }

    if (existing) {
      throw new Error(`${path} exists but is not a folder.`);
    }

    await this.app.vault.createFolder(path);
  }

  private getWeekRelation(frontmatter: Record<string, unknown>) {
    const weekStart = window.moment(
      String(frontmatter["week-start"] || ""),
      "YYYY-MM-DD",
      true,
    );
    const weekEnd = window.moment(
      String(frontmatter["week-end"] || ""),
      "YYYY-MM-DD",
      true,
    );
    const today = window.moment().startOf("day");

    if (!weekStart.isValid() || !weekEnd.isValid()) {
      return undefined;
    }

    if (weekEnd.isBefore(today, "day")) {
      return "past" as const;
    }

    if (weekStart.isAfter(today, "day")) {
      return "future" as const;
    }

    return "present" as const;
  }

  private getCalendarRoot(file: TFile) {
    return file.path.split("/")[0];
  }

  private async archiveWeeklyTodoFiles() {
    const weeklyFiles = this.app.vault.getMarkdownFiles().filter((file) => {
      return (
        this.app.metadataCache.getFileCache(file)?.frontmatter?.type ===
        "weekly-todo"
      );
    });

    for (const file of weeklyFiles) {
      const frontmatter =
        this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;

      const relation = this.getWeekRelation(frontmatter);
      if (!relation) continue;

      const calendarRoot = this.getCalendarRoot(file);
      const targetFolder =
        relation === "past"
          ? `${calendarRoot}/${pastFolderName}`
          : relation === "future"
            ? `${calendarRoot}/${futureFolderName}`
            : calendarRoot;
      const fileNameWithoutPin = stripCurrentWeekPrefix(file.name);
      const targetFileName =
        relation === "present"
          ? `${currentWeekPrefix}${fileNameWithoutPin}`
          : fileNameWithoutPin;
      const targetPath = `${targetFolder}/${targetFileName}`;

      if (relation !== "present") {
        await this.ensureFolder(targetFolder);
      }

      const content = await this.app.vault.read(file);
      const nextContent = setCurrentWeekMarkers(
        content,
        relation === "present",
      );
      if (nextContent !== content) {
        await this.app.vault.modify(file, nextContent);
      }

      if (file.path === targetPath) {
        if (relation === "present") {
          this.lastWeeklyFilePath = targetPath;
          getWeeklyCalendarWindowState().__obsidianWeeklyCalendarFilePath =
            targetPath;
        }
        continue;
      }

      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        console.warn(
          `Weekly Todo archive target already exists, skipping: ${targetPath}`,
        );
        continue;
      }

      await this.app.vault.rename(file, targetPath);

      if (relation === "present") {
        this.lastWeeklyFilePath = targetPath;
        getWeeklyCalendarWindowState().__obsidianWeeklyCalendarFilePath =
          targetPath;
      }
    }
  }

  private async openWeeklySource() {
    if (!this.lastWeeklyFilePath) return;
    const file = this.app.vault.getAbstractFileByPath(
      this.lastWeeklyFilePath,
    ) as TFile | null;
    if (!file) {
      new Notice("The weekly Todo source file no longer exists.");
      return;
    }

    this.allowSourceOnce = true;
    await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
  }

  private async syncFile(file: TFile) {
    if (!Platform.isDesktopApp) {
      new Notice("Apple Calendar sync is available on macOS only.");
      return;
    }

    if (this.isSyncing) {
      new Notice("Apple Calendar sync is already running.");
      return;
    }

    this.isSyncing = true;

    try {
      let content = await this.app.vault.read(file);
      const withIds = ensureCalendarIds(content);
      if (withIds.changed) {
        await this.app.vault.modify(file, withIds.content);
        content = withIds.content;
      }
    const frontmatter =
      this.app.metadataCache.getFileCache(file)?.frontmatter;
    const events = parseEvents(content);
    if (!events.length) {
      new Notice("No timed tasks found in this weekly Todo page.");
      return;
    }

    const defaultDate = String(
      frontmatter?.date ||
        frontmatter?.["week-start"] ||
        file.basename,
    ).match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!defaultDate && events.some((event) => !event.date)) {
      new Notice(
        "Add [scheduled:: YYYY-MM-DD] to each timed task before syncing.",
      );
      return;
    }

    const calendarName = this.getSettings().appleCalendarName;
    const sourcePrefix = `OBSIDIAN_WEEKLY_TODO_ID:${this.app.vault.getName()}:`;
    const previousSourcePrefix = `OBSIDIAN_WEEKLY_TODO:${this.app.vault.getName()}:${file.path}:`;
    const legacySourcePrefix = `OBSIDIAN_TIMELINE:${this.app.vault.getName()}:`;
    const latestEvents = new Map<
      string,
      ParsedEvent & { date: string; marker: string }
    >();

    for (const event of events) {
      const date = event.date || defaultDate;
      if (!date) continue;
      const marker = `${sourcePrefix}${event.id}`;
      latestEvents.set(event.id, {
        ...event,
        date,
        marker,
      });
    }

    const eventsToSync = [...latestEvents.values()];
    new Notice(`Comparing ${eventsToSync.length} events with “${calendarName}”…`);

      const result = await this.syncCalendarEvents(
        calendarName,
        sourcePrefix,
        previousSourcePrefix,
        legacySourcePrefix,
        String(frontmatter?.["week-start"] || defaultDate || ""),
        String(frontmatter?.["week-end"] || defaultDate || ""),
        eventsToSync,
      );
      new Notice(
        `Apple Calendar: created ${result.created}, updated ${result.updated}, deleted ${result.deleted}, skipped ${result.skipped}.`,
        8000,
      );
    } catch (error) {
      console.error(error);
      new Notice(
        `Apple Calendar sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        8000,
      );
    } finally {
      this.isSyncing = false;
    }
  }

  private syncCalendarEvents(
    calendarName: string,
    sourcePrefix: string,
    previousSourcePrefix: string,
    legacySourcePrefix: string,
    weekStart: string,
    weekEnd: string,
    events: Array<ParsedEvent & { date: string; marker: string }>,
  ) {
    const { execFile } = require("child_process");
    const script = `
function run(argv) {
  const calendarName = argv[0];
  const sourcePrefix = argv[1];
  const previousSourcePrefix = argv[2];
  const legacySourcePrefix = argv[3];
  const weekStart = new Date(argv[4] + "T00:00:00");
  const weekEnd = new Date(argv[5] + "T23:59:59");
  const desiredEvents = JSON.parse(argv[6]);
  const Calendar = Application("Calendar");
  const targetCalendar = Calendar.calendars().find(
    (calendar) => calendar.name() === calendarName
  );
  if (!targetCalendar) {
    throw new Error("Calendar not found: " + calendarName);
  }
  const desiredById = {};
  desiredEvents.forEach((event) => desiredById[event.id] = event);
  const existingById = {};
  const duplicates = [];
  let deleted = 0;

  targetCalendar.events().forEach((item) => {
    const value = item.description() || "";
    const eventStart = item.startDate();
    if (
      (value.indexOf(previousSourcePrefix) === 0 ||
        value.indexOf(legacySourcePrefix) === 0) &&
      eventStart >= weekStart &&
      eventStart <= weekEnd
    ) {
      Calendar.delete(item);
      deleted += 1;
      return;
    }
    if (
      value.indexOf(sourcePrefix) !== 0 ||
      eventStart < weekStart ||
      eventStart > weekEnd
    ) return;
    const marker = value.split("\\n")[0];
    const id = marker.slice(sourcePrefix.length);
    if (existingById[id]) {
      duplicates.push(item);
    } else {
      existingById[id] = item;
    }
  });

  duplicates.forEach((item) => {
    Calendar.delete(item);
    deleted += 1;
  });

  Object.keys(existingById).forEach((id) => {
    if (!desiredById[id]) {
      Calendar.delete(existingById[id]);
      delete existingById[id];
      deleted += 1;
    }
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  desiredEvents.forEach((event) => {
    const startDate = new Date(event.date + "T" + event.startText + ":00");
    const endDate = new Date(event.date + "T" + event.endText + ":00");
    const description = event.marker + "\\n" + (event.notes || "");
    const existing = existingById[event.id];

    if (!existing) {
      const createdEvent = Calendar.Event({
        summary: event.title,
        startDate,
        endDate,
        description,
      });
      targetCalendar.events.push(createdEvent);
      created += 1;
      return;
    }

    const unchanged =
      existing.summary() === event.title &&
      existing.startDate().getTime() === startDate.getTime() &&
      existing.endDate().getTime() === endDate.getTime() &&
      (existing.description() || "") === description;

    if (unchanged) {
      skipped += 1;
      return;
    }

    existing.summary = event.title;
    existing.startDate = startDate;
    existing.endDate = endDate;
    existing.description = description;
    updated += 1;
  });

  return JSON.stringify({ created, updated, deleted, skipped });
}`;

    return new Promise<SyncResult>((resolve, reject) => {
      execFile(
        "/usr/bin/osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          script,
          calendarName,
          sourcePrefix,
          previousSourcePrefix,
          legacySourcePrefix,
          weekStart,
          weekEnd,
          JSON.stringify(events),
        ],
        { timeout: 30000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message).trim()));
          } else {
            try {
              resolve(JSON.parse(_stdout.trim()) as SyncResult);
            } catch (parseError) {
              reject(
                new Error("Apple Calendar returned an invalid sync result", {
                  cause: parseError,
                }),
              );
            }
          }
        },
      );
    });
  }
}
