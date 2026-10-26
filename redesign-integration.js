"use strict";

// Shared fixes preserve the supplied layout without a backend or database.
document.querySelectorAll('a[target="_blank"]').forEach(link => {
  link.rel = "noopener noreferrer";
  if (link.classList.contains("floating-wa")) link.setAttribute("aria-label", "Chat on WhatsApp");
});
// Use the bundled image instead of repeatedly decoding embedded logo copies.
document.querySelectorAll('img[src^="data:image"]').forEach(image => {
  image.src = "assets/logo.jpg";
});
document.querySelectorAll(".dest-card img").forEach(image => { image.loading = "lazy"; });

const menu = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#main-navigation");
if (menu && navigation) {
  document.documentElement.classList.add("js-nav");
  const close = () => {
    menu.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
  });
  navigation.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") { close(); menu.focus(); }
  });
}
const header = document.getElementById("header");
if (header) {
  const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
}

const groupPages = ["school-trips.html", "church-retreats.html", "corporate-groups.html", "family-groups.html", "sports-teams.html", "ngo-groups.html"];
document.querySelectorAll("#groups .card").forEach((card, index) => {
  const link = document.createElement("a");
  link.href = groupPages[index];
  link.className = "group-page-link";
  link.textContent = "Explore " + card.querySelector("h3").textContent;
  card.append(link);
});

const form = document.getElementById("quoteForm");
if (form) {
  const arrival = form.elements.arrival;
  const departure = form.elements.departure;
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  arrival.min = today.toISOString().slice(0, 10);
  const validateDates = () => {
    departure.min = arrival.value || arrival.min;
    departure.setCustomValidity(arrival.value && departure.value && departure.value <= arrival.value
      ? "Departure must be after arrival." : "");
  };
  arrival.addEventListener("input", validateDates);
  departure.addEventListener("input", validateDates);
  form.addEventListener("submit", event => {
    event.preventDefault();
    validateDates();
    const name = form.elements.fullName;
    const phone = form.elements.phone;
    name.setCustomValidity(name.value.trim() ? "" : "Please enter your name.");
    phone.setCustomValidity(/^\+?[\d\s().-]{7,25}$/.test(phone.value.trim()) ? "" : "Please enter a valid phone number.");
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of Object.keys(data)) data[key] = data[key].trim();
    const message = `Hello Coast Bookings, I would like a group quote.\n\nName: ${data.fullName}\nPhone: ${data.phone}\nGroup: ${data.groupType}\nGuests: ${data.guests}\nDestination: ${data.destination}\nMeals: ${data.meals}\nArrival: ${data.arrival}\nDeparture: ${data.departure}\nNotes: ${data.notes || "None"}`;
    const url = "https://wa.me/254741076845?text=" + encodeURIComponent(message);
    const status = document.getElementById("formMessage");
    status.textContent = "Your request is ready. Open WhatsApp and send the message to submit it. ";
    const fallback = document.createElement("a");
    fallback.href = url;
    fallback.target = "_blank";
    fallback.rel = "noopener noreferrer";
    fallback.textContent = "Open WhatsApp";
    status.append(fallback);
    window.open(url, "_blank", "noopener,noreferrer");
  });
  for (const field of [form.elements.fullName, form.elements.phone]) {
    field.addEventListener("input", () => field.setCustomValidity(""));
  }
  form.querySelector('[type="submit"]').disabled = false;
}
