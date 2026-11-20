/**
 * PlaybackControls — shared transport for step-by-step visualizers, 3D
 * animations, and parametric curves: step back, play/pause, step forward,
 * timeline scrubber, speed selection, and a live readout.
 *
 * @module components/ui/playback
 */
import { el, icon } from './dom.ts';
import { ds } from './classes.ts';
import { IconButton } from './buttons.ts';
import { Select } from './inputs.ts';

export const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface PlaybackControlsProps {
  playing: boolean;
  onTogglePlay: () => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  /** Timeline position; renders a scrubber + counter when provided. */
  index?: number;
  count?: number;
  onScrub?: (index: number) => void;
  speed?: PlaybackSpeed;
  onSpeedChange?: (speed: PlaybackSpeed) => void;
  /** Live monospace readout (e.g. `t = 1.25`). */
  readout?: string;
  ariaLabel: string;
  testId?: string;
}

export interface PlaybackControlsHandle {
  root: HTMLElement;
  setPlaying(playing: boolean): void;
  setIndex(index: number, count: number): void;
  setReadout(text: string): void;
  setSpeed(speed: PlaybackSpeed): void;
}

export function PlaybackControls(props: PlaybackControlsProps): PlaybackControlsHandle {
  const {
    playing, onTogglePlay, onStepBack, onStepForward, index, count, onScrub,
    speed = 1, onSpeedChange, readout = '', ariaLabel, testId,
  } = props;
  const root = el('div', ds.playback);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', ariaLabel);
  if (testId) root.dataset.testid = testId;

  if (onStepBack) {
    root.append(IconButton({ icon: 'chevron-left', label: 'Step back', size: 'sm', onClick: onStepBack }));
  }
  let isPlaying = playing;
  const playButton = IconButton({
    icon: isPlaying ? 'pause' : 'play',
    label: isPlaying ? 'Pause' : 'Play',
    size: 'sm',
    onClick: onTogglePlay,
  });
  root.append(playButton);
  if (onStepForward) {
    root.append(IconButton({ icon: 'chevron-right', label: 'Step forward', size: 'sm', onClick: onStepForward }));
  }

  let scrubber: HTMLInputElement | null = null;
  let counter: HTMLElement | null = null;
  if (count !== undefined && index !== undefined) {
    scrubber = el('input', ds.playbackScrub);
    scrubber.type = 'range';
    scrubber.min = '0';
    scrubber.max = String(Math.max(0, count - 1));
    scrubber.step = '1';
    scrubber.value = String(index);
    scrubber.setAttribute('aria-label', ariaLabel + ' timeline');
    if (onScrub) scrubber.addEventListener('input', () => onScrub(Number(scrubber!.value)));
    counter = el('span', ds.playbackCounter, `${index + 1} / ${count}`);
    root.append(scrubber, counter);
  }

  const readoutNode = el('span', ds.playbackReadout, readout);
  readoutNode.hidden = !readout;
  root.append(readoutNode);

  let speedSelect: ReturnType<typeof Select<string>> | null = null;
  if (onSpeedChange) {
    speedSelect = Select({
      value: String(speed),
      options: PLAYBACK_SPEEDS.map(value => ({ value: String(value), label: `${value}×` })),
      onChange: value => onSpeedChange(Number(value) as PlaybackSpeed),
      ariaLabel: 'Playback speed',
      size: 'xs',
    });
    root.append(speedSelect.root);
  }

  root.addEventListener('keydown', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) return;
    if (event.key === ' ') {
      event.preventDefault();
      onTogglePlay();
    } else if (event.key === 'ArrowLeft' && onStepBack) {
      event.preventDefault();
      onStepBack();
    } else if (event.key === 'ArrowRight' && onStepForward) {
      event.preventDefault();
      onStepForward();
    }
  });

  return {
    root,
    setPlaying(next: boolean) {
      isPlaying = next;
      playButton.replaceChildren(icon(next ? 'pause' : 'play'));
      const label = next ? 'Pause' : 'Play';
      playButton.setAttribute('aria-label', label);
      playButton.title = label;
    },
    setIndex(nextIndex: number, nextCount: number) {
      if (scrubber) {
        scrubber.max = String(Math.max(0, nextCount - 1));
        scrubber.value = String(nextIndex);
      }
      if (counter) counter.textContent = `${nextIndex + 1} / ${nextCount}`;
    },
    setReadout(text: string) {
      readoutNode.textContent = text;
      readoutNode.hidden = !text;
    },
    setSpeed(next: PlaybackSpeed) {
      speedSelect?.setValue(String(next));
    },
  };
}