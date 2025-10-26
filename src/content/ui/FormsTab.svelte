<script lang="ts">
  import { formGroups, selectedFormGroupId, setSelectedFormGroup, setHoveredFormGroup, clearHoveredFormGroup, applyAll, fillAllGroups } from './state';
  import { derived } from 'svelte/store';

  let fillingAll = false;
  let message = '';

  const sortedGroups = derived(formGroups, ($groups) => {
    return [...$groups];
  });

  function handleSelect(groupId: string) {
    setSelectedFormGroup(groupId);
    message = '';
  }

  function handleFillSelected() {
    const count = applyAll();
    message = count
      ? `Filled ${count} field${count === 1 ? '' : 's'} in selected group.`
      : 'No fields filled for the selected group.';
  }

  async function handleFillAll() {
    fillingAll = true;
    message = '';
    try {
      const count = await fillAllGroups();
      message = count
        ? `Filled ${count} field${count === 1 ? '' : 's'} across all groups.`
        : 'No fields filled across the detected groups.';
    } finally {
      fillingAll = false;
    }
  }

  function labelForGroup(fieldCount: number): string {
    return `${fieldCount} field${fieldCount === 1 ? '' : 's'}`;
  }
</script>

<div class="aiaf-forms-tab">
  {#if $sortedGroups.length === 0}
    <div class="empty-state">No forms detected on this page.</div>
  {:else}
    <div class="controls">
      <button class="primary" type="button" on:click={handleFillSelected}>Fill selected group</button>
      <button type="button" class="secondary" on:click={handleFillAll} disabled={fillingAll}>
        {fillingAll ? 'Filling…' : 'Fill all groups'}
      </button>
    </div>
    {#if message}
      <div class="message">{message}</div>
    {/if}
    <ul class="group-list">
      {#each $sortedGroups as group}
        <li class:selected={group.id === $selectedFormGroupId}>
          <button
            type="button"
            class="group-button"
            on:mouseenter={() => setHoveredFormGroup(group.id)}
            on:mouseleave={clearHoveredFormGroup}
            on:focus={() => setHoveredFormGroup(group.id)}
            on:blur={clearHoveredFormGroup}
            on:click={() => handleSelect(group.id)}
            on:keydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSelect(group.id);
              }
            }}
            aria-pressed={group.id === $selectedFormGroupId}
          >
            <div class="label">{group.label}</div>
            {#if group.hint && group.hint !== group.label}
              <div class="hint">{group.hint}</div>
            {/if}
            <div class="meta">{labelForGroup(group.fieldCount)}</div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
