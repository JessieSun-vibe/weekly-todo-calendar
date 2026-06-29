<script lang="ts">
  import { type Moment } from "moment";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { slide } from "svelte/transition";

  import { getDateRangeContext } from "../../../context/date-range-context";
  import { getObsidianContext } from "../../../context/obsidian-context";
  import { isToday } from "../../../global-store/current-time";
  import { getVisibleHours } from "../../../global-store/derived-settings";
  import type { WeeklyFocusItem } from "../../../types";
  import { isOnWeekend } from "../../../util/moment";
  import {
    getNextAdjacentRange,
    getNextWorkWeek,
    getPreviousAdjacentRange,
    getPreviousWorkWeek,
  } from "../../../util/range";
  import * as r from "../../../util/range";
  import { createResizeState } from "../../actions/create-resize-state";
  import { createColumnChangeMenu } from "../../column-change-menu";
  import { createColumnSelectionMenu } from "../../column-selection-menu";
  import ControlButton from "../control-button.svelte";
  import { createSlide } from "../defaults";
  import ErrorBoundary from "../error-boundary.svelte";
  import {
    Settings,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CalendarArrowUp,
    Columns3,
    GripHorizontal,
    LayoutGrid,
    List,
    Plus,
    TableColumnsSplit,
    Trash2,
  } from "../lucide";
  import Ruler from "../ruler.svelte";
  import Scroller from "../scroller.svelte";
  import SettingsControls from "../settings-controls.svelte";
  import Timeline from "../timeline.svelte";

  import ColumnTracksOverlay from "./column-tracks-overlay.svelte";
  import MultiDayRow from "./multi-day-row.svelte";

  const {
    workspaceFacade,
    settings,
    pointerDateTime,
    editContext,
    settingsSignal,
    getWeeklyFocusItems,
    updateWeeklyFocusItem,
    toggleWeeklyFocusItem,
    addWeeklyFocusItem,
    deleteWeeklyFocusItem,
    reorderWeeklyFocusItems,
  } = getObsidianContext();
  const dateRange = getDateRangeContext();

  type SideControls = "none" | "settings";

  let visibleSideControls = $state<SideControls>("none");
  let weeklyFocusItems = $state<WeeklyFocusItem[]>([]);
  let isWeeklyFocusCollapsed = $state(false);
  let draggedWeeklyFocusLineNumber = $state<number | undefined>();
  let dragOverWeeklyFocusLineNumber = $state<number | undefined>();
  let weeklyFocusContextMenu = $state<
    | {
        item: WeeklyFocusItem;
        x: number;
        y: number;
      }
    | undefined
  >();
  const completedWeeklyFocusTasks = $derived(
    weeklyFocusItems.filter((task) => ["x", "X"].includes(task.status)).length,
  );
  const weeklyFocusProgress = $derived(
    weeklyFocusItems.length === 0
      ? 0
      : (completedWeeklyFocusTasks / weeklyFocusItems.length) * 100,
  );
  let timelineInternalColumnCount = $derived.by(() => {
    const columnFlags = Object.values(settingsSignal.current.timelineColumns);

    return columnFlags.filter(Boolean).length;
  });

  function toggleSideControls(toggledControls: SideControls) {
    visibleSideControls =
      visibleSideControls === toggledControls ? "none" : toggledControls;
  }

  function toggleWeeklyFocusLayout() {
    $settings = {
      ...$settings,
      weeklyFocusLayout:
        $settings.weeklyFocusLayout === "vertical" ? "horizontal" : "vertical",
    };
  }

  async function refreshWeeklyFocusItems() {
    weeklyFocusItems = await getWeeklyFocusItems();
  }

  async function handleWeeklyFocusTextBlur(
    item: WeeklyFocusItem,
    event: Event,
  ) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || input.value === item.text) {
      return;
    }

    await updateWeeklyFocusItem(item.lineNumber, input.value);
    await refreshWeeklyFocusItems();
  }

  async function handleWeeklyFocusCheckboxChange(item: WeeklyFocusItem) {
    await toggleWeeklyFocusItem(item.lineNumber);
    await refreshWeeklyFocusItems();
  }

  async function handleAddWeeklyFocusItem() {
    await addWeeklyFocusItem();
    await refreshWeeklyFocusItems();
  }

  async function handleDeleteWeeklyFocusItem(item: WeeklyFocusItem) {
    weeklyFocusContextMenu = undefined;
    await deleteWeeklyFocusItem(item.lineNumber);
    await refreshWeeklyFocusItems();
  }

  function toggleWeeklyFocusCollapsed() {
    isWeeklyFocusCollapsed = !isWeeklyFocusCollapsed;
    weeklyFocusContextMenu = undefined;
  }

  function reorderWeeklyFocusItemsLocally(
    items: WeeklyFocusItem[],
    draggedLineNumber: number,
    targetLineNumber: number,
  ) {
    const nextItems = [...items];
    const fromIndex = nextItems.findIndex(
      (item) => item.lineNumber === draggedLineNumber,
    );
    const toIndex = nextItems.findIndex(
      (item) => item.lineNumber === targetLineNumber,
    );

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return items;
    }

    const [draggedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, draggedItem);

    return nextItems;
  }

  function handleWeeklyFocusDragStart(
    item: WeeklyFocusItem,
    event: DragEvent,
  ) {
    draggedWeeklyFocusLineNumber = item.lineNumber;
    weeklyFocusContextMenu = undefined;
    event.dataTransfer?.setData("text/plain", String(item.lineNumber));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleWeeklyFocusDragOver(item: WeeklyFocusItem, event: DragEvent) {
    event.preventDefault();
    dragOverWeeklyFocusLineNumber = item.lineNumber;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  async function handleWeeklyFocusDrop(
    item: WeeklyFocusItem,
    event: DragEvent,
  ) {
    event.preventDefault();
    const draggedLineNumber =
      draggedWeeklyFocusLineNumber ??
      Number(event.dataTransfer?.getData("text/plain"));

    draggedWeeklyFocusLineNumber = undefined;
    dragOverWeeklyFocusLineNumber = undefined;

    if (!Number.isFinite(draggedLineNumber)) {
      return;
    }

    const nextItems = reorderWeeklyFocusItemsLocally(
      weeklyFocusItems,
      draggedLineNumber,
      item.lineNumber,
    );

    if (nextItems === weeklyFocusItems) {
      return;
    }

    weeklyFocusItems = nextItems;
    await reorderWeeklyFocusItems(nextItems.map((focusItem) => focusItem.lineNumber));
    await refreshWeeklyFocusItems();
  }

  function handleWeeklyFocusDragEnd() {
    draggedWeeklyFocusLineNumber = undefined;
    dragOverWeeklyFocusLineNumber = undefined;
  }

  function handleWeeklyFocusContextMenu(
    item: WeeklyFocusItem,
    event: MouseEvent,
  ) {
    event.preventDefault();
    weeklyFocusContextMenu = {
      item,
      x: event.clientX,
      y: event.clientY,
    };
  }

  onMount(() => {
    void refreshWeeklyFocusItems();
  });

  function getColumnBackgroundColor(day: Moment) {
    return isOnWeekend(day) ? "var(--background-primary)" : "";
  }

  let daysRef: HTMLDivElement | undefined;
  let multiDayRowRef: HTMLDivElement | undefined = $state();
  let columnTrackOverlayEl: HTMLDivElement | undefined = $state();
  let rulerRef: HTMLDivElement | undefined = $state();

  function handleScroll(event: Event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (daysRef) {
      daysRef.scrollLeft = event.target.scrollLeft;
    }

    if (multiDayRowRef) {
      multiDayRowRef.scrollLeft = event.target.scrollLeft;
    }

    if (columnTrackOverlayEl) {
      columnTrackOverlayEl.scrollLeft = event.target.scrollLeft;
    }

    if (rulerRef) {
      rulerRef.scrollTop = event.target.scrollTop;
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (!multiDayRowRef) {
      return;
    }

    const currentDateRange = get(dateRange);

    const viewportToElOffsetX = multiDayRowRef.getBoundingClientRect().left;
    const containerWidth = multiDayRowRef.scrollWidth;
    const totalDays = currentDateRange.length;
    const pixelsPerDay = containerWidth / totalDays;

    const indexOfDayHoveredOver = Math.floor(
      (event.clientX - viewportToElOffsetX + multiDayRowRef.scrollLeft) /
        pixelsPerDay,
    );

    pointerDateTime.set({
      dateTime: currentDateRange[indexOfDayHoveredOver],
      type: "date",
    });
  }

  const { startResizing, resizeAction } = createResizeState();
</script>

<div class="corner">
  {#if $settings.showUncheduledTasks}
    <GripHorizontal
      class="horizontal-grip"
      onmousedown={startResizing}
      ontouchstart={startResizing}
    />
  {/if}
</div>

<div bind:this={rulerRef} class="ruler">
  <Ruler
    --ruler-box-shadow="var(--shadow-right)"
    visibleHours={getVisibleHours($settings)}
  />
  <div class="scrollbar-filler"></div>
</div>

<div
  bind:this={daysRef}
  style:--timeline-internal-column-count={timelineInternalColumnCount}
  class={["planner-header-row", "day-buttons"]}
>
  {#each $dateRange as day}
    <div class="header-cell">
      <ControlButton
        --border-radius="0"
        label="Open note for day"
        onclick={async () => await workspaceFacade.openFileForDay(day)}
      >
        {#if $isToday(day)}
          🔵
        {/if}

        {day.format($settings.timelineDateFormat)}
      </ControlButton>
    </div>
  {/each}
</div>

{#if $settings.showUncheduledTasks}
  <div
    style:--timeline-internal-column-count={timelineInternalColumnCount}
    class={["planner-header-row", "horizontal-resize-box-wrapper"]}
    use:resizeAction
  >
    <!--Note: we need this wrapper to listen to pointer events on the whole height of the row-->
    <div
      bind:this={multiDayRowRef}
      class="multi-day-row-wrapper"
      onpointermove={handlePointerMove}
      onpointerup={editContext.confirmEdit}
    >
      <MultiDayRow />
    </div>
    <ColumnTracksOverlay
      columnCount={$dateRange.length}
      bind:el={columnTrackOverlayEl}
    />
  </div>
{/if}

{#if visibleSideControls !== "none"}
  <div
    class="side-controls-wrapper"
    transition:slide={createSlide({ axis: "x" })}
  >
    {#if visibleSideControls === "settings"}
      <SettingsControls />
    {/if}
  </div>
{/if}

<svelte:window
  onclick={() => {
    if (weeklyFocusContextMenu) {
      weeklyFocusContextMenu = undefined;
    }
  }}
  onkeydown={(event) => {
    if (event.key === "Escape") {
      weeklyFocusContextMenu = undefined;
    }
  }}
/>

<ErrorBoundary>
  <div class="multi-day-main-content">
    <Scroller class="planner-multi-day-scroller" onscroll={handleScroll}>
      {#each $dateRange as day}
        <Timeline
          --column-background-color={getColumnBackgroundColor(day)}
          {day}
          isUnderCursor={true}
        />
      {/each}
    </Scroller>

    <div class="controls-sidebar">
      <ControlButton
        isActive={visibleSideControls === "settings"}
        onclick={() => toggleSideControls("settings")}
      >
        <Settings />
      </ControlButton>

      <ControlButton
        label="Change columns"
        onclick={(event) => createColumnChangeMenu({ event, settings })}
      >
        <Columns3 />
      </ControlButton>

      <ControlButton
        label="Configure columns"
        onclick={(event) => createColumnSelectionMenu({ event, settings })}
      >
        <TableColumnsSplit />
      </ControlButton>

      <ControlButton
        label="Show current period"
        onclick={() => {
          dateRange.set(
            r.createRange($settings.multiDayRange, $settings.firstDayOfWeek),
          );
        }}
      >
        <CalendarArrowUp />
      </ControlButton>

      <ControlButton
        label="Show next period"
        onclick={() => {
          dateRange.update(
            $settings.multiDayRange === "work-week"
              ? ([firstDay]) => getNextWorkWeek(firstDay)
              : getNextAdjacentRange,
          );
        }}
      >
        <ChevronRight />
      </ControlButton>

      <ControlButton
        label="Show previous period"
        onclick={() => {
          dateRange.update(
            $settings.multiDayRange === "work-week"
              ? ([firstDay]) => getPreviousWorkWeek(firstDay)
              : getPreviousAdjacentRange,
          );
        }}
      >
        <ChevronLeft />
      </ControlButton>
    </div>
  </div>
</ErrorBoundary>

{#if $settings.showUncheduledTasks}
  <section
    class={["weekly-focus-panel", isWeeklyFocusCollapsed && "is-collapsed"]}
  >
    <header class="weekly-focus-header">
      <button
        class="weekly-focus-title-button"
        type="button"
        aria-expanded={!isWeeklyFocusCollapsed}
        onclick={toggleWeeklyFocusCollapsed}
      >
        {#if isWeeklyFocusCollapsed}
          <ChevronRight class="planner-settings-icon" />
        {:else}
          <ChevronDown class="planner-settings-icon" />
        {/if}
        <span class="weekly-focus-title">每周重点计划</span>
      </button>
      <div class="weekly-focus-actions">
        <div class="weekly-focus-progress" aria-hidden="true">
          <div
            class="weekly-focus-progress-value"
            style:width={`${weeklyFocusProgress}%`}
          ></div>
        </div>
        <ControlButton
          --border-radius="0"
          label="新增每周重点"
          onclick={handleAddWeeklyFocusItem}
        >
          <Plus class="planner-settings-icon" />
        </ControlButton>
        <ControlButton
          --border-radius="0"
          isActive={$settings.weeklyFocusLayout === "vertical"}
          label={$settings.weeklyFocusLayout === "vertical"
            ? "切换为横向平铺"
            : "切换为纵向列表"}
          onclick={toggleWeeklyFocusLayout}
        >
          {#if $settings.weeklyFocusLayout === "vertical"}
            <LayoutGrid class="planner-settings-icon" />
          {:else}
            <List class="planner-settings-icon" />
          {/if}
        </ControlButton>
      </div>
    </header>

    {#if !isWeeklyFocusCollapsed}
      <div
        class={[
          "weekly-focus-task-container",
          $settings.weeklyFocusLayout === "vertical" && "is-vertical-list",
        ]}
        transition:slide={createSlide({ axis: "y" })}
      >
        {#each weeklyFocusItems as item (item.lineNumber)}
          <div
            class={[
              "weekly-focus-card",
              draggedWeeklyFocusLineNumber === item.lineNumber && "is-dragging",
              dragOverWeeklyFocusLineNumber === item.lineNumber &&
                draggedWeeklyFocusLineNumber !== item.lineNumber &&
                "is-drag-over",
            ]}
            ondragover={(event) => handleWeeklyFocusDragOver(item, event)}
            ondrop={(event) => handleWeeklyFocusDrop(item, event)}
            ondragend={handleWeeklyFocusDragEnd}
            oncontextmenu={(event) => handleWeeklyFocusContextMenu(item, event)}
          >
            <button
              class="weekly-focus-drag-handle"
              type="button"
              aria-label="拖拽排序每周重点"
              draggable="true"
              ondragstart={(event) => handleWeeklyFocusDragStart(item, event)}
              ondragend={handleWeeklyFocusDragEnd}
            >
              ⋮⋮
            </button>
            <input
              class="weekly-focus-checkbox"
              type="checkbox"
              checked={["x", "X"].includes(item.status)}
              onchange={() => handleWeeklyFocusCheckboxChange(item)}
            />
            <input
              class="weekly-focus-input"
              aria-label="每周重点"
              value={item.text}
              onblur={(event) => handleWeeklyFocusTextBlur(item, event)}
            />
            <button
              class="weekly-focus-delete"
              aria-label="删除每周重点"
              type="button"
              onclick={() => handleDeleteWeeklyFocusItem(item)}
            >
              <Trash2 class="planner-settings-icon" />
            </button>
          </div>
        {:else}
          <div class="weekly-focus-empty">暂无周重点任务</div>
        {/each}
      </div>
    {/if}

    {#if weeklyFocusContextMenu}
      <div
        class="weekly-focus-context-menu"
        style:left={`${weeklyFocusContextMenu.x}px`}
        style:top={`${weeklyFocusContextMenu.y}px`}
        role="menu"
        onclick={(event) => event.stopPropagation()}
      >
        <button
          class="weekly-focus-context-delete"
          type="button"
          role="menuitem"
          onclick={() => handleDeleteWeeklyFocusItem(weeklyFocusContextMenu.item)}
        >
          删除
        </button>
      </div>
    {/if}
  </section>
{/if}

<style>
  :global(.planner-multi-day-scroller) {
    overflow: auto;
    flex: 1 0 0;
  }

  :global(.planner-header-row) {
    --cell-flex-basis: calc(
      var(--timeline-flex-basis) * var(--timeline-internal-column-count, 1)
    );

    z-index: 1000;
    overflow-x: hidden;
    display: flex;
    box-shadow: var(--shadow-bottom);
  }

  .ruler {
    z-index: 500;
    overflow-y: hidden;
    grid-area: ruler;
    box-shadow: var(--shadow-bottom);
  }

  .scrollbar-filler {
    height: var(--scrollbar-width);
  }

  :global(.horizontal-grip) {
    flex: 0 0 auto;
    color: var(--icon-color);
    opacity: var(--icon-opacity);
  }

  :global(.horizontal-grip:hover) {
    cursor: grab;
    opacity: var(--icon-opacity-hover);
  }

  .multi-day-row-wrapper {
    position: relative;
    overflow: hidden scroll;
    display: flex;
    flex: 1 0 0;
  }

  .day-buttons {
    grid-area: dates;
    font-size: var(--font-ui-small);
  }

  :global(.horizontal-resize-box-wrapper) {
    position: relative;
    grid-area: multiday;
    max-height: 16vh;
    border-bottom: var(--border-base);
  }

  .controls-sidebar {
    position: absolute;
    top: 0;
    right: var(--scrollbar-width);

    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
    align-self: flex-start;

    padding: var(--size-4-2) var(--size-4-1);

    background-color: var(--background-primary);
    border-bottom: var(--border-base);
    border-left: var(--border-base);
    border-bottom-left-radius: var(--radius-m);
    box-shadow: var(--input-shadow);
  }

  .multi-day-main-content {
    position: relative;

    display: flex;
    grid-area: timelines;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  }

  .weekly-focus-panel {
    overflow: hidden;
    display: flex;
    grid-area: focus;
    flex-direction: column;

    min-height: 96px;
    max-height: 28vh;

    background-color: var(--background-primary);
    border-top: var(--border-base);
    transition: min-height 180ms ease;
  }

  .weekly-focus-panel.is-collapsed {
    min-height: 36px;
  }

  .weekly-focus-header {
    display: flex;
    gap: var(--size-4-2);
    align-items: center;
    justify-content: space-between;

    min-height: 36px;
    padding: var(--size-2-2) var(--size-4-3);

    border-bottom: var(--border-base);
  }

  .weekly-focus-title-button {
    cursor: pointer;

    display: inline-flex;
    flex: 1 1 auto;
    gap: var(--size-2-2);
    align-items: center;

    min-width: 0;
    height: 100%;
    padding: 0;

    color: var(--text-muted);

    background: transparent;
    border: none;
  }

  .weekly-focus-title-button:hover,
  .weekly-focus-title-button:focus {
    color: var(--text-normal);
  }

  .weekly-focus-title {
    overflow: hidden;

    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .weekly-focus-actions {
    display: flex;
    flex: 0 0 auto;
    gap: var(--size-4-2);
    align-items: center;
  }

  .weekly-focus-progress {
    overflow: hidden;

    width: 104px;
    height: 4px;

    background-color: var(--background-modifier-border);
    border-radius: var(--radius-s);
  }

  .weekly-focus-progress-value {
    height: 100%;
    background-color: var(--color-accent);
    transition: width 180ms ease;
  }

  .weekly-focus-task-container {
    --weekly-focus-card-width: min(320px, 100%);

    overflow: auto;
    display: flex;
    flex: 1 1 auto;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--size-4-2);

    min-height: 0;
    padding: var(--size-4-2) var(--size-4-3);

    transition:
      gap 160ms ease,
      padding 160ms ease;
  }

  .weekly-focus-task-container.is-vertical-list {
    --weekly-focus-card-width: 100%;

    flex-direction: column;
    flex-wrap: nowrap;
  }

  .weekly-focus-card {
    cursor: text;

    display: flex;
    flex: 0 1 var(--weekly-focus-card-width);
    gap: var(--size-4-2);
    align-items: center;

    max-width: 100%;
    min-height: 34px;
    padding: var(--size-2-2) var(--size-4-2);

    background-color: var(--background-primary-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-m);

    transition:
      flex-basis 180ms ease,
      width 180ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .weekly-focus-card.is-dragging {
    opacity: 0.45;
    box-shadow: none;
  }

  .weekly-focus-card.is-drag-over {
    border-color: var(--interactive-accent);
  }

  .weekly-focus-card:focus-within {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }

  .weekly-focus-drag-handle {
    cursor: grab;
    user-select: none;

    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 24px;
    padding: 0;

    font-size: var(--font-ui-smaller);
    line-height: 1;
    color: var(--text-faint);
    letter-spacing: 0;

    background: transparent;
    border: none;
    border-radius: var(--clickable-icon-radius);
  }

  .weekly-focus-drag-handle:hover,
  .weekly-focus-drag-handle:focus {
    color: var(--text-muted);
    background-color: var(--background-modifier-hover);
  }

  .weekly-focus-drag-handle:active {
    cursor: grabbing;
  }

  .weekly-focus-checkbox {
    accent-color: var(--interactive-accent);
  }

  .weekly-focus-checkbox:checked {
    background-color: var(--interactive-accent);
  }

  .weekly-focus-input {
    flex: 0 1 var(--weekly-focus-card-width);

    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0;

    font-size: var(--font-ui-small);
    color: var(--text-normal);

    background: transparent;
    border: none;
  }

  .weekly-focus-input:focus {
    box-shadow: none;
  }

  .weekly-focus-delete {
    cursor: pointer;

    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;

    width: var(--clickable-icon-size);
    height: var(--clickable-icon-size);
    padding: var(--size-2-1);

    color: var(--text-faint);

    background: transparent;
    border: none;
    border-radius: var(--clickable-icon-radius);
  }

  .weekly-focus-delete:hover,
  .weekly-focus-delete:focus {
    color: var(--text-error);
    background-color: var(--background-modifier-hover);
    box-shadow: var(--input-shadow);
  }

  .weekly-focus-empty {
    padding: var(--size-4-2) 0;
    font-size: var(--font-ui-small);
    color: var(--text-faint);
  }

  .weekly-focus-context-menu {
    z-index: 10000;
    position: fixed;

    min-width: 96px;
    padding: var(--size-2-1);

    background-color: var(--background-primary-alt);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-s);
  }

  .weekly-focus-context-delete {
    cursor: pointer;

    width: 100%;
    padding: var(--size-2-2) var(--size-4-2);

    font-size: var(--font-ui-small);
    color: var(--text-error);
    text-align: left;

    background: transparent;
    border: none;
    border-radius: var(--radius-s);
  }

  .weekly-focus-context-delete:hover,
  .weekly-focus-context-delete:focus {
    color: var(--text-error);
    background-color: var(--background-modifier-hover);
  }

  .corner {
    z-index: 1000;

    display: flex;
    grid-area: corner;
    flex-direction: column-reverse;
    align-items: center;

    background-color: var(--background-primary);
    border-right: var(--border-base);
    border-bottom: var(--border-base);
    box-shadow: var(--shadow-bottom);
  }

  .header-cell {
    overflow-x: hidden;
    flex: 1 0 var(--cell-flex-basis);

    width: var(--cell-flex-basis);

    font-weight: var(--font-semibold);

    background-color: var(--background-primary);
    border-right: var(--border-base);
    border-bottom: var(--border-base);
  }

  .header-cell:last-of-type {
    flex: 1 0 calc(var(--cell-flex-basis) + var(--scrollbar-width));
    border-right: none;
  }

  .side-controls-wrapper {
    grid-area: settings;
    width: min(320px, 50vw);
    padding-inline: var(--size-4-3);
    border-left: var(--border-base);
  }
</style>
