import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "./style.css";
import { World } from "./world.js";
import { Sound } from "./audio.js";

const world = new World(document.querySelector("#scene"));
const sound = new Sound();

const progress = document.querySelector("#progress");
const hint = document.querySelector("#hint");
const veil = document.querySelector("#veil");
const soundButton = document.querySelector("#sound");

function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? window.scrollY / max : 0;
}

function onScroll() {
  const value = scrollProgress();
  world.setScroll(value);
  progress.style.transform = `scaleX(${value})`;
  hint.classList.toggle("hide", value > 0.03);
}

window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

window.addEventListener("pointermove", (event) => {
  world.setPointer(event.clientX, event.clientY);
});

window.addEventListener("pointerleave", () => {
  world.clearPointer();
});

window.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, a")) return;
  world.burst(event.clientX, event.clientY);
  if (!sound.enabled) {
    sound.unlock();
    setSoundPressed(true);
  }
  sound.ping();
});

soundButton.addEventListener("click", () => {
  setSoundPressed(sound.toggle());
});

document.querySelectorAll("[data-mood]").forEach((button) => {
  button.addEventListener("click", () => {
    const mood = button.dataset.mood;
    world.setMood(mood);
    sound.setMood(mood);
    if (sound.enabled) sound.ping();
    document.querySelectorAll("[data-mood]").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
  });
});

window.addEventListener("resize", () => world.resize());

let running = true;

function frame() {
  if (!running) return;
  world.update(sound.energy());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.fonts.ready.then(() => {
  requestAnimationFrame(() => veil.classList.add("gone"));
});
setTimeout(() => veil.classList.add("gone"), 1800);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    running = false;
    world.dispose();
  });
}

function setSoundPressed(on) {
  soundButton.setAttribute("aria-pressed", on ? "true" : "false");
  soundButton.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
}
