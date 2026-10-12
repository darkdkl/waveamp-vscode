import { titleScrollPlan, TITLE_SCROLL_SEPARATOR } from "../shared/titleScroll";
import { titleEl } from "./dom";
import { settings } from "./state";

let text = "";
let animation: Animation | null = null;
let observedWidth = 0;
let scrolledOnce: string | null = null;

function stop(): void {
  animation?.cancel();
  animation = null;
  titleEl.classList.remove("is-scrolling");
  titleEl.textContent = text;
}

function start(): void {
  stop();
  const mode = settings.titleScroll;
  const textWidth = titleEl.scrollWidth;
  const overflow = textWidth - titleEl.clientWidth;
  if (mode === "off" || overflow <= 1) return;
  if (mode === "once" && scrolledOnce === text) return;
  const inner = document.createElement("span");
  inner.className = "display__track-scroll";
  inner.textContent = mode === "loop" ? text + TITLE_SCROLL_SEPARATOR + text : text;
  titleEl.classList.add("is-scrolling");
  titleEl.replaceChildren(inner);
  const plan = titleScrollPlan(mode, overflow, inner.offsetWidth - textWidth, settings.titleScrollSpeed);
  if (!plan) return stop();
  if (mode === "once") scrolledOnce = text;
  const running = inner.animate(
    plan.keyframes.map((k) => ({ offset: k.offset, transform: `translateX(${k.x}px)` })),
    { duration: plan.durationMs, iterations: plan.iterations, easing: "linear" }
  );
  running.onfinish = () => {
    if (animation === running) stop();
  };
  animation = running;
}

export function setTitleText(next: string): void {
  if (next === text && (animation || titleEl.textContent === next)) return;
  text = next;
  titleEl.textContent = next;
  start();
}

export function refreshTitleScroll(): void {
  scrolledOnce = null;
  start();
}

export function initTitleScroll(): void {
  new ResizeObserver(() => {
    if (titleEl.clientWidth === observedWidth) return;
    observedWidth = titleEl.clientWidth;
    start();
  }).observe(titleEl);
}
