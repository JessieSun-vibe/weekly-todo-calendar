<script lang="ts">
  import { fromStore } from "svelte/store";

  import { getDateRangeContext } from "../../context/date-range-context";
  import { getObsidianContext } from "../../context/obsidian-context";
  import { getVisibleHours } from "../../global-store/derived-settings";
  import { settings } from "../../global-store/settings";
  import { createColumnSelectionMenu } from "../column-selection-menu";

  import ControlButton from "./control-button.svelte";
  import ErrorBoundary from "./error-boundary.svelte";
  import { EllipsisVertical, LayoutGrid, List } from "./lucide";
  import Tree from "./obsidian/tree.svelte";
  import ResizeHandle from "./resize-handle.svelte";
  import ResizeableBox from "./resizeable-box.svelte";
  import Ruler from "./ruler.svelte";
  import Scroller from "./scroller.svelte";
  import TimelineControls from "./timeline-controls.svelte";
  import Timeline from "./timeline.svelte";
  import UnscheduledTimeBlock from "./unscheduled-time-block.svelte";

  const { editContext, pointerDateTime } = getObsidianContext();

  const getDisplayedAllDayTasksForMultiDayRow = fromStore(
    editContext.getDisplayedAllDayTasksForMultiDayRow,
  );
  const editOperation = fromStore(editContext.editOperation);

  const dateRange = fromStore(getDateRangeContext());
  const firstDayInRange = $derived(dateRange.current[0]);

  const displayedAllDayTasks = $derived(
    getDisplayedAllDayTasksForMultiDayRow.current({
      start: firstDayInRange,
      end: dateRange.current[dateRange.current.length - 1],
    }),
  );

  function handleResizeableBoxPointerMove() {
    pointerDateTime.set({
      dateTime: dateRange.current[0],
      type: "date",
    });
  }

  function toggleWeeklyFocusLayout() {
    $settings = {
      ...$settings,
      weeklyFocusLayout:
        $settings.weeklyFocusLayout === "vertical" ? "horizontal" : "vertical",
    };
  }
</script>

<ErrorBoundary>
  <TimelineControls />

  {#if $settings.showUncheduledTasks}
    <Tree title="每周重点计划">
      {#snippet flair()}
        {String(displayedAllDayTasks.length)}
      {/snippet}
      {#snippet controls()}
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
      {/snippet}
      {#if editOperation.current || displayedAllDayTasks.length > 0}
        <ResizeableBox
          class="unscheduled-task-container"
          onpointermove={handleResizeableBoxPointerMove}
          onpointerup={editContext.confirmEdit}
        >
          {#snippet children(startEdit)}
            {#if editOperation.current && displayedAllDayTasks.length === 0}
              <div class="edit-prompt">
                Drag blocks here to schedule all-day tasks
              </div>
            {:else if displayedAllDayTasks.length > 0}
              <div
                class={[
                  "weekly-focus-task-container",
                  $settings.weeklyFocusLayout === "vertical" &&
                    "is-vertical-list",
                ]}
              >
                {#each displayedAllDayTasks as task (task.id)}
                  <UnscheduledTimeBlock
                    --time-block-padding="0"
                    --time-block-width="var(--weekly-focus-card-width)"
                    {task}
                  />
                {/each}
              </div>
            {/if}
            <ResizeHandle on:mousedown={startEdit} />
          {/snippet}
        </ResizeableBox>
      {/if}
    </Tree>
  {/if}

  {#if $settings.showTimelineInSidebar}
    <Tree title="Timeline">
      {#snippet controls()}
        <ControlButton
          --border-radius="0"
          label="Timeline Settings"
          onclick={(event) => {
            createColumnSelectionMenu({ settings, event });
          }}
        >
          <EllipsisVertical class="planner-settings-icon" />
        </ControlButton>
      {/snippet}
      <Scroller
        class={["planner-timeline-scroller", "planner-flex-scrollable"]}
      >
        {#snippet children(isUnderCursor)}
          <Ruler visibleHours={getVisibleHours($settings)} />
          <Timeline day={firstDayInRange} {isUnderCursor} />
        {/snippet}
      </Scroller>
    </Tree>
  {/if}
</ErrorBoundary>

<style>
  :global(svg.svg-icon.planner-settings-icon) {
    width: var(--icon-s);
    height: var(--icon-s);
  }

  :global(.planner-timeline-scroller) {
    border-top: var(--border-base);
  }

  :global(.unscheduled-task-container) {
    overflow: auto;
  }

  .weekly-focus-task-container {
    --weekly-focus-card-width: min(320px, 100%);

    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--size-4-2);

    padding: var(--size-4-1) var(--size-4-2);

    transition:
      gap 160ms ease,
      padding 160ms ease;
  }

  .weekly-focus-task-container.is-vertical-list {
    --weekly-focus-card-width: 100%;

    flex-direction: column;
    flex-wrap: nowrap;
  }

  .weekly-focus-task-container :global(.padding) {
    flex: 0 1 var(--weekly-focus-card-width);
    max-width: 100%;
    padding: 0;

    transition:
      flex-basis 180ms ease,
      width 180ms ease;
  }

  .edit-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;

    padding: var(--size-4-2);

    font-size: var(--font-ui-small);
    color: var(--text-faint);
  }
</style>
