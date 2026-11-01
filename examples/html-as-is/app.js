/*
 * A script that travels with the page.
 *
 * Here to prove a published as-is page is still a working page: nothing about
 * it was rehydrated, re-bound or replaced with a static stand-in, which is
 * what happens to a plugin's controls inside a rendered note.
 */
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-count]");
  if (!button) return;
  const next = Number(button.dataset.count || 0) + 1;
  button.dataset.count = String(next);
  button.textContent = `Clicked ${next} time${next === 1 ? "" : "s"}`;
});
