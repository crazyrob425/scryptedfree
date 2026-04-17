window.addEventListener("DOMContentLoaded", () => {
  const year = document.querySelector<HTMLElement>("#year");
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }
});
