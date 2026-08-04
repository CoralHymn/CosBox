<script lang="ts">
	import { DAY_NAMES, formatMinutesOfDay, formatWorldTime } from '../core/state';
	import type { ScheduleEntry, ScheduleState, StatePatch } from '../core/types';
	import { newId } from '../utils/id';

	interface Props {
		schedule: ScheduleState;
		onUpdate: (patch: StatePatch, desc: string) => void;
		onAdvance: (minutes: number) => void;
	}

	let { schedule, onUpdate, onAdvance }: Props = $props();

	let draftTitle = $state('');
	let draftDay = $state(0);
	let draftStart = $state('08:00');
	let draftEnd = $state('09:00');
	let draftLocation = $state('');

	function timeToMinutes(value: string): number {
		const [hours, minutes] = value.split(':').map(Number);
		return (hours ?? 0) * 60 + (minutes ?? 0);
	}

	function addEntry(): void {
		const title = draftTitle.trim();
		if (title === '') {
			return;
		}
		const start = timeToMinutes(draftStart);
		const end = timeToMinutes(draftEnd);
		if (start >= end) {
			return;
		}
		const entry: ScheduleEntry = {
			id: newId(),
			day: draftDay,
			start,
			end,
			title,
			...(draftLocation.trim() !== '' ? { locationId: draftLocation.trim() } : {})
		};
		onUpdate({ schedule: { entries: [...schedule.entries, entry] } }, '新增日程条目');
		draftTitle = '';
	}

	function updateEntry(id: string, patch: Partial<ScheduleEntry>): void {
		onUpdate(
			{ schedule: { entries: schedule.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) } },
			'更新日程条目'
		);
	}

	function removeEntry(id: string): void {
		onUpdate(
			{ schedule: { entries: schedule.entries.filter((entry) => entry.id !== id) } },
			'删除日程条目'
		);
	}
</script>

<div class="panel">
	<h2 class="panel-title">日程与时间</h2>
	<p class="panel-sub">推进时间会自动生成状态快照；日程会注入 LLM 上下文。</p>

	<div class="card">
		<h3 class="card-title">当前世界时间</h3>
		<p style="font-size: 20px; font-weight: 700; margin: 0 0 12px;">{formatWorldTime(schedule.time)}</p>
		<div class="row-actions">
			<button class="btn" onclick={() => onAdvance(-60)}>⏪ -1h</button>
			<button class="btn" onclick={() => onAdvance(15)}>+15m</button>
			<button class="btn" onclick={() => onAdvance(60)}>+1h</button>
			<button class="btn" onclick={() => onAdvance(1440)}>+1d</button>
		</div>
	</div>

	<div class="card">
		<h3 class="card-title">日程表</h3>
		{#if schedule.entries.length === 0}
			<p class="empty-hint">暂无日程条目</p>
		{:else}
			{#each schedule.entries as entry (entry.id)}
				<div class="list-row">
					<select
						class="select"
						style="width: 86px;"
						value={entry.day}
						onchange={(event) => updateEntry(entry.id, { day: Number((event.currentTarget as HTMLSelectElement).value) })}
					>
						{#each DAY_NAMES as dayName, index (index)}
							<option value={index}>{dayName}</option>
						{/each}
					</select>
					<input
						class="input"
						style="width: 92px;"
						type="time"
						value={formatMinutesOfDay(entry.start)}
						onchange={(event) => updateEntry(entry.id, { start: timeToMinutes((event.currentTarget as HTMLInputElement).value) })}
					/>
					<span class="muted">—</span>
					<input
						class="input"
						style="width: 92px;"
						type="time"
						value={formatMinutesOfDay(entry.end)}
						onchange={(event) => updateEntry(entry.id, { end: timeToMinutes((event.currentTarget as HTMLInputElement).value) })}
					/>
					<input
						class="input"
						style="flex: 1;"
						value={entry.title}
						onchange={(event) => updateEntry(entry.id, { title: (event.currentTarget as HTMLInputElement).value.trim() })}
					/>
					<button class="btn btn-danger btn-small" onclick={() => removeEntry(entry.id)} aria-label="删除条目">✕</button>
				</div>
			{/each}
		{/if}
		<hr class="section-divider" />
		<div class="grid-2">
			<div class="field">
				<label for="entry-title">标题</label>
				<input id="entry-title" class="input" bind:value={draftTitle} placeholder="如：国文课" />
			</div>
			<div class="field">
				<label for="entry-day">星期</label>
				<select id="entry-day" class="select" bind:value={draftDay}>
					{#each DAY_NAMES as dayName, index (index)}
						<option value={index}>{dayName}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="entry-start">开始</label>
				<input id="entry-start" class="input" type="time" bind:value={draftStart} />
			</div>
			<div class="field">
				<label for="entry-end">结束</label>
				<input id="entry-end" class="input" type="time" bind:value={draftEnd} />
			</div>
		</div>
		<div class="field">
			<label for="entry-location">地点 id（可选）</label>
			<input id="entry-location" class="input" bind:value={draftLocation} placeholder="如：classroom" />
		</div>
		<button class="btn btn-primary" onclick={addEntry}>添加条目</button>
	</div>
</div>
